use game_core::{
    FactionId, Hex,
    game::{GameAction, GameState, SupplyLevel, supply_level},
    scenario::UnitId,
};
use serde_json::{Value, json};

fn h(q: i32) -> Hex {
    Hex { q, r: 0 }
}
fn id(s: &str) -> UnitId {
    UnitId(s.into())
}
fn side(s: &str) -> FactionId {
    FactionId(s.into())
}
fn unit(name: &str, faction: &str, q: i32, kind: &str) -> Value {
    json!({"id":name,"unit_type":kind,"faction_id":faction,"q":q,"r":0,"strength":10,"readiness":50,"entrenchment":0})
}
fn line(edit: impl FnOnce(&mut Value)) -> GameState {
    let mut s = json!({"schema_version":1,"rules_version":"0.1","historicity":"fictional","id":"line","title":"Supply line","turn_days":1,
        "map":{"width":10,"height":1,"default_terrain":"plain","default_controller":"blue","tiles":[
        {"q":0,"r":0,"supply_source":true},{"q":9,"r":0,"controller":"red","supply_source":true}],"edges":[]},
        "factions":[{"id":"blue","name":"Blue"},{"id":"red","name":"Red"}],
        "units":[unit("a","blue",3,"infantry"),unit("b","red",9,"headquarters")],
        "objectives":[{"id":"o","type":"control","q":3,"r":0,"points_per_round":1}],
        "victory":{"max_rounds":8},"starting_faction_id":"blue","random_seed":"42"});
    edit(&mut s);
    GameState::load(&serde_json::to_vec(&s).unwrap()).unwrap()
}
#[test]
fn weighted_paths_start_at_nearest_valid_source_and_respect_blockers() {
    for (terrain, road, rail, river, bridge, cost) in [
        ("plain", false, false, false, false, 2),
        ("urban", true, false, false, false, 1),
        ("forest", false, true, true, false, 4),
        ("hills", true, false, true, true, 2),
        ("swamp", false, false, true, false, 6),
    ] {
        let g = line(|s| {
            s["map"]["tiles"]
                .as_array_mut()
                .unwrap()
                .push(json!({"q":1,"r":0,"terrain":terrain}));
            s["map"]["edges"] = json!([{"a":[0,0],"b":[1,0],"river":river,"bridge":bridge,"road":road,"rail":rail}]);
        });
        assert_eq!(g.supply_forecast(&side("blue"))[&h(1)], cost);
    }
    let g = line(|s| {
        s["map"]["tiles"].as_array_mut().unwrap().extend([
            json!({"q":7,"r":0,"supply_source":true}),
            json!({"q":5,"r":0,"controller":null}),
            json!({"q":1,"r":0,"terrain":"water"}),
        ])
    });
    let map = g.supply_forecast(&side("blue"));
    assert_eq!(map[&h(6)], 2);
    for q in [1, 2, 3, 4, 5, 9] {
        assert!(!map.contains_key(&h(q)));
    }
    for (cost, level) in [
        (0, SupplyLevel::Full),
        (6, SupplyLevel::Full),
        (7, SupplyLevel::Low),
        (12, SupplyLevel::Low),
        (13, SupplyLevel::None),
    ] {
        assert_eq!(supply_level(Some(cost)), level);
    }
}
#[test]
fn empty_source_in_enemy_zoc_is_blocked_and_friendly_garrison_reopens_it() {
    for guarded in [true, false] {
        let g = line(|s| {
            s["map"]["tiles"]
                .as_array_mut()
                .unwrap()
                .push(json!({"q":1,"r":0,"controller":"red"}));
            s["units"]
                .as_array_mut()
                .unwrap()
                .push(unit("enemy", "red", 1, "infantry"));
            if guarded {
                s["units"]
                    .as_array_mut()
                    .unwrap()
                    .push(unit("guard", "blue", 0, "headquarters"));
            }
        });
        let map = g.supply_forecast(&side("blue"));
        assert_eq!(map.get(&h(0)).copied(), guarded.then_some(0));
        assert!(!map.contains_key(&h(2)));
    }
}
#[test]
fn phase_refresh_is_owner_only_and_forecast_never_changes_saved_level() {
    let mut g = line(|_| {});
    let a = id("a");
    let b = id("b");
    assert_eq!(
        (g.units()[&a].supply, g.units()[&a].readiness),
        (SupplyLevel::Full, 50)
    );
    assert_eq!(
        (g.units()[&b].supply, g.units()[&b].readiness),
        (SupplyLevel::Full, 50)
    );
    assert_eq!(g.supply_forecast(&side("blue"))[&h(4)], 8); // conducts through a at q=3
    g.start().unwrap();
    assert_eq!(g.units()[&a].readiness, 55);
    g.apply_action(GameAction::Move {
        unit_id: a.clone(),
        destination: h(5),
    })
    .unwrap();
    assert_eq!(g.supply_forecast(&side("blue"))[&h(5)], 10);
    assert_eq!(
        (g.units()[&a].supply, g.units()[&a].readiness),
        (SupplyLevel::Full, 50)
    );
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(g.units()[&b].readiness, 55);
    assert_eq!(g.units()[&a].supply, SupplyLevel::Full);
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(
        (g.units()[&a].supply, g.units()[&a].readiness),
        (SupplyLevel::Low, 45)
    );
    assert_eq!(g.units()[&b].readiness, 55);
}
#[test]
fn captured_source_supplies_new_controller_and_cutoff_costs_readiness_only_on_refresh() {
    let mut g = line(|s| {
        s["units"][0]["q"] = json!(8);
        s["units"][1]["q"] = json!(7);
        s["map"]["tiles"]
            .as_array_mut()
            .unwrap()
            .push(json!({"q":7,"r":0,"controller":"red"}));
    });
    let a = id("a");
    let b = id("b");
    g.start().unwrap();
    assert_eq!(
        (g.units()[&a].supply, g.units()[&a].readiness),
        (SupplyLevel::None, 35)
    );
    g.apply_action(GameAction::Move {
        unit_id: a.clone(),
        destination: h(9),
    })
    .unwrap();
    assert_eq!(g.supply_forecast(&side("blue"))[&h(9)], 0);
    assert_eq!(g.units()[&a].supply, SupplyLevel::None);
    let prior = g.units()[&b].readiness;
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(
        (g.units()[&b].supply, g.units()[&b].readiness),
        (SupplyLevel::None, prior - 15)
    );
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(
        (
            g.units()[&a].supply,
            g.units()[&a].readiness,
            g.units()[&a].strength
        ),
        (SupplyLevel::Full, 35, 10)
    );
}
