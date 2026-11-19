//! Loading and validating v1 scenario documents (SPEC §12.2).
mod input;
mod validate;

use crate::{FactionId, Hex, Map, MapErrorKind};
use serde::Deserialize;
use std::fmt;

pub const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Historicity {
    Fictional,
    Inspired,
    Historical,
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoricalContext {
    pub map_date: String,
    pub hex_scale: String,
    pub formation_scale: String,
    pub assumptions: String,
    pub review_version: String,
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Faction {
    pub id: FactionId,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, serde::Serialize)]
#[serde(transparent)]
pub struct UnitId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitType {
    Infantry,
    Cavalry,
    Artillery,
    Headquarters,
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub id: UnitId,
    pub faction_id: FactionId,
    pub unit_type: UnitType,
    pub q: i32,
    pub r: i32,
    pub strength: u8,
    pub readiness: u8,
    pub entrenchment: u8,
    pub name: Option<String>,
    pub historical_id: Option<String>,
    pub experience: Option<u32>,
}
impl Unit {
    pub fn position(&self) -> Hex {
        Hex {
            q: self.q,
            r: self.r,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveType {
    Control,
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Objective {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ObjectiveType,
    pub q: i32,
    pub r: i32,
    pub points_per_round: u32,
}

#[derive(Debug, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Victory {
    pub max_rounds: u32,
    #[serde(
        default,
        deserialize_with = "input::provided",
        skip_serializing_if = "Option::is_none"
    )]
    pub target_score: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Scenario {
    pub id: String,
    pub title: String,
    pub historicity: Historicity,
    pub description: Option<String>,
    pub period: Option<String>,
    pub languages: Vec<String>,
    pub sources: Vec<String>,
    pub historical_context: Option<HistoricalContext>,
    pub turn_days: u32,
    pub factions: Vec<Faction>,
    pub map: Map,
    pub units: Vec<Unit>,
    pub objectives: Vec<Objective>,
    pub victory: Victory,
    pub starting_faction_id: FactionId,
    pub random_seed: u64,
    pub warnings: Vec<ScenarioWarning>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ScenarioWarning {
    BlockedSource {
        position: Hex,
        controller: FactionId,
    },
    UnreachableTarget {
        target: u32,
        maximum: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    SizeLimit,
    Json,
    Version,
    InvalidId,
    DuplicateId,
    UnknownFaction,
    Range,
    Coordinate,
    Water,
    Occupied,
    ControllerMismatch,
    MissingSource,
    Metadata,
    Seed,
    Map(MapErrorKind),
}

#[derive(Debug)]
pub struct ScenarioError {
    pub code: ErrorCode,
    pub path: String,
    pub message: String,
}

impl ScenarioError {
    fn new(code: ErrorCode, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for ScenarioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?} at {}: {}", self.code, self.path, self.message)
    }
}
impl std::error::Error for ScenarioError {}

/// The enclosing save has already enforced its byte limit. The expanded canonical map
/// may be larger than the original compact scenario document.
pub(crate) fn load_embedded(value: serde_json::Value) -> Result<Scenario, ScenarioError> {
    let raw = serde_json::from_value(value)
        .map_err(|e| ScenarioError::new(ErrorCode::Json, "scenario", e.to_string()))?;
    validate::scenario(raw)
}

/// Parse one complete UTF-8 JSON document. Successful results have a normalized
/// map and deterministic entity order. Diagnostics refer to original input indices.
pub fn load_scenario(bytes: &[u8]) -> Result<Scenario, ScenarioError> {
    if bytes.len() > MAX_JSON_BYTES {
        return Err(ScenarioError::new(
            ErrorCode::SizeLimit,
            "$",
            "JSON exceeds 16 MiB",
        ));
    }
    let mut reader = serde_json::Deserializer::from_slice(bytes);
    let raw = serde_path_to_error::deserialize(&mut reader).map_err(|error| {
        let mut path = error.path().to_string();
        let message = error.inner().to_string();
        // Serde reports missing and repeated fields on the containing object.
        if let Some(field) = message
            .strip_prefix("missing field `")
            .or_else(|| message.strip_prefix("duplicate field `"))
            .and_then(|s| s.split('`').next())
        {
            if path == "." {
                path.clear();
            }
            if !path.is_empty() {
                path.push('.');
            }
            path.push_str(field);
        }
        if path.is_empty() || path == "." {
            path = "$".into();
        }
        ScenarioError::new(ErrorCode::Json, path, message)
    })?;
    reader
        .end()
        .map_err(|e| ScenarioError::new(ErrorCode::Json, "$", e.to_string()))?;
    validate::scenario(raw)
}
