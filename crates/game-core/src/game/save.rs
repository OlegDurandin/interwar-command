use super::*;
use crate::{Terrain, scenario::Scenario};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const SAVE_VERSION: u32 = 1;
const RULES: &str = "0.1";
const MAX_SAVE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug)]
pub enum SaveError {
    Json(serde_json::Error),
    Scenario(ScenarioError),
    Action(GameError),
    Invalid(&'static str),
}
impl fmt::Display for SaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(e) => write!(f, "invalid save JSON: {e}"),
            Self::Scenario(e) => write!(f, "embedded scenario: {e}"),
            Self::Action(e) => write!(f, "replay: {e}"),
            Self::Invalid(msg) => f.write_str(msg),
        }
    }
}
impl std::error::Error for SaveError {}
impl From<serde_json::Error> for SaveError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}
impl From<ScenarioError> for SaveError {
    fn from(e: ScenarioError) -> Self {
        Self::Scenario(e)
    }
}
impl From<GameError> for SaveError {
    fn from(e: GameError) -> Self {
        Self::Action(e)
    }
}

pub(super) mod decimal {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let raw = String::deserialize(d)?;
        let v = raw.parse::<u64>().map_err(D::Error::custom)?;
        if v.to_string() != raw {
            return Err(D::Error::custom("expected canonical decimal u64"));
        }
        Ok(v)
    }
}

