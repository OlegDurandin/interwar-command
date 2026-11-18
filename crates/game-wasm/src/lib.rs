use game_core::Hex;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn hex_distance(q: i32, r: i32, other_q: i32, other_r: i32) -> u64 {
    Hex { q, r }.distance(Hex {
        q: other_q,
        r: other_r,
    })
}
