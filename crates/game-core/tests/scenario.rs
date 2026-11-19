use game_core::scenario::{
    ErrorCode, Historicity, MAX_JSON_BYTES, Scenario, ScenarioWarning, load_scenario,
};
use game_core::{FactionId, Hex, MapErrorKind, Terrain};
use serde_json::{Value, json};

const CROSSING: &[u8] = include_bytes!("../../../content/scenarios/crossing.json");

fn document() -> Value {
    json!({
        "schema_version":1, "rules_version":"0.1", "id":"test", "title":"Test", "historicity":"fictional", "turn_days":1,
        "map":{"width":4, "height":2, "default_terrain":"plain", "default_controller":"blue",
            "tiles":[{"q":0,"r":0,"supply_source":true},{"q":3,"r":1,"controller":"red","supply_source":true},
                {"q":2,"r":0,"controller":"red"}]},
        "factions":[{"id":"blue","name":"Blue"},{"id":"red","name":"Red"}],
        "units":[{"id":"b","faction_id":"blue","unit_type":"infantry","q":0,"r":1,"strength":10,"readiness":100,"entrenchment":0},
            {"id":"r","faction_id":"red","unit_type":"cavalry","q":2,"r":0,"strength":1,"readiness":0,"entrenchment":2}],
        "objectives":[{"id":"town","type":"control","q":1,"r":0,"points_per_round":2}],
        "victory":{"max_rounds":3,"target_score":6}, "starting_faction_id":"red", "random_seed":"0"
    })
}

fn load(value: &Value) -> Result<Scenario, game_core::scenario::ScenarioError> {
    load_scenario(&serde_json::to_vec(value).unwrap())
}

fn rejects(value: &Value, code: ErrorCode, path: &str) {
    let error = load(value).expect_err("invalid input accepted");
    assert_eq!((error.code, error.path.as_str()), (code, path), "{error}");
}

#[test]
fn training_crossing_loads_headlessly_and_normalizes() {
    let scenario = load_scenario(CROSSING).unwrap();
    assert_eq!(scenario.historicity, Historicity::Fictional);
    assert_eq!(scenario.id, "training_crossing");
    assert_eq!((scenario.map.width(), scenario.map.height()), (8, 5));
    assert_eq!(scenario.units.len(), 6);
    assert_eq!(scenario.random_seed, 42);
    assert!(scenario.warnings.is_empty());
    let west = Hex { q: 3, r: 2 };
    let east = Hex { q: 4, r: 2 };
    let flags = scenario.map.edge_features(east, west).unwrap();
    assert!(flags.river && flags.bridge && flags.road && !flags.rail);
    assert_eq!(scenario.map.tile(west).unwrap().controller, None);
    assert_eq!(scenario.map.tile(east).unwrap().terrain, Terrain::Urban);

    let mut reordered: Value = serde_json::from_slice(CROSSING).unwrap();
    for path in [
        "/map/tiles",
        "/map/edges",
        "/units",
        "/objectives",
        "/factions",
    ] {
        reordered
            .pointer_mut(path)
            .unwrap()
            .as_array_mut()
            .unwrap()
            .reverse();
    }
    assert_eq!(load(&reordered).unwrap(), scenario);
}

#[test]
fn seed_is_a_canonical_u64_string() {
    let mut v = document();
    for (text, expected) in [
        ("0", 0),
        ("9007199254740993", 9_007_199_254_740_993),
        ("18446744073709551615", u64::MAX),
    ] {
        v["random_seed"] = json!(text);
        assert_eq!(load(&v).unwrap().random_seed, expected);
    }
    for text in [
        "",
        "+1",
        "-1",
        "01",
        " 1",
        "0\n",
        "18446744073709551616",
        "１",
    ] {
        v["random_seed"] = json!(text);
        rejects(&v, ErrorCode::Seed, "random_seed");
    }
    v["random_seed"] = json!(42);
    rejects(&v, ErrorCode::Json, "random_seed");
}