impl Scenario {
    fn canonical_document(&self) -> Value {
        let tiles: Vec<_> = self
            .map
            .tiles()
            .map(|(p, t)| {
                json!({"q":p.q,"r":p.r,"terrain":t.terrain,
            "controller":t.controller,"city_id":t.city_id,"supply_source":t.supply_source})
            })
            .collect();
        let edges:Vec<_>=self.map.edges().filter(|e|e.features!=Default::default()).map(|e|json!({"a":[e.a.q,e.a.r],"b":[e.b.q,e.b.r],
            "river":e.features.river,"bridge":e.features.bridge,"road":e.features.road,"rail":e.features.rail})).collect();
        json!({"schema_version":1,"rules_version":RULES,"id":self.id,"title":self.title,"historicity":self.historicity,
            "turn_days":self.turn_days,"description":self.description,"period":self.period,"languages":self.languages,
            "sources":self.sources,"historical_context":self.historical_context,"factions":self.factions,"units":self.units,
            "objectives":self.objectives,"victory":self.victory,"starting_faction_id":self.starting_faction_id,
            "random_seed":self.random_seed.to_string(),"map":{"width":self.map.width(),"height":self.map.height(),
            "default_terrain":"plain","default_controller":null,"tiles":tiles,"edges":edges}})
    }
}
fn hash(value: &Value) -> String {
    let mut value = value.clone();
    value.sort_all_objects();
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveFile {
    save_schema_version: u32,
    rules_version: String,
    scenario_id: String,
    scenario_content_hash: String,
    scenario: Value,
    state: Value,
    state_hash: String,
    commands: Vec<GameAction>,
    events: Vec<GameEvent>,
    history_hash: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    save_schema_version: u32,
    rules_version: String,
    scenario_content_hash: String,
    phase: Phase,
    controllers: Vec<Option<FactionId>>,
    units: BTreeMap<UnitId, UnitState>,
    scores: BTreeMap<String, u32>,
    #[serde(with = "decimal")]
    rng_seed: u64,
    #[serde(with = "decimal")]
    combat_index: u64,
    #[serde(with = "decimal")]
    state_revision: u64,
}

impl GameState {
    fn canonical_state(&self, scenario_hash: &str) -> Value {
        let controllers: Vec<_> = self
            .scenario
            .map
            .tiles()
            .map(|(h, _)| self.controller(h))
            .collect();
        let scores: BTreeMap<_, _> = self
            .sides
            .iter()
            .zip(self.scores)
            .map(|(f, s)| (&f.0, s))
            .collect();
        json!({"save_schema_version":SAVE_VERSION,"rules_version":RULES,"scenario_content_hash":scenario_hash,
            "phase":self.phase,"controllers":controllers,"units":self.units,"scores":scores,"rng_seed":self.rng_seed().to_string(),
            "combat_index":self.combat_index.to_string(),"state_revision":self.revision.to_string()})
    }
    pub fn state_hash(&self) -> String {
        hash(&self.canonical_state(&hash(&self.scenario.canonical_document())))
    }
    pub fn serialize_save(&self) -> Result<String, SaveError> {
        if self.phase == Phase::NotStarted {
            return Err(GameError::NotStarted.into());
        }
        let scenario = self.scenario.canonical_document();
        let scenario_hash = hash(&scenario);
        let state = self.canonical_state(&scenario_hash);
        let history = json!([self.commands, self.events]);
        let file=json!({"save_schema_version":SAVE_VERSION,"rules_version":RULES,"scenario_id":self.scenario.id,
            "scenario_content_hash":scenario_hash,"scenario":scenario,"state_hash":hash(&state),"state":state,
            "commands":history[0],"events":history[1],"history_hash":hash(&history)}).to_string();
        if file.len() > MAX_SAVE_BYTES {
            return Err(SaveError::Invalid("save exceeds 64 MiB"));
        }
        Ok(file)
    }
    pub fn replay(bytes: &[u8], commands: &[GameAction]) -> Result<Self, SaveError> {
        let mut g = Self::load(bytes)?;
        g.start()?;
        for action in commands {
            g.apply_action(action.clone())?;
        }
        Ok(g)
    }
    pub fn load_save(bytes: &[u8]) -> Result<Self, SaveError> {
        if bytes.len() > MAX_SAVE_BYTES {
            return Err(SaveError::Invalid("save exceeds 64 MiB"));
        }
        let file: SaveFile = serde_json::from_slice(bytes)?;
        if file.save_schema_version != SAVE_VERSION || file.rules_version != RULES {
            return Err(SaveError::Invalid("unsupported save or rules version"));
        }
        let scenario = crate::scenario::load_embedded(file.scenario)?;
        if scenario.id != file.scenario_id
            || hash(&scenario.canonical_document()) != file.scenario_content_hash
        {
            return Err(SaveError::Invalid("embedded scenario checksum mismatch"));
        }
        if hash(&file.state) != file.state_hash
            || hash(&json!([file.commands, file.events])) != file.history_hash
        {
            return Err(SaveError::Invalid("save checksum mismatch"));
        }
        let snap: Snapshot = serde_json::from_value(file.state)?;
        if snap.save_schema_version != SAVE_VERSION
            || snap.rules_version != RULES
            || snap.scenario_content_hash != file.scenario_content_hash
            || snap.rng_seed != scenario.random_seed
            || snap.state_revision != file.commands.len() as u64
            || snap.combat_index
                != file
                    .commands
                    .iter()
                    .filter(|a| matches!(a, GameAction::Attack { .. }))
                    .count() as u64
        {
            return Err(SaveError::Invalid("snapshot and history disagree"));
        }
        let mut game = Self::initial(scenario);
        game.restore(snap)?;
        game.validate_turn_history(&file.commands, &file.events)?;
        let mut expected_revision = 0;
        let mut expected_order = 0;
        for e in &file.events {
            if e.revision == expected_revision + 1 && expected_order > 0 {
                expected_revision += 1;
                expected_order = 0;
            }
            if e.revision != expected_revision || e.order != expected_order {
                return Err(SaveError::Invalid("invalid event order"));
            }
            expected_order += 1;
        }
        if expected_order == 0 || expected_revision != game.revision {
            return Err(SaveError::Invalid("incomplete event log"));
        }
        game.commands = file.commands;
        game.events = file.events;
        Ok(game)
    }
    fn validate_turn_history(
        &self,
        commands: &[GameAction],
        events: &[GameEvent],
    ) -> Result<(), SaveError> {
        let bad = || SaveError::Invalid("phase or score conflicts with the command log");
        let ends = commands
            .iter()
            .filter(|a| matches!(a, GameAction::EndPhase {}))
            .count();
        let completed = u32::try_from(ends / 2).map_err(|_| bad())?;
        let target = self
            .scenario
            .victory
            .target_score
            .is_some_and(|n| self.scores.iter().any(|&s| s >= n));
        let done = completed >= self.scenario.victory.max_rounds || target;
        let phase_ok = match &self.phase {
            Phase::Active {
                round,
                active_faction,
            } => {
                !done
                    && completed.checked_add(1) == Some(*round)
                    && &self.sides[ends % 2] == active_faction
            }
            Phase::Finished { round, result } => {
                let winner = match self.scores[0].cmp(&self.scores[1]) {
                    Ordering::Less => Outcome::Winner(self.sides[1].clone()),
                    Ordering::Greater => Outcome::Winner(self.sides[0].clone()),
                    Ordering::Equal => Outcome::Draw,
                };
                done && ends.is_multiple_of(2) && *round == completed && result == &winner
            }
            Phase::NotStarted => false,
        };
        if !phase_ok {
            return Err(bad());
        }
        let mut scores = [0u32; 2];
        for event in events {
            if let EventKind::ObjectiveScored {
                objective_id,
                faction,
                points,
            } = &event.kind
            {
                let i = self
                    .sides
                    .iter()
                    .position(|f| f == faction)
                    .ok_or_else(bad)?;
                if !self
                    .scenario
                    .objectives
                    .iter()
                    .any(|o| o.id == *objective_id && o.points_per_round == *points)
                {
                    return Err(bad());
                }
                scores[i] = scores[i].checked_add(*points).ok_or_else(bad)?;
            }
        }
        if scores != self.scores {
            return Err(bad());
        }
        Ok(())
    }

    fn restore(&mut self, snap: Snapshot) -> Result<(), SaveError> {
        let invalid = || SaveError::Invalid("invalid snapshot");
        let valid_side = |f: &FactionId| self.sides.contains(f);
        let max = self.scenario.victory.max_rounds;
        let round = match &snap.phase {
            Phase::Active {
                round,
                active_faction,
            } if valid_side(active_faction) => *round,
            Phase::Finished { round, result }
                if match result {
                    Outcome::Draw => true,
                    Outcome::Winner(f) => valid_side(f),
                } =>
            {
                *round
            }
            _ => return Err(invalid()),
        };
        if !(1..=max).contains(&round)
            || snap.scores.len() != 2
            || snap.controllers.len() != self.scenario.map.tiles().count()
        {
            return Err(invalid());
        }
        for ((h, t), owner) in self.scenario.map.tiles().zip(snap.controllers) {
            if owner.as_ref().is_some_and(|f| !valid_side(f)) {
                return Err(invalid());
            }
            if owner != t.controller {
                if t.terrain == Terrain::Water {
                    return Err(invalid());
                }
                self.control_changes.insert(h, owner.ok_or_else(invalid)?);
            }
        }
        let mut occupied = BTreeSet::new();
        for (id, u) in &snap.units {
            let original = self.units.get(id).ok_or_else(invalid)?;
            if u.faction_id != original.faction_id
                || u.unit_type != original.unit_type
                || !(1..=original.strength).contains(&u.strength)
                || u.readiness > 100
                || u.entrenchment > 2
                || (u.orders.entrenched_this_phase
                    && (u.orders.attacked_this_phase
                        || u.orders.moved_this_phase
                        || u.entrenchment == 0))
                || ((u.orders.attacked_this_phase || u.orders.moved_this_phase)
                    && u.entrenchment != 0)
                || self
                    .scenario
                    .map
                    .tile(u.position)
                    .is_none_or(|t| t.terrain == Terrain::Water)
                || self.controller(u.position) != Some(&u.faction_id)
                || !occupied.insert(u.position)
            {
                return Err(invalid());
            }
        }
        for (i, f) in self.sides.iter().enumerate() {
            self.scores[i] = *snap.scores.get(&f.0).ok_or_else(invalid)?;
        }
        self.phase = snap.phase;
        self.units = snap.units;
        self.revision = snap.state_revision;
        self.combat_index = snap.combat_index;
        Ok(())
    }
}

#[cfg(test)]
mod decimal_tests {
    use super::decimal;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    struct Counter(#[serde(with = "decimal")] u64);
    #[test]
    fn counters_above_javascript_integer_precision_are_canonical_strings() {
        for v in [0, 9_007_199_254_740_993, u64::MAX] {
            let json = serde_json::to_string(&Counter(v)).unwrap();
            assert_eq!(json, format!("\"{v}\""));
            assert_eq!(serde_json::from_str::<Counter>(&json).unwrap().0, v);
        }
        for bad in ["1", r#""00""#, r#""+1""#, r#""18446744073709551616""#] {
            assert!(serde_json::from_str::<Counter>(bad).is_err());
        }
    }
}
