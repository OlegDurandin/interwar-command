use super::input::Document;
use super::{
    ErrorCode, Faction, Historicity, Objective, Scenario, ScenarioError, ScenarioWarning, Unit,
    UnitType, Victory,
};
use crate::{FactionId, Hex, Map, Terrain, Tile, map::valid_id};
use std::collections::{BTreeMap, BTreeSet};

fn check_id(id: &str, path: &str) -> Result<(), ScenarioError> {
    if !valid_id(id) {
        return Err(ScenarioError::new(
            ErrorCode::InvalidId,
            path,
            "expected an ID of 1 to 64 characters",
        ));
    }
    Ok(())
}

fn unique_id<'a>(
    id: &'a str,
    seen: &mut BTreeSet<&'a str>,
    path: &str,
) -> Result<(), ScenarioError> {
    check_id(id, path)?;
    if !seen.insert(id) {
        return Err(ScenarioError::new(
            ErrorCode::DuplicateId,
            path,
            "duplicate ID",
        ));
    }
    Ok(())
}

pub(super) fn faction_ref(
    id: &FactionId,
    factions: &[Faction],
    path: &str,
) -> Result<(), ScenarioError> {
    check_id(&id.0, path)?;
    if !factions.iter().any(|f| f.id == *id) {
        return Err(ScenarioError::new(
            ErrorCode::UnknownFaction,
            path,
            "unknown faction ID",
        ));
    }
    Ok(())
}

fn range(path: &str, message: &str) -> ScenarioError {
    ScenarioError::new(ErrorCode::Range, path, message)
}

fn seed(text: &str) -> Result<u64, ScenarioError> {
    if (text == "0" || !text.starts_with('0'))
        && text.bytes().all(|b| b.is_ascii_digit())
        && let Ok(value) = text.parse::<u64>()
    {
        return Ok(value);
    }
    Err(ScenarioError::new(
        ErrorCode::Seed,
        "random_seed",
        "expected a canonical unsigned 64-bit decimal string",
    ))
}

fn calendar_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = text[..4].parse().unwrap_or_default();
    let month = &text[5..7];
    let day: u32 = text[8..].parse().unwrap_or_default();
    let days = match month {
        "01" | "03" | "05" | "07" | "08" | "10" | "12" => 31,
        "04" | "06" | "09" | "11" => 30,
        "02" => {
            28 + u32::from(
                year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)),
            )
        }
        _ => 0,
    };
    (1..=days).contains(&day)
}

fn metadata(raw: &Document) -> Result<(), ScenarioError> {
    if raw.historicity == Historicity::Historical {
        if raw.sources.is_empty() {
            return Err(ScenarioError::new(
                ErrorCode::Metadata,
                "sources",
                "historical scenarios require sources",
            ));
        }
        if raw.historical_context.is_none() {
            return Err(ScenarioError::new(
                ErrorCode::Metadata,
                "historical_context",
                "historical context is required",
            ));
        }
    }
    for (i, source) in raw.sources.iter().enumerate() {
        if source.trim().is_empty() {
            return Err(ScenarioError::new(
                ErrorCode::Metadata,
                format!("sources[{i}]"),
                "empty source",
            ));
        }
    }
    if let Some(context) = &raw.historical_context {
        if !calendar_date(&context.map_date) {
            return Err(ScenarioError::new(
                ErrorCode::Metadata,
                "historical_context.map_date",
                "invalid calendar date",
            ));
        }
        for (field, value) in [
            ("hex_scale", &context.hex_scale),
            ("formation_scale", &context.formation_scale),
            ("assumptions", &context.assumptions),
            ("review_version", &context.review_version),
        ] {
            if value.trim().is_empty() {
                return Err(ScenarioError::new(
                    ErrorCode::Metadata,
                    format!("historical_context.{field}"),
                    "empty metadata",
                ));
            }
        }
    }
    Ok(())
}

fn land<'a>(map: &'a Map, h: Hex, path: &str) -> Result<&'a Tile, ScenarioError> {
    let tile = map.tile(h).ok_or_else(|| {
        let axis = if (0..map.width()).contains(&h.q) {
            "r"
        } else {
            "q"
        };
        ScenarioError::new(
            ErrorCode::Coordinate,
            format!("{path}.{axis}"),
            "coordinate outside map",
        )
    })?;
    if tile.terrain == Terrain::Water {
        return Err(ScenarioError::new(
            ErrorCode::Water,
            path,
            "expected a land cell",
        ));
    }
    Ok(tile)
}

fn unit_positions<'a>(
    units: &'a [Unit],
    factions: &[Faction],
    map: &Map,
) -> Result<BTreeMap<Hex, &'a Unit>, ScenarioError> {
    let mut positions = BTreeMap::new();
    let mut ids = BTreeSet::new();
    for (i, unit) in units.iter().enumerate() {
        let path = format!("units[{i}]");
        unique_id(&unit.id.0, &mut ids, &format!("{path}.id"))?;
        faction_ref(&unit.faction_id, factions, &format!("{path}.faction_id"))?;
        let h = unit.position();
        let tile = land(map, h, &path)?;
        if tile.controller.as_ref() != Some(&unit.faction_id) {
            return Err(ScenarioError::new(
                ErrorCode::ControllerMismatch,
                format!("{path}.faction_id"),
                "unit must start on its faction's tile",
            ));
        }
        if positions.insert(h, unit).is_some() {
            return Err(ScenarioError::new(
                ErrorCode::Occupied,
                path,
                "two units on one tile",
            ));
        }
        if !(1..=10).contains(&unit.strength) {
            return Err(range(&format!("{path}.strength"), "expected 1..=10"));
        }
        if unit.readiness > 100 {
            return Err(range(&format!("{path}.readiness"), "expected 0..=100"));
        }
        if unit.entrenchment > 2 {
            return Err(range(&format!("{path}.entrenchment"), "expected 0..=2"));
        }
    }
    Ok(positions)
}

