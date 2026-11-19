use game_core::game::GameEvent;
use serde::Serialize;
use wasm_bindgen::{JsCast, prelude::*};

#[wasm_bindgen(typescript_custom_section)]
const TYPES: &str = r#"
export type GameOrder =
 | {type:"move", unit_id:string, destination:CellPosition}
 | {type:"attack", attacker_id:string, defender_id:string}
 | {type:"entrench", unit_id:string} | {type:"end_phase"};
export type GameFact =
 | {type:"phase_started"|"phase_ended",round:number,faction:string}
 | {type:"entrenched",unit_id:string,level:number}
 | {type:"unit_moved",unit_id:string,route:RouteView}
 | {type:"control_changed",at:CellPosition,faction:string}
 | {type:"combat_resolved",attacker:string,defender:string,jitter:[number,number],losses:{attacker:number,defender:number}}
 | {type:"unit_destroyed",unit_id:string}
 | {type:"unit_advanced",unit_id:string,at:CellPosition}
 | {type:"round_ended",round:number}
 | {type:"objective_scored",objective_id:string,faction:string,points:number}
 | {type:"game_finished",round:number,result:"draw"|{winner:string}};
export interface JournalEvent {revision:string; order:number; kind:GameFact}
export interface CommandResult {state_revision:string; events:JournalEvent[]}
"#;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "GameOrder")]
    pub type Order;
    #[wasm_bindgen(typescript_type = "CommandResult")]
    pub type ResultView;
}
#[derive(Serialize)]
struct Batch<'a> {
    state_revision: String,
    events: &'a [GameEvent],
}
pub fn batch(revision: u64, events: &[GameEvent]) -> Result<ResultView, JsError> {
    let value = serde_wasm_bindgen::to_value(&Batch {
        state_revision: revision.to_string(),
        events,
    })?;
    Ok(value.unchecked_into())
}
