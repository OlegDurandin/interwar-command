use game_core::{
    Hex, Terrain,
    game::{
        CombatPreview, EventKind, GameAction, GameState, Losses, MoveRoute, Outcome, Phase,
        SupplyLevel, supply_level,
    },
    scenario::{UnitId, UnitType},
};
use serde::Serialize;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Tsify)]
pub struct CellPosition {
    q: i32,
    r: i32,
}
impl From<Hex> for CellPosition {
    fn from(h: Hex) -> Self {
        Self { q: h.q, r: h.r }
    }
}
#[derive(Clone, Copy, Serialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum Supply {
    Full,
    Low,
    None,
}
impl From<SupplyLevel> for Supply {
    fn from(value: SupplyLevel) -> Self {
        match value {
            SupplyLevel::Full => Self::Full,
            SupplyLevel::Low => Self::Low,
            SupplyLevel::None => Self::None,
        }
    }
}
#[derive(Serialize, Tsify)]
pub struct MapCell {
    position: CellPosition,
    terrain: String,
    controller: Option<String>,
    source: bool,
    city: Option<String>,
    forecast: Supply,
    enemy_zoc: bool,
    objective_points: u32,
}
#[derive(Serialize, Tsify)]
pub struct MapLink {
    a: CellPosition,
    b: CellPosition,
    river: bool,
    bridge: bool,
    road: bool,
    rail: bool,
}
#[derive(Serialize, Tsify)]
pub struct Counter {
    id: String,
    faction: String,
    kind: String,
    position: CellPosition,
    strength: u8,
    readiness: u8,
    moved: bool,
    attacked: bool,
    entrenched: bool,
    entrenchment: u8,
    supply: Supply,
}
#[derive(Serialize, Tsify)]
pub struct Side {
    id: String,
    name: String,
    score: u32,
}

#[derive(Serialize, Tsify)]
pub struct MovementView {
    state_revision: String,
    combat_index: String,
    rng_seed: String,
    title: String,
    width: i32,
    height: i32,
    cells: Vec<MapCell>,
    edges: Vec<MapLink>,
    units: Vec<Counter>,
    sides: Vec<Side>,
    round: u32,
    active: Option<String>,
    winner: Option<String>,
}
#[derive(Serialize, Tsify)]
pub struct RouteView {
    path: Vec<CellPosition>,
    cost: u8,
}
impl From<&MoveRoute> for RouteView {
    fn from(route: &MoveRoute) -> Self {
        Self {
            path: route.path.iter().copied().map(Into::into).collect(),
            cost: route.cost,
        }
    }
}
#[derive(Serialize, Tsify)]
pub struct MovementOptions {
    routes: Vec<RouteView>,
    targets: Vec<AttackOption>,
    can_entrench: bool,
}

#[derive(Serialize, Tsify)]
pub struct AttackOption {
    target: String,
    attacker_min: u8,
    attacker_max: u8,
    defender_min: u8,
    defender_max: u8,
    attack: u8,
    defense: u8,
    attack_factor: u8,
    defense_factor: u8,
    attack_hq: u8,
    defense_hq: u8,
    terrain: u8,
    river: u8,
    entrenchment: u8,
}
impl AttackOption {
    fn from_preview(target: &UnitId, p: CombatPreview) -> Self {
        let m = p.modifiers;
        Self {
            target: target.0.clone(),
            attacker_min: p.attacker.min,
            attacker_max: p.attacker.max,
            defender_min: p.defender.min,
            defender_max: p.defender.max,
            attack: m.attack,
            defense: m.defense,
            attack_factor: m.attack_factor,
            defense_factor: m.defense_factor,
            attack_hq: m.attack_hq,
            defense_hq: m.defense_hq,
            terrain: m.terrain,
            river: m.river,
            entrenchment: m.entrenchment,
        }
    }
}
#[derive(Serialize, Tsify)]
pub struct CombatReport {
    attacker_loss: u8,
    defender_loss: u8,
}

#[wasm_bindgen]
pub struct MovementSession {
    game: GameState,
}

