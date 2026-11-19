use game_core::{
    EdgeFeatures, FactionId, Hex, HexEdge, Map, MapError, MapErrorKind, Terrain, TileOverride,
};

fn at(q: i32, r: i32) -> Hex {
    Hex { q, r }
}

fn patch(terrain: Terrain) -> TileOverride {
    TileOverride {
        terrain: Some(terrain),
        ..Default::default()
    }
}

fn edge(a: Hex, b: Hex, features: EdgeFeatures) -> HexEdge {
    HexEdge { a, b, features }
}

fn empty_map(width: i32, height: i32) -> Result<Map, MapError> {
    Map::new(width, height, Terrain::Plain, None, [], [])
}

fn assert_error(result: Result<Map, MapError>, kind: MapErrorKind, path: &str) {
    let error = result.expect_err("invalid map was accepted");
    assert_eq!((error.kind, error.path.as_str()), (kind, path));
}

#[test]
fn dimension_and_area_limits_apply_before_allocation() {
    for (w, h) in [(1, 1), (256, 64), (64, 256), (128, 128)] {
        let map = empty_map(w, h).expect("valid dimensions");
        assert_eq!((map.width(), map.height()), (w, h));
        assert_eq!(map.tiles().count(), (w * h) as usize);
    }
    for (w, h, path) in [
        (0, 1, "map.width"),
        (1, -1, "map.height"),
        (257, 1, "map.width"),
        (1, 257, "map.height"),
        (i32::MAX, i32::MAX, "map.width"),
    ] {
        assert_error(empty_map(w, h), MapErrorKind::DimensionOutOfRange, path);
    }
    assert_error(empty_map(145, 113), MapErrorKind::TooManyTiles, "map"); // 16385
}

#[test]
fn tiles_use_row_major_axial_coordinates_and_overrides_inherit_defaults() {
    let blue = FactionId("blue".into());
    let city = TileOverride {
        city_id: Some("port".into()),
        supply_source: true,
        ..patch(Terrain::Urban)
    };
    let neutral = TileOverride {
        controller: Some(None),
        ..Default::default()
    };
    let map = Map::new(
        3,
        2,
        Terrain::Forest,
        Some(blue.clone()),
        [
            (at(0, 1), city),
            (at(2, 0), neutral),
            (
                at(1, 1),
                TileOverride {
                    controller: Some(Some(FactionId("red".into()))),
                    ..patch(Terrain::Hills)
                },
            ),
        ],
        [],
    )
    .unwrap();
    assert_eq!(
        map.tiles().map(|(h, _)| h).collect::<Vec<_>>(),
        [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1)]
    );
    let town = map.tile(at(0, 1)).unwrap();
    assert_eq!(town.terrain, Terrain::Urban);
    assert_eq!(town.controller, Some(blue.clone()));
    assert_eq!(town.city_id.as_deref(), Some("port"));
    assert!(town.supply_source);
    let forest = map.tile(at(1, 0)).unwrap();
    assert_eq!(forest.controller, Some(blue));
    assert_eq!(forest.terrain, Terrain::Forest);
    assert_eq!(forest.city_id, None);
    assert!(!forest.supply_source);
    assert_eq!(map.tile(at(2, 0)).unwrap().controller, None);
    assert_eq!(
        map.tile(at(1, 1)).unwrap().controller,
        Some(FactionId("red".into()))
    );
    for outside in [
        at(3, 0),
        at(-1, 1),
        at(0, 2),
        at(0, -1),
        at(i32::MIN, i32::MAX),
    ] {
        assert!(map.tile(outside).is_none());
        assert_eq!(map.neighbors(outside).count(), 0);
    }
}

#[test]
fn bounded_neighbors_follow_spec_order_and_include_water() {
    let map = Map::new(
        3,
        3,
        Terrain::Plain,
        None,
        [(at(1, 0), patch(Terrain::Water))],
        [],
    )
    .unwrap();
    assert_eq!(
        map.neighbors(at(0, 0)).collect::<Vec<_>>(),
        [at(1, 0), at(0, 1)]
    );
    assert_eq!(
        map.neighbors(at(1, 1)).collect::<Vec<_>>(),
        [at(2, 1), at(2, 0), at(1, 0), at(0, 1), at(0, 2), at(1, 2)]
    );
    assert_eq!(
        map.neighbors(at(2, 2)).collect::<Vec<_>>(),
        [at(2, 1), at(1, 2)]
    );
}

#[test]
fn invalid_and_duplicate_tile_overrides_report_the_input_field() {
    for (h, path) in [(at(3, 0), "map.tiles[0].q"), (at(0, -1), "map.tiles[0].r")] {
        assert_error(
            Map::new(
                3,
                2,
                Terrain::Plain,
                None,
                [(h, TileOverride::default())],
                [],
            ),
            MapErrorKind::OutsideMap,
            path,
        );
    }
    let a = at(1, 1);
    assert_error(
        Map::new(
            3,
            2,
            Terrain::Plain,
            None,
            [(a, patch(Terrain::Forest)), (a, patch(Terrain::Urban))],
            [],
        ),
        MapErrorKind::DuplicateTile,
        "map.tiles[1]",
    );
}

