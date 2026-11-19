mod movement;
mod orders;
use game_core::{
    Hex,
    scenario::{ScenarioWarning, load_scenario},
};
use wasm_bindgen::prelude::*;

/// Coordinates of axial neighbors in the core's stable direction order.
#[wasm_bindgen]
pub fn hex_neighbors(q: i32, r: i32) -> Vec<i32> {
    Hex { q, r }
        .neighbors()
        .into_iter()
        .flatten()
        .flat_map(|h| [h.q, h.r])
        .collect()
}

#[wasm_bindgen]
pub fn validate_scenario(json: &str) -> Result<Vec<String>, JsError> {
    let scenario = load_scenario(json.as_bytes())?;
    Ok(scenario
        .warnings
        .iter()
        .map(|warning| match warning {
            ScenarioWarning::BlockedSource {
                position,
                controller,
            } => format!(
                "Источник ({}, {}) стороны {} находится в зоне контроля противника.",
                position.q, position.r, controller.0
            ),
            ScenarioWarning::UnreachableTarget { target, maximum } => {
                format!("Целевой счёт {target} выше максимума за все раунды ({maximum}).")
            }
        })
        .collect())
}

#[wasm_bindgen]
pub fn hex_distance(q: i32, r: i32, other_q: i32, other_r: i32) -> u64 {
    Hex { q, r }.distance(Hex {
        q: other_q,
        r: other_r,
    })
}