#[wasm_bindgen]
impl MovementSession {
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<MovementSession, JsError> {
        let mut game = GameState::load(json.as_bytes())?;
        game.start()?;
        Ok(Self { game })
    }
    pub fn load_save(json: &str) -> Result<MovementSession, JsError> {
        Ok(Self {
            game: GameState::load_save(json.as_bytes())?,
        })
    }
    pub fn serialize_save(&self) -> Result<String, JsError> {
        Ok(self.game.serialize_save()?)
    }
    pub fn state_hash(&self) -> String {
        self.game.state_hash()
    }
    pub fn apply_action(
        &mut self,
        command: crate::orders::Order,
    ) -> Result<crate::orders::ResultView, JsError> {
        let action = serde_wasm_bindgen::from_value(command.into())?;
        let result = self.game.apply_action(action)?;
        crate::orders::batch(result.state_revision, result.events)
    }
    pub fn next_ai_action(&self) -> Result<crate::orders::Order, JsError> {
        use wasm_bindgen::JsCast;
        Ok(serde_wasm_bindgen::to_value(&game_ai::next_action(&self.game)?)?.unchecked_into())
    }
    pub fn journal(&self) -> Result<crate::orders::ResultView, JsError> {
        let events = self.game.events();
        crate::orders::batch(
            self.game.state_revision(),
            &events[events.len().saturating_sub(12)..],
        )
    }
    pub fn snapshot(&self) -> Result<Ts<MovementView>, JsError> {
        let game = &self.game;
        let scenario = game.scenario();
        let points: std::collections::BTreeMap<_, _> = scenario
            .objectives
            .iter()
            .map(|o| (Hex { q: o.q, r: o.r }, o.points_per_round))
            .collect();
        let forecast = match game.phase() {
            Phase::Active { active_faction, .. } => game.supply_forecast(active_faction),
            _ => Default::default(),
        };
        let zoc = match game.phase() {
            Phase::Active { active_faction, .. } => game.enemy_zoc(active_faction),
            _ => Default::default(),
        };
        let cells = scenario
            .map
            .tiles()
            .map(|(h, t)| MapCell {
                position: h.into(),
                terrain: match t.terrain {
                    Terrain::Plain => "plain",
                    Terrain::Forest => "forest",
                    Terrain::Hills => "hills",
                    Terrain::Swamp => "swamp",
                    Terrain::Urban => "urban",
                    Terrain::Water => "water",
                }
                .into(),
                controller: game.controller(h).map(|f| f.0.clone()),
                source: t.supply_source,
                city: t.city_id.clone(),
                enemy_zoc: zoc.contains(&h),
                forecast: supply_level(forecast.get(&h).copied()).into(),
                objective_points: points.get(&h).copied().unwrap_or(0),
            })
            .collect();
        let edges = scenario
            .map
            .edges()
            .map(|e| MapLink {
                a: e.a.into(),
                b: e.b.into(),
                river: e.features.river,
                bridge: e.features.bridge,
                road: e.features.road,
                rail: e.features.rail,
            })
            .collect();
        let units = game
            .units()
            .iter()
            .map(|(id, u)| Counter {
                id: id.0.clone(),
                faction: u.faction_id.0.clone(),
                kind: match u.unit_type {
                    UnitType::Infantry => "infantry",
                    UnitType::Cavalry => "cavalry",
                    UnitType::Artillery => "artillery",
                    UnitType::Headquarters => "headquarters",
                }
                .into(),
                position: u.position.into(),
                strength: u.strength,
                readiness: u.readiness,
                moved: u.orders.moved_this_phase,
                attacked: u.orders.attacked_this_phase,
                entrenched: u.orders.entrenched_this_phase,
                entrenchment: u.entrenchment,
                supply: u.supply.into(),
            })
            .collect();
        let (round, active, winner) = match game.phase() {
            Phase::Active {
                round,
                active_faction,
            } => (*round, Some(active_faction.0.clone()), None),
            Phase::Finished { round, result } => (
                *round,
                None,
                match result {
                    Outcome::Draw => None,
                    Outcome::Winner(id) => Some(id.0.clone()),
                },
            ),
            Phase::NotStarted => (0, None, None),
        };
        let sides = scenario
            .factions
            .iter()
            .map(|f| Side {
                id: f.id.0.clone(),
                name: f.name.clone(),
                score: game.score(&f.id).unwrap_or_default(),
            })
            .collect();
        Ok(MovementView {
            state_revision: game.state_revision().to_string(),
            combat_index: game.combat_index().to_string(),
            rng_seed: game.rng_seed().to_string(),
            title: scenario.title.clone(),
            width: scenario.map.width(),
            height: scenario.map.height(),
            cells,
            edges,
            units,
            sides,
            round,
            active,
            winner,
        }
        .into_ts()?)
    }
    pub fn options(&self, id: &str) -> Result<Ts<MovementOptions>, JsError> {
        use game_core::game::GameError;
        let routes = match self.game.reachable(&UnitId(id.into())) {
            Ok(routes) => routes.values().map(RouteView::from).collect(),
            Err(GameError::WrongFaction | GameError::OrderAlreadyUsed | GameError::Finished) => {
                Vec::new()
            }
            Err(error) => return Err(error.into()),
        };
        let attacker = UnitId(id.into());
        let targets = self
            .game
            .units()
            .keys()
            .filter_map(|d| {
                self.game
                    .preview_attack(&attacker, d)
                    .ok()
                    .map(|p| AttackOption::from_preview(d, p))
            })
            .collect();
        Ok(MovementOptions {
            routes,
            targets,
            can_entrench: self.game.can_entrench(&attacker).is_ok(),
        }
        .into_ts()?)
    }
    pub fn move_to(&mut self, id: &str, q: i32, r: i32) -> Result<Ts<RouteView>, JsError> {
        let batch = self.game.apply_action(GameAction::Move {
            unit_id: UnitId(id.into()),
            destination: Hex { q, r },
        })?;
        let route = batch
            .events
            .iter()
            .find_map(|event| match &event.kind {
                EventKind::UnitMoved { route, .. } => Some(RouteView::from(route)),
                _ => None,
            })
            .ok_or_else(|| JsError::new("Move event missing"))?;
        Ok(route.into_ts()?)
    }
    pub fn attack(&mut self, attacker: &str, defender: &str) -> Result<Ts<CombatReport>, JsError> {
        let batch = self.game.apply_action(GameAction::Attack {
            attacker_id: UnitId(attacker.into()),
            defender_id: UnitId(defender.into()),
        })?;
        let Losses { attacker, defender } = batch
            .events
            .iter()
            .find_map(|e| match e.kind {
                EventKind::CombatResolved { losses, .. } => Some(losses),
                _ => None,
            })
            .ok_or_else(|| JsError::new("Combat result missing"))?;
        Ok(CombatReport {
            attacker_loss: attacker,
            defender_loss: defender,
        }
        .into_ts()?)
    }
    pub fn end_phase(&mut self) -> Result<(), JsError> {
        self.game.apply_action(GameAction::EndPhase {})?;
        Ok(())
    }
}