#[test]
fn strict_document_rejects_wrong_types_versions_and_extra_state() {
    for (pointer, value, path, code) in [
        (
            "/schema_version",
            json!(2),
            "schema_version",
            ErrorCode::Version,
        ),
        (
            "/rules_version",
            json!("0.2"),
            "rules_version",
            ErrorCode::Version,
        ),
        (
            "/historicity",
            json!("unspecified"),
            "historicity",
            ErrorCode::Json,
        ),
        (
            "/units/0/unit_type",
            json!("tank"),
            "units[0].unit_type",
            ErrorCode::Json,
        ),
        (
            "/objectives/0/type",
            json!("destroy"),
            "objectives[0].type",
            ErrorCode::Json,
        ),
        (
            "/map/default_terrain",
            json!("sea"),
            "map.default_terrain",
            ErrorCode::Json,
        ),
        (
            "/victory/target_score",
            Value::Null,
            "victory.target_score",
            ErrorCode::Json,
        ),
    ] {
        let mut v = document();
        *v.pointer_mut(pointer).unwrap() = value;
        rejects(&v, code, path);
    }
    let mut v = document();
    v["units"][0]["supply_level"] = json!("full");
    let err = load(&v).unwrap_err();
    assert_eq!(err.code, ErrorCode::Json);
    assert!(err.path.contains("units[0]") && err.message.contains("supply_level"));
    v["units"][0]
        .as_object_mut()
        .unwrap()
        .remove("supply_level");
    v["units"][0].as_object_mut().unwrap().remove("readiness");
    rejects(&v, ErrorCode::Json, "units[0].readiness");
    let duplicate = std::str::from_utf8(CROSSING).unwrap().replacen(
        "\"schema_version\": 1",
        "\"schema_version\": 1, \"schema_version\": 1",
        1,
    );
    let err = load_scenario(duplicate.as_bytes()).unwrap_err();
    assert_eq!(
        (err.code, err.path.as_str()),
        (ErrorCode::Json, "schema_version")
    );
    let mut bytes = CROSSING.to_vec();
    bytes.extend_from_slice(b" {}");
    assert_eq!(load_scenario(&bytes).unwrap_err().code, ErrorCode::Json);
    assert_eq!(
        load_scenario(&vec![b' '; MAX_JSON_BYTES + 1])
            .unwrap_err()
            .code,
        ErrorCode::SizeLimit
    );
    let mut padded = CROSSING.to_vec();
    padded.resize(MAX_JSON_BYTES, b' ');
    assert!(load_scenario(&padded).is_ok());
}

#[test]
fn faction_references_ids_and_sources_are_checked_before_play() {
    for (ptr, val, code, path) in [
        ("/id", json!(""), ErrorCode::InvalidId, "id"),
        ("/id", json!("а".repeat(65)), ErrorCode::InvalidId, "id"),
        (
            "/factions/1/id",
            json!("blue"),
            ErrorCode::DuplicateId,
            "factions[1].id",
        ),
        (
            "/starting_faction_id",
            json!("absent"),
            ErrorCode::UnknownFaction,
            "starting_faction_id",
        ),
        (
            "/map/default_controller",
            json!("absent"),
            ErrorCode::UnknownFaction,
            "map.default_controller",
        ),
        (
            "/map/tiles/1/controller",
            json!("absent"),
            ErrorCode::UnknownFaction,
            "map.tiles[1].controller",
        ),
        (
            "/units/1/faction_id",
            json!("absent"),
            ErrorCode::UnknownFaction,
            "units[1].faction_id",
        ),
        (
            "/units/1/id",
            json!("b"),
            ErrorCode::DuplicateId,
            "units[1].id",
        ),
        (
            "/map/tiles/1/controller",
            Value::Null,
            ErrorCode::MissingSource,
            "factions[1].id",
        ),
        (
            "/units/1/faction_id",
            json!("blue"),
            ErrorCode::ControllerMismatch,
            "units[1].faction_id",
        ),
    ] {
        let mut v = document();
        *v.pointer_mut(ptr).unwrap() = val;
        rejects(&v, code, path);
    }
    let mut v = document();
    v["factions"].as_array_mut().unwrap().pop();
    rejects(&v, ErrorCode::Range, "factions");
}

#[test]
fn map_rules_are_shared_with_core_and_paths_refer_to_input_order() {
    let mut v = document();
    v["map"]["edges"] = json!([{"a":[0,0],"b":[1,0],"river":true},{"b":[0,0],"a":[1,0]}]);
    rejects(
        &v,
        ErrorCode::Map(MapErrorKind::DuplicateEdge),
        "map.edges[1]",
    );
    v["map"]["edges"] = json!([{"a":[0,0],"b":[1,0],"bridge":true}]);
    rejects(
        &v,
        ErrorCode::Map(MapErrorKind::BridgeWithoutRiver),
        "map.edges[0].bridge",
    );
    v["map"]["edges"] = json!([]);
    v["map"]["tiles"][0]["terrain"] = json!("water");
    rejects(
        &v,
        ErrorCode::Map(MapErrorKind::SourceOnWater),
        "map.tiles[0].supply_source",
    );
}