#[test]
fn city_and_controller_ids_are_bounded_in_characters_and_cities_are_unique() {
    let a = at(0, 0);
    let b = at(1, 0);
    let city = |id: &str| TileOverride {
        city_id: Some(id.into()),
        ..Default::default()
    };
    let id = "я".repeat(64);
    assert!(
        Map::new(
            2,
            2,
            Terrain::Urban,
            Some(FactionId(id.clone())),
            [(a, city(&id))],
            []
        )
        .is_ok()
    );
    for invalid in ["", &"я".repeat(65)] {
        assert_error(
            Map::new(
                2,
                2,
                Terrain::Urban,
                Some(FactionId(invalid.into())),
                [],
                [],
            ),
            MapErrorKind::InvalidId,
            "map.default_controller",
        );
        let bad = TileOverride {
            controller: Some(Some(FactionId(invalid.into()))),
            ..Default::default()
        };
        assert_error(
            Map::new(2, 2, Terrain::Urban, None, [(a, bad)], []),
            MapErrorKind::InvalidId,
            "map.tiles[0].controller",
        );
        assert_error(
            Map::new(2, 2, Terrain::Urban, None, [(a, city(invalid))], []),
            MapErrorKind::InvalidId,
            "map.tiles[0].city_id",
        );
    }
    assert_error(
        Map::new(
            2,
            2,
            Terrain::Urban,
            None,
            [(a, city("port")), (b, city("port"))],
            [],
        ),
        MapErrorKind::DuplicateCity,
        "map.tiles[1].city_id",
    );
}

#[test]
fn canonical_edges_and_tiles_are_independent_of_input_order() {
    let a = at(9, 1);
    let b = at(10, 0);
    let c = at(10, 1);
    let crossing = EdgeFeatures {
        river: true,
        bridge: true,
        road: false,
        rail: true,
    };
    let road = EdgeFeatures {
        road: true,
        ..Default::default()
    };
    let tiles = [(a, patch(Terrain::Swamp)), (b, patch(Terrain::Hills))];
    let map = Map::new(
        11,
        2,
        Terrain::Plain,
        None,
        tiles.clone(),
        [edge(c, b, road), edge(b, a, crossing)],
    )
    .unwrap();
    let reordered = Map::new(
        11,
        2,
        Terrain::Plain,
        None,
        tiles.into_iter().rev(),
        [edge(a, b, crossing), edge(b, c, road)],
    )
    .unwrap();
    assert_eq!(map, reordered);
    assert_eq!(
        map.edges().collect::<Vec<_>>(),
        [edge(a, b, crossing), edge(b, c, road)]
    );
    assert_eq!(map.edge_features(b, a), Some(crossing));
    assert_eq!(map.edge_features(b, c), Some(road));
    assert_eq!(map.edge_features(a, c), Some(EdgeFeatures::default()));
    assert_eq!(map.edge_features(b, at(11, 0)), None);
    assert_eq!(map.edge_features(a, a), None);
    assert_eq!(map.edge_features(a, at(0, 0)), None);
}

#[test]
fn invalid_edges_report_original_endpoints_and_reject_repeated_pairs() {
    let a = at(0, 0);
    let b = at(1, 0);
    let flags = EdgeFeatures::default();
    for (x, y, kind, path) in [
        (at(-1, 0), a, MapErrorKind::OutsideMap, "map.edges[0].a"),
        (a, at(0, 2), MapErrorKind::OutsideMap, "map.edges[0].b"),
        (b, b, MapErrorKind::NotNeighbors, "map.edges[0].b"),
        (a, at(1, 1), MapErrorKind::NotNeighbors, "map.edges[0].b"),
    ] {
        assert_error(
            Map::new(2, 2, Terrain::Plain, None, [], [edge(x, y, flags)]),
            kind,
            path,
        );
    }
    let bridge = EdgeFeatures {
        bridge: true,
        ..flags
    };
    assert_error(
        Map::new(2, 2, Terrain::Plain, None, [], [edge(a, b, bridge)]),
        MapErrorKind::BridgeWithoutRiver,
        "map.edges[0].bridge",
    );
    for (x, y) in [(a, b), (b, a)] {
        let railway = EdgeFeatures {
            rail: true,
            ..flags
        };
        assert_error(
            Map::new(
                2,
                2,
                Terrain::Plain,
                None,
                [],
                [edge(a, b, flags), edge(x, y, railway)],
            ),
            MapErrorKind::DuplicateEdge,
            "map.edges[1]",
        );
    }
}

#[test]
fn source_and_both_edge_endpoints_require_final_land_terrain() {
    let a = at(0, 0);
    let b = at(1, 0);
    let source = TileOverride {
        supply_source: true,
        ..Default::default()
    };
    assert_error(
        Map::new(2, 1, Terrain::Water, None, [(a, source.clone())], []),
        MapErrorKind::SourceOnWater,
        "map.tiles[0].supply_source",
    );
    let land = TileOverride {
        terrain: Some(Terrain::Plain),
        ..source
    };
    assert!(
        Map::new(
            2,
            1,
            Terrain::Water,
            None,
            [(a, land), (b, patch(Terrain::Forest))],
            [edge(a, b, EdgeFeatures::default())]
        )
        .is_ok()
    );
    for (water, path) in [(a, "map.edges[0].a"), (b, "map.edges[0].b")] {
        assert_error(
            Map::new(
                2,
                1,
                Terrain::Plain,
                None,
                [(water, patch(Terrain::Water))],
                [edge(a, b, EdgeFeatures::default())],
            ),
            MapErrorKind::EdgeOnWater,
            path,
        );
    }
    let coast = Map::new(2, 1, Terrain::Plain, None, [(b, patch(Terrain::Water))], []).unwrap();
    assert_eq!(coast.edge_features(a, b), None);
    assert_eq!(coast.edge_features(b, a), None);
}