fn check_sources(
    map: &Map,
    factions: &[Faction],
    units: &BTreeMap<Hex, &Unit>,
    warnings: &mut Vec<ScenarioWarning>,
) -> Result<(), ScenarioError> {
    let mut supplied = BTreeSet::new();
    for (h, tile) in map.tiles().filter(|(_, t)| t.supply_source) {
        let Some(owner) = &tile.controller else {
            continue;
        };
        supplied.insert(owner.0.as_str());
        // All occupants already match the tile controller. A garrison keeps a source open.
        if !units.contains_key(&h)
            && map.neighbors(h).any(|n| {
                units.get(&n).is_some_and(|u| {
                    u.faction_id != *owner && u.unit_type != UnitType::Headquarters
                })
            })
        {
            warnings.push(ScenarioWarning::BlockedSource {
                position: h,
                controller: owner.clone(),
            });
        }
    }
    for (i, faction) in factions.iter().enumerate() {
        if !supplied.contains(faction.id.0.as_str()) {
            return Err(ScenarioError::new(
                ErrorCode::MissingSource,
                format!("factions[{i}].id"),
                "faction has no controlled supply source",
            ));
        }
    }
    Ok(())
}

fn check_victory(
    objectives: &[Objective],
    victory: &Victory,
    map: &Map,
    warnings: &mut Vec<ScenarioWarning>,
) -> Result<(), ScenarioError> {
    if !(1..=10000).contains(&victory.max_rounds) {
        return Err(range("victory.max_rounds", "expected 1..=10000"));
    }
    let mut ids = BTreeSet::new();
    let mut positions = BTreeSet::new();
    let mut per_round = 0u32;
    for (i, obj) in objectives.iter().enumerate() {
        let path = format!("objectives[{i}]");
        unique_id(&obj.id, &mut ids, &format!("{path}.id"))?;
        let h = Hex { q: obj.q, r: obj.r };
        land(map, h, &path)?;
        if !positions.insert(h) {
            return Err(ScenarioError::new(
                ErrorCode::Occupied,
                path,
                "two objectives on one tile",
            ));
        }
        if !(1..=1000).contains(&obj.points_per_round) {
            return Err(range(
                &format!("{path}.points_per_round"),
                "expected 1..=1000",
            ));
        }
        per_round += obj.points_per_round; // At most 256 objectives.
    }
    let maximum = per_round
        .checked_mul(victory.max_rounds)
        .ok_or_else(|| range("victory.max_rounds", "potential score exceeds u32"))?;
    if let Some(target) = victory.target_score {
        if target == 0 {
            return Err(range("victory.target_score", "target must be positive"));
        }
        if target > maximum {
            warnings.push(ScenarioWarning::UnreachableTarget { target, maximum });
        }
    }
    Ok(())
}

pub(super) fn scenario(mut raw: Document) -> Result<Scenario, ScenarioError> {
    if raw.schema_version != 1 {
        return Err(ScenarioError::new(
            ErrorCode::Version,
            "schema_version",
            "expected version 1",
        ));
    }
    if raw.rules_version != "0.1" {
        return Err(ScenarioError::new(
            ErrorCode::Version,
            "rules_version",
            "expected rules 0.1",
        ));
    }
    let random_seed = seed(&raw.random_seed)?;
    check_id(&raw.id, "id")?;
    if raw.turn_days == 0 {
        return Err(range("turn_days", "turn length must be positive"));
    }
    metadata(&raw)?;
    if raw.factions.len() != 2 {
        return Err(range("factions", "expected two factions"));
    }
    if raw.units.len() > 2048 {
        return Err(range("units", "at most 2048 units"));
    }
    if !(1..=256).contains(&raw.objectives.len()) {
        return Err(range("objectives", "expected 1..=256 objectives"));
    }
    let mut ids = BTreeSet::new();
    for (i, faction) in raw.factions.iter().enumerate() {
        unique_id(&faction.id.0, &mut ids, &format!("factions[{i}].id"))?;
    }
    faction_ref(
        &raw.starting_faction_id,
        &raw.factions,
        "starting_faction_id",
    )?;
    let map = raw.map.normalize(&raw.factions)?;
    let units = unit_positions(&raw.units, &raw.factions, &map)?;
    let mut warnings = Vec::new();
    check_sources(&map, &raw.factions, &units, &mut warnings)?;
    check_victory(&raw.objectives, &raw.victory, &map, &mut warnings)?;
    raw.factions.sort_by(|a, b| a.id.0.cmp(&b.id.0));
    raw.units.sort_by(|a, b| a.id.0.cmp(&b.id.0));
    raw.objectives.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Scenario {
        id: raw.id,
        title: raw.title,
        historicity: raw.historicity,
        turn_days: raw.turn_days,
        description: raw.description,
        period: raw.period,
        sources: raw.sources,
        languages: raw.languages,
        historical_context: raw.historical_context,
        map,
        factions: raw.factions,
        units: raw.units,
        objectives: raw.objectives,
        victory: raw.victory,
        starting_faction_id: raw.starting_faction_id,
        random_seed,
        warnings,
    })
}
