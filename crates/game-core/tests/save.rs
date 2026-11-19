use game_core::{
    Hex,
    game::{GameAction, GameState, Phase},
    scenario::UnitId,
};
use serde_json::{Value, json};
const CROSSING: &[u8] = include_bytes!("../../../content/scenarios/crossing.json");
fn id(s: &str) -> UnitId {
    UnitId(s.into())
}
fn opening() -> Vec<GameAction> {
    vec![
        GameAction::Move {
            unit_id: id("west_cav"),
            destination: Hex { q: 4, r: 2 },
        },
        GameAction::Attack {
            attacker_id: id("west_cav"),
            defender_id: id("east_inf"),
        },
        GameAction::EndPhase {},
        GameAction::Entrench {
            unit_id: id("east_inf"),
        },
        GameAction::EndPhase {},
    ]
}
#[test]
fn replay_save_and_resume_at_every_revision_through_victory() {
    let mut live = GameState::replay(CROSSING, &[]).unwrap();
    let mut actions = opening();
    actions.extend((0..10).map(|_| GameAction::EndPhase {}));
    for (i, a) in actions.iter().enumerate() {
        let mut restored = GameState::load_save(live.serialize_save().unwrap().as_bytes()).unwrap();
        assert_eq!(live, restored);
        live.apply_action(a.clone()).unwrap();
        restored.apply_action(a.clone()).unwrap();
        assert_eq!(live, restored);
        assert_eq!(live, GameState::replay(CROSSING, &actions[..=i]).unwrap());
    }
    assert!(matches!(live.phase(), Phase::Finished { .. }));
    assert_eq!(
        live,
        GameState::load_save(live.serialize_save().unwrap().as_bytes()).unwrap()
    );
}
#[test]
fn crossing_hashes_and_journal_have_a_stable_golden_value() {
    let g = GameState::replay(CROSSING, &opening()).unwrap();
    let doc: Value = serde_json::from_str(&g.serialize_save().unwrap()).unwrap();
    let golden: Value = serde_json::from_str(include_str!("crossing-replay.json")).unwrap();
    for key in [
        "commands",
        "scenario_content_hash",
        "state_hash",
        "history_hash",
    ] {
        assert_eq!(doc[key], golden[key], "{key}");
    }
    assert_eq!(doc["state"]["combat_index"], "1");
    assert_eq!(doc["state"]["state_revision"], "5");
}
#[test]
fn normalization_and_tampered_saves() {
    let mut data: Value = serde_json::from_slice(CROSSING).unwrap();
    data["random_seed"] = json!(u64::MAX.to_string());
    let make = |d: &Value| GameState::replay(&serde_json::to_vec(d).unwrap(), &opening()).unwrap();
    let a = make(&data);
    for field in ["units", "factions", "objectives"] {
        data[field].as_array_mut().unwrap().reverse();
    }
    for field in ["tiles", "edges"] {
        data["map"][field].as_array_mut().unwrap().reverse();
    }
    for e in data["map"]["edges"].as_array_mut().unwrap() {
        let left = e["a"].clone();
        e["a"] = e["b"].clone();
        e["b"] = left;
    }
    assert_eq!(a.state_hash(), make(&data).state_hash());
    data["units"][0]["strength"] = json!(8);
    assert_ne!(a.state_hash(), make(&data).state_hash());
    let file: Value = serde_json::from_str(&a.serialize_save().unwrap()).unwrap();
    assert_eq!(
        GameState::load_save(&serde_json::to_vec(&file).unwrap()).unwrap(),
        a
    );
    for (path, value) in [
        ("/state/rng_seed", json!(u64::MAX)),
        ("/state/units/west_cav/strength", json!(1)),
        ("/save_schema_version", json!(2)),
        ("/rules_version", json!("unknown")),
        ("/scenario/title", json!("Edited")),
        ("/commands/0/unit_id", json!("missing")),
        ("/events/0/revision", json!("00")),
    ] {
        let mut bad = file.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(
            GameState::load_save(&serde_json::to_vec(&bad).unwrap()).is_err(),
            "{path}"
        );
    }
    assert!(
        GameState::replay(
            CROSSING,
            &[GameAction::Entrench {
                unit_id: id("missing")
            }]
        )
        .is_err()
    );
}
