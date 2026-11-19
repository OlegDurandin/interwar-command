use game_core::{
    FactionId, Hex,
    game::{EventKind, GameAction, GameError, GameState},
    scenario::UnitId,
};
use serde_json::{Value, json};

fn h(q: i32, r: i32) -> Hex {
    Hex { q, r }
}
fn id() -> UnitId {
    UnitId("u".into())
}
fn step(dest: Hex) -> GameAction {
    GameAction::Move {
        unit_id: id(),
        destination: dest,
    }
}
fn state(edit: impl FnOnce(&mut Value)) -> GameState {
    let mut s = json!({"schema_version":1,"rules_version":"0.1","historicity":"fictional","id":"m","title":"Movement","turn_days":1,
        "map":{"width":6,"height":4,"default_terrain":"plain","default_controller":"blue","tiles":[
            {"q":0,"r":0,"supply_source":true},{"q":5,"r":3,"controller":"red","supply_source":true}],"edges":[]},
        "factions":[{"id":"blue","name":"Blue"},{"id":"red","name":"Red"}],
        "units":[{"id":"u","unit_type":"infantry","faction_id":"blue","q":1,"r":1,"readiness":0,"strength":10,"entrenchment":2}],
        "objectives":[{"id":"o","type":"control","q":3,"r":1,"points_per_round":2}],
        "victory":{"max_rounds":8},"starting_faction_id":"blue","random_seed":"42"});
    edit(&mut s);
    let mut game = GameState::load(&serde_json::to_vec(&s).unwrap()).unwrap();
    game.start().unwrap();
    game
}
fn tile(s: &mut Value, v: Value) {
    s["map"]["tiles"].as_array_mut().unwrap().push(v);
}
fn add_unit(s: &mut Value, q: i32, r: i32, faction: &str, kind: &str) {
    let mut u = s["units"][0].clone();
    u["id"] = json!(format!("extra_{q}_{r}"));
    u["q"] = json!(q);
    u["r"] = json!(r);
    u["unit_type"] = json!(kind);
    u["faction_id"] = json!(faction);
    s["units"].as_array_mut().unwrap().push(u);
    tile(s, json!({"q":q,"r":r,"controller":faction}));
}

#[test]
fn move_captures_entire_canonical_route_and_scoring_reads_live_control() {
    let mut g = state(|s| {
        tile(s, json!({"q":2,"r":1,"controller":null}));
        tile(s, json!({"q":3,"r":1,"controller":"red"}));
    });
    let reachable = g.reachable(&id()).unwrap();
    let dest = h(3, 1);
    assert_eq!(reachable[&dest].path, [h(1, 1), h(2, 1), dest]);
    let batch = g.apply_action(step(dest)).unwrap();
    assert_eq!(batch.state_revision, 1);
    assert!(
        matches!(&batch.events[0].kind, EventKind::UnitMoved{route,..} if route==&reachable[&dest])
    );
    assert_eq!(batch.events.len(), 3);
    let u = &g.units()[&id()];
    assert_eq!((u.position, u.entrenchment, u.readiness), (dest, 0, 0));
    assert!(u.orders.moved_this_phase);
    assert_eq!(g.controller(h(2, 1)), Some(&FactionId("blue".into())));
    assert_eq!(
        g.scenario().map.tile(dest).unwrap().controller,
        Some(FactionId("red".into()))
    );
    assert_eq!(
        g.apply_action(step(h(4, 1))).unwrap_err(),
        GameError::OrderAlreadyUsed
    );
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(g.reachable(&id()).unwrap_err(), GameError::WrongFaction);
    g.apply_action(GameAction::EndPhase {}).unwrap();
    assert_eq!(g.score(&FactionId("blue".into())), Some(2));
    assert!(g.reachable(&id()).is_ok());
}

#[test]
fn tie_break_is_cost_then_row_then_column_and_budgets_depend_on_type() {
    let g = state(|_| {});
    assert_eq!(
        g.reachable(&id()).unwrap()[&h(2, 2)].path,
        [h(1, 1), h(2, 1), h(2, 2)]
    );
    for (kind, mp) in [
        ("infantry", 3),
        ("cavalry", 4),
        ("artillery", 2),
        ("headquarters", 3),
    ] {
        let g = state(|s| s["units"][0]["unit_type"] = json!(kind));
        let routes = g.reachable(&id()).unwrap();
        assert_eq!(routes.values().map(|r| r.cost).max(), Some(mp));
    }
}

#[test]
fn terrain_roads_rail_and_river_costs_are_combined_on_the_crossed_edge() {
    for (terrain, river, bridge, road, rail, cost) in [
        ("plain", false, false, false, false, 1),
        ("urban", false, false, false, false, 1),
        ("hills", false, false, false, false, 2),
        ("forest", false, false, false, false, 2),
        ("swamp", false, false, false, false, 3),
        ("swamp", true, false, true, false, 2),
        ("hills", true, true, false, true, 1),
        ("forest", true, false, false, false, 3),
    ] {
        let g = state(|s| {
            tile(s, json!({"q":2,"r":1,"terrain":terrain}));
            s["map"]["edges"] = json!([{"a":[1,1],"b":[2,1],"river":river,"bridge":bridge,"road":road,"rail":rail}]);
        });
        assert_eq!(g.reachable(&id()).unwrap()[&h(2, 1)].cost, cost);
    }
}

#[test]
fn occupied_water_outside_and_origin_are_rejected_without_side_effects() {
    let build = || {
        state(|s| {
            add_unit(s, 2, 1, "blue", "infantry");
            add_unit(s, 1, 2, "red", "headquarters");
            tile(s, json!({"q":1,"r":0,"terrain":"water"}));
        })
    };
    let mut g = build();
    let expected = build();
    let routes = g.reachable(&id()).unwrap();
    for dest in [h(2, 1), h(1, 2), h(1, 0), h(1, 1), h(-1, 0)] {
        assert!(!routes.contains_key(&dest));
        assert_eq!(
            g.apply_action(step(dest)).unwrap_err(),
            GameError::Unreachable
        );
        assert_eq!(g, expected);
    }
    for route in routes.values() {
        assert!(
            !route
                .path
                .iter()
                .any(|p| [h(2, 1), h(1, 2), h(1, 0)].contains(p))
        );
    }
}

#[test]
fn zoc_is_terminal_allows_exit_and_forbids_direct_zoc_to_zoc() {
    let g = state(|s| add_unit(s, 2, 1, "red", "artillery"));
    let routes = g.reachable(&id()).unwrap();
    assert_eq!(routes[&h(0, 1)].cost, 1);
    // (2,0) is also in enemy ZOC: a legal detour through (1,0) is necessary.
    assert_eq!(routes[&h(2, 0)].path, [h(1, 1), h(1, 0), h(2, 0)]);
    for route in routes.values() {
        for hex in route.path.iter().skip(1).take(route.path.len() - 2) {
            assert!(hex.distance(h(2, 1)) > 1);
        }
    }
    let hq = state(|s| add_unit(s, 2, 1, "red", "headquarters"));
    assert_eq!(hq.reachable(&id()).unwrap()[&h(2, 0)].cost, 1);
}