#[test]
fn placements_stat_limits_and_scoring_constraints_are_enforced() {
    for (ptr, val, code, path) in [
        ("/units/0/q", json!(4), ErrorCode::Coordinate, "units[0].q"),
        (
            "/objectives/0/r",
            json!(-1),
            ErrorCode::Coordinate,
            "objectives[0].r",
        ),
        (
            "/units/0/strength",
            json!(0),
            ErrorCode::Range,
            "units[0].strength",
        ),
        (
            "/units/0/strength",
            json!(11),
            ErrorCode::Range,
            "units[0].strength",
        ),
        (
            "/units/0/readiness",
            json!(101),
            ErrorCode::Range,
            "units[0].readiness",
        ),
        (
            "/units/0/entrenchment",
            json!(3),
            ErrorCode::Range,
            "units[0].entrenchment",
        ),
        (
            "/objectives/0/points_per_round",
            json!(0),
            ErrorCode::Range,
            "objectives[0].points_per_round",
        ),
        (
            "/objectives/0/points_per_round",
            json!(1001),
            ErrorCode::Range,
            "objectives[0].points_per_round",
        ),
        (
            "/victory/max_rounds",
            json!(0),
            ErrorCode::Range,
            "victory.max_rounds",
        ),
        (
            "/victory/max_rounds",
            json!(10001),
            ErrorCode::Range,
            "victory.max_rounds",
        ),
        (
            "/victory/target_score",
            json!(0),
            ErrorCode::Range,
            "victory.target_score",
        ),
        ("/objectives", json!([]), ErrorCode::Range, "objectives"),
    ] {
        let mut v = document();
        *v.pointer_mut(ptr).unwrap() = val;
        rejects(&v, code, path);
    }
    let mut v = document();
    v["map"]["tiles"]
        .as_array_mut()
        .unwrap()
        .push(json!({"q":0,"r":1,"terrain":"water"}));
    rejects(&v, ErrorCode::Water, "units[0]");
    v["map"]["tiles"][3]["q"] = json!(1);
    v["map"]["tiles"][3]["r"] = json!(0);
    rejects(&v, ErrorCode::Water, "objectives[0]");
    let mut v = document();
    v["units"][1] = v["units"][0].clone();
    v["units"][1]["id"] = json!("another");
    rejects(&v, ErrorCode::Occupied, "units[1]");
    let mut v = document();
    let obj = v["objectives"][0].clone();
    v["objectives"].as_array_mut().unwrap().push(obj);
    rejects(&v, ErrorCode::DuplicateId, "objectives[1].id");
    v["objectives"][1]["id"] = json!("another");
    rejects(&v, ErrorCode::Occupied, "objectives[1]");
}

#[test]
fn warnings_distinguish_blocked_sources_from_garrisoned_sources_and_hq() {
    let mut v = document();
    v["map"]["tiles"][2]["q"] = json!(1);
    v["units"][1]["q"] = json!(1);
    v["victory"]["target_score"] = json!(7);
    let score = || ScenarioWarning::UnreachableTarget {
        target: 7,
        maximum: 6,
    };
    assert_eq!(
        load(&v).unwrap().warnings,
        [
            ScenarioWarning::BlockedSource {
                position: Hex { q: 0, r: 0 },
                controller: FactionId("blue".into())
            },
            score()
        ]
    );
    v["units"][1]["unit_type"] = json!("headquarters");
    assert_eq!(load(&v).unwrap().warnings, [score()]);
    v["units"][1]["unit_type"] = json!("artillery");
    v["units"][0]["r"] = json!(0);
    assert_eq!(load(&v).unwrap().warnings, [score()]);
    v["victory"].as_object_mut().unwrap().remove("target_score");
    assert!(load(&v).unwrap().warnings.is_empty());
}

#[test]
fn maximum_rosters_and_scores_load_with_checked_arithmetic() {
    let mut v = document();
    v["map"] = json!({"width":256,"height":8,"default_terrain":"plain","default_controller":"blue","tiles":[
        {"q":0,"r":0,"supply_source":true},{"q":255,"r":7,"supply_source":true,"controller":"red"}]});
    let unit = v["units"][0].clone();
    let mut units = Vec::new();
    for i in 0..2048 {
        let mut u = unit.clone();
        u["id"] = json!(format!("u{i}"));
        u["q"] = json!(i % 256);
        u["r"] = json!(i / 256);
        if i == 2047 {
            u["faction_id"] = json!("red");
        }
        units.push(u);
    }
    v["units"] = json!(units);
    v["objectives"] = Value::Array((0..256).map(|q| json!({"id":format!("o{q}"), "q":q,"r":0,"type":"control","points_per_round":1000})).collect());
    v["victory"] = json!({"max_rounds":10000,"target_score":2560000001u32});
    assert_eq!(
        load(&v).unwrap().warnings,
        [ScenarioWarning::UnreachableTarget {
            target: 2560000001,
            maximum: 2560000000
        }]
    );
    v["units"].as_array_mut().unwrap().push(unit);
    rejects(&v, ErrorCode::Range, "units");
    v["units"].as_array_mut().unwrap().pop();
    let extra = v["objectives"][0].clone();
    v["objectives"].as_array_mut().unwrap().push(extra);
    rejects(&v, ErrorCode::Range, "objectives");
}

#[test]
fn historical_label_requires_provenance_and_valid_calendar_date() {
    let mut v = document();
    v["historicity"] = json!("historical");
    rejects(&v, ErrorCode::Metadata, "sources");
    v["sources"] = json!(["Test reference"]);
    rejects(&v, ErrorCode::Metadata, "historical_context");
    v["historical_context"] = json!({"map_date":"1920-02-29","hex_scale":"2 km","formation_scale":"division","assumptions":"test","review_version":"1"});
    assert!(load(&v).is_ok());
    v["historical_context"]["map_date"] = json!("1919-02-29");
    rejects(&v, ErrorCode::Metadata, "historical_context.map_date");
}
