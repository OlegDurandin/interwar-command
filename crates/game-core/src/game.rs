//! Native game state and atomic phase commands (SPEC §§6.2, 9, 12.5).
mod combat;
mod movement;
mod save;
pub use save::SaveError;
mod supply;
use crate::scenario::{Scenario, ScenarioError, UnitId, UnitType, load_scenario};
use crate::{FactionId, Hex};
pub use combat::{CombatModifiers, CombatPreview, LossRange, Losses};
pub use movement::MoveRoute;
use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, collections::BTreeMap, fmt};
pub use supply::{SupplyLevel, supply_level};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum GameAction {
    Move {
        unit_id: UnitId,
        destination: Hex,
    },
    Attack {
        attacker_id: UnitId,
        defender_id: UnitId,
    },
    Entrench {
        unit_id: UnitId,
    },
    EndPhase {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum Outcome {
    Winner(FactionId),
    Draw,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Phase {
    NotStarted,
    Active {
        round: u32,
        active_faction: FactionId,
    },
    Finished {
        round: u32,
        result: Outcome,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderFlags {
    pub moved_this_phase: bool,
    pub attacked_this_phase: bool,
    pub entrenched_this_phase: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnitState {
    pub faction_id: FactionId,
    pub unit_type: UnitType,
    pub position: Hex,
    pub strength: u8,
    pub readiness: u8,
    pub entrenchment: u8,
    pub supply: SupplyLevel,
    pub orders: OrderFlags,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum EventKind {
    PhaseStarted {
        round: u32,
        faction: FactionId,
    },
    Entrenched {
        unit_id: UnitId,
        level: u8,
    },
    UnitMoved {
        unit_id: UnitId,
        route: MoveRoute,
    },
    CombatResolved {
        attacker: UnitId,
        defender: UnitId,
        jitter: [i8; 2],
        losses: Losses,
    },
    UnitDestroyed {
        unit_id: UnitId,
    },
    UnitAdvanced {
        unit_id: UnitId,
        at: Hex,
    },
    ControlChanged {
        at: Hex,
        faction: FactionId,
    },
    PhaseEnded {
        round: u32,
        faction: FactionId,
    },
    RoundEnded {
        round: u32,
    },
    ObjectiveScored {
        objective_id: String,
        faction: FactionId,
        points: u32,
    },
    GameFinished {
        round: u32,
        result: Outcome,
    },
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameEvent {
    #[serde(with = "save::decimal")]
    pub revision: u64,
    pub order: usize,
    pub kind: EventKind,
}

#[derive(Debug)]
pub struct ActionResult<'a> {
    pub state_revision: u64,
    pub events: &'a [GameEvent],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameError {
    NotStarted,
    AlreadyStarted,
    Finished,
    UnknownUnit,
    WrongFaction,
    OrderAlreadyUsed,
    EntrenchmentLimit,
    Unreachable,
    InvalidTarget,
    OutOfRange,
    CannotAttack,
    CounterOverflow,
}

impl fmt::Display for GameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::NotStarted => "the first phase has not started",
            Self::AlreadyStarted => "a phase is already active",
            Self::Finished => "the game is finished",
            Self::UnknownUnit => "unknown unit ID",
            Self::WrongFaction => "the unit does not belong to the active faction",
            Self::OrderAlreadyUsed => "previous orders prevent this action",
            Self::EntrenchmentLimit => "entrenchment is already at level 2",
            Self::Unreachable => "destination is not reachable",
            Self::InvalidTarget => "attack requires an enemy unit",
            Self::OutOfRange => "target is outside attack range",
            Self::CannotAttack => "this unit cannot attack",
            Self::CounterOverflow => "state counter overflow",
        };
        f.write_str(message)
    }
}
impl std::error::Error for GameError {}

#[derive(Debug, PartialEq, Eq)]
pub struct GameState {
    scenario: Scenario,
    sides: [FactionId; 2],
    phase: Phase,
    units: BTreeMap<UnitId, UnitState>,
    control_changes: BTreeMap<Hex, FactionId>,
    scores: [u32; 2],
    revision: u64,
    combat_index: u64,
    commands: Vec<GameAction>,
    events: Vec<GameEvent>,
}

impl GameState {
    /// Prepare a NotStarted session directly from the shared scenario validator.
    pub fn load(bytes: &[u8]) -> Result<Self, ScenarioError> {
        let mut state = Self::initial(load_scenario(bytes)?);
        for side in 0..2 {
            state.refresh_supply(side, false);
        }
        Ok(state)
    }
    fn initial(scenario: Scenario) -> Self {
        // The loader guarantees exactly two distinct factions and a valid starting ID.
        let second = usize::from(scenario.factions[0].id == scenario.starting_faction_id);
        let sides = [
            scenario.starting_faction_id.clone(),
            scenario.factions[second].id.clone(),
        ];
        let units = scenario
            .units
            .iter()
            .map(|u| {
                (
                    u.id.clone(),
                    UnitState {
                        faction_id: u.faction_id.clone(),
                        unit_type: u.unit_type,
                        position: u.position(),
                        strength: u.strength,
                        readiness: u.readiness,
                        entrenchment: u.entrenchment,
                        supply: SupplyLevel::None,
                        orders: OrderFlags::default(),
                    },
                )
            })
            .collect();
        Self {
            scenario,
            sides,
            phase: Phase::NotStarted,
            units,
            control_changes: BTreeMap::new(),
            scores: [0, 0],
            revision: 0,
            combat_index: 0,
            commands: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn scenario(&self) -> &Scenario {
        &self.scenario
    }
    pub fn phase(&self) -> &Phase {
        &self.phase
    }
    pub fn state_revision(&self) -> u64 {
        self.revision
    }
    pub fn rng_seed(&self) -> u64 {
        self.scenario.random_seed
    }
    pub fn combat_index(&self) -> u64 {
        self.combat_index
    }
    pub fn units(&self) -> &BTreeMap<UnitId, UnitState> {
        &self.units
    }
    pub fn score(&self, faction: &FactionId) -> Option<u32> {
        self.sides
            .iter()
            .position(|side| side == faction)
            .map(|index| self.scores[index])
    }
    pub fn commands(&self) -> &[GameAction] {
        &self.commands
    }
    pub fn events(&self) -> &[GameEvent] {
        &self.events
    }

    /// Starting the session creates revision zero and records its initial phase.
    pub fn start(&mut self) -> Result<(), GameError> {
        match self.phase {
            Phase::Active { .. } => return Err(GameError::AlreadyStarted),
            Phase::Finished { .. } => return Err(GameError::Finished),
            Phase::NotStarted => {}
        }
        let kind = self.begin_phase(1, 0);
        self.events.push(GameEvent {
            revision: 0,
            order: 0,
            kind,
        });
        Ok(())
    }

    fn begin_phase(&mut self, round: u32, side: usize) -> EventKind {
        self.refresh_supply(side, true);
        let faction = &self.sides[side];
        for unit in self.units.values_mut().filter(|u| u.faction_id == *faction) {
            unit.orders = OrderFlags::default();
        }
        self.phase = Phase::Active {
            round,
            active_faction: faction.clone(),
        };
        EventKind::PhaseStarted {
            round,
            faction: faction.clone(),
        }
    }

    pub fn can_entrench(&self, id: &UnitId) -> Result<(), GameError> {
        let active = match &self.phase {
            Phase::Active { active_faction, .. } => active_faction,
            Phase::NotStarted => return Err(GameError::NotStarted),
            Phase::Finished { .. } => return Err(GameError::Finished),
        };
        let u = self.units.get(id).ok_or(GameError::UnknownUnit)?;
        if &u.faction_id != active {
            return Err(GameError::WrongFaction);
        }
        if u.orders != OrderFlags::default() {
            return Err(GameError::OrderAlreadyUsed);
        }
        if u.entrenchment >= 2 {
            return Err(GameError::EntrenchmentLimit);
        }
        Ok(())
    }
    /// All fallible checks precede writes. One accepted command commits one revision.
    pub fn apply_action(&mut self, action: GameAction) -> Result<ActionResult<'_>, GameError> {
        let (round, side) = match &self.phase {
            Phase::NotStarted => return Err(GameError::NotStarted),
            Phase::Finished { .. } => return Err(GameError::Finished),
            Phase::Active {
                round,
                active_faction,
            } => (*round, usize::from(active_faction == &self.sides[1])),
        };
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(GameError::CounterOverflow)?;
        let facts = match &action {
            GameAction::EndPhase {} => self.end_phase(round, side)?,
            GameAction::Entrench { unit_id } => {
                self.can_entrench(unit_id)?;
                let unit = self.units.get_mut(unit_id).ok_or(GameError::UnknownUnit)?;
                unit.entrenchment += 1;
                unit.orders.entrenched_this_phase = true;
                vec![EventKind::Entrenched {
                    unit_id: unit_id.clone(),
                    level: unit.entrenchment,
                }]
            }
            GameAction::Move {
                unit_id,
                destination,
            } => self.move_unit(unit_id, *destination)?,
            GameAction::Attack {
                attacker_id,
                defender_id,
            } => self.attack(attacker_id, defender_id)?,
        };

        let start = self.events.len();
        self.events.extend(
            facts
                .into_iter()
                .enumerate()
                .map(|(order, kind)| GameEvent {
                    revision,
                    order,
                    kind,
                }),
        );
        self.revision = revision;
        self.commands.push(action);
        Ok(ActionResult {
            state_revision: revision,
            events: &self.events[start..],
        })
    }

    fn end_phase(&mut self, round: u32, side: usize) -> Result<Vec<EventKind>, GameError> {
        let mut facts = vec![EventKind::PhaseEnded {
            round,
            faction: self.sides[side].clone(),
        }];
        if side == 0 {
            facts.push(self.begin_phase(round, 1));
            return Ok(facts);
        }

        facts.push(EventKind::RoundEnded { round });
        let mut scores = self.scores;
        // The scenario validator returns objectives in ID order.
        for objective in &self.scenario.objectives {
            let hex = Hex {
                q: objective.q,
                r: objective.r,
            };
            if let Some(owner) = self.controller(hex) {
                let index = usize::from(owner == &self.sides[1]);
                scores[index] = scores[index]
                    .checked_add(objective.points_per_round)
                    .ok_or(GameError::CounterOverflow)?;
                facts.push(EventKind::ObjectiveScored {
                    objective_id: objective.id.clone(),
                    faction: owner.clone(),
                    points: objective.points_per_round,
                });
            }
        }
        let victory = &self.scenario.victory;
        let reached_target = victory
            .target_score
            .is_some_and(|target| scores.iter().any(|&score| score >= target));
        if reached_target || round >= victory.max_rounds {
            let result = match scores[0].cmp(&scores[1]) {
                Ordering::Equal => Outcome::Draw,
                Ordering::Greater => Outcome::Winner(self.sides[0].clone()),
                Ordering::Less => Outcome::Winner(self.sides[1].clone()),
            };
            self.phase = Phase::Finished {
                round,
                result: result.clone(),
            };
            facts.push(EventKind::GameFinished { round, result });
        } else {
            let next = round.checked_add(1).ok_or(GameError::CounterOverflow)?;
            facts.push(self.begin_phase(next, 0));
        }
        self.scores = scores;
        Ok(facts)
    }
}
