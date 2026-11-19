//! Validated static map data (SPEC §§5.1, 5.2, 12.2).

use crate::Hex;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Stable scenario identifier. Map construction validates its length.
/// Resolution against the faction roster belongs to scenario validation.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(transparent)]
pub struct FactionId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    Plain,
    Forest,
    Hills,
    Swamp,
    Urban,
    Water,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tile {
    pub terrain: Terrain,
    pub controller: Option<FactionId>,
    pub city_id: Option<String>,
    pub supply_source: bool,
}

/// Sparse input for a single cell. City and source defaults are None and false.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TileOverride {
    pub terrain: Option<Terrain>,
    /// None inherits the default. Some(None) explicitly selects neutral control.
    pub controller: Option<Option<FactionId>>,
    pub city_id: Option<String>,
    pub supply_source: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EdgeFeatures {
    pub river: bool,
    pub bridge: bool,
    pub road: bool,
    pub rail: bool,
}

/// Input endpoints may be in either order. Map::edges emits canonical endpoints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HexEdge {
    pub a: Hex,
    pub b: Hex,
    pub features: EdgeFeatures,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapErrorKind {
    DimensionOutOfRange,
    TooManyTiles,
    OutsideMap,
    DuplicateTile,
    InvalidId,
    DuplicateCity,
    SourceOnWater,
    NotNeighbors,
    EdgeOnWater,
    BridgeWithoutRiver,
    DuplicateEdge,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapError {
    pub kind: MapErrorKind,
    /// Path in the original input, before edge or tile ordering.
    pub path: String,
}

impl MapError {
    fn new(kind: MapErrorKind, path: impl Into<String>) -> Self {
        Self {
            kind,
            path: path.into(),
        }
    }
}

impl fmt::Display for MapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self.kind {
            MapErrorKind::DimensionOutOfRange => "dimension must be in 1..=256",
            MapErrorKind::TooManyTiles => "map exceeds 16384 cells",
            MapErrorKind::OutsideMap => "coordinate lies outside the map",
            MapErrorKind::DuplicateTile => "duplicate tile override",
            MapErrorKind::InvalidId => "identifier must contain 1 to 64 characters",
            MapErrorKind::DuplicateCity => "duplicate city identifier",
            MapErrorKind::SourceOnWater => "supply source must be on land",
            MapErrorKind::NotNeighbors => "edge endpoints must be adjacent",
            MapErrorKind::EdgeOnWater => "edge endpoint must be on land",
            MapErrorKind::BridgeWithoutRiver => "a bridge requires a river",
            MapErrorKind::DuplicateEdge => "duplicate undirected edge",
        };
        write!(f, "{}: {message}", self.path)
    }
}

impl std::error::Error for MapError {}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().take(65).count() <= 64
}

fn edge_key(a: Hex, b: Hex) -> (Hex, Hex) {
    if a <= b { (a, b) } else { (b, a) }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Map {
    width: i32,
    height: i32,
    tiles: Vec<Tile>,
    edges: BTreeMap<(Hex, Hex), EdgeFeatures>,
}

impl Map {
    /// Normalize all tiles before validating edges against final terrain.
    pub fn new(
        width: i32,
        height: i32,
        default_terrain: Terrain,
        default_controller: Option<FactionId>,
        tiles: impl IntoIterator<Item = (Hex, TileOverride)>,
        edges: impl IntoIterator<Item = HexEdge>,
    ) -> Result<Self, MapError> {
        for (value, path) in [(width, "map.width"), (height, "map.height")] {
            if !(1..=256).contains(&value) {
                return Err(MapError::new(MapErrorKind::DimensionOutOfRange, path));
            }
        }
        let count = (width * height) as usize;
        if count > 16384 {
            return Err(MapError::new(MapErrorKind::TooManyTiles, "map"));
        }
        if default_controller
            .as_ref()
            .is_some_and(|id| !valid_id(&id.0))
        {
            return Err(MapError::new(
                MapErrorKind::InvalidId,
                "map.default_controller",
            ));
        }
        let tile = Tile {
            terrain: default_terrain,
            controller: default_controller,
            city_id: None,
            supply_source: false,
        };
        let mut map = Self {
            width,
            height,
            tiles: vec![tile; count],
            edges: BTreeMap::new(),
        };
        map.apply_tiles(tiles)?;
        for (i, edge) in edges.into_iter().enumerate() {
            map.insert_edge(i, edge)?;
        }
        Ok(map)
    }

    pub fn width(&self) -> i32 {
        self.width
    }
    pub fn height(&self) -> i32 {
        self.height
    }

    pub fn contains(&self, hex: Hex) -> bool {
        (0..self.width).contains(&hex.q) && (0..self.height).contains(&hex.r)
    }

    fn index(&self, hex: Hex) -> Option<usize> {
        self.contains(hex)
            .then(|| (hex.r * self.width + hex.q) as usize)
    }

    pub fn tile(&self, hex: Hex) -> Option<&Tile> {
        self.index(hex).map(|index| &self.tiles[index])
    }

    /// Iteration in row-major (r, q) order.
    pub fn tiles(&self) -> impl Iterator<Item = (Hex, &Tile)> {
        self.tiles.iter().enumerate().map(|(i, tile)| {
            let i = i as i32;
            (
                Hex {
                    q: i % self.width,
                    r: i / self.width,
                },
                tile,
            )
        })
    }

    /// In-bounds geometric neighbors, including water, in SPEC direction order.
    pub fn neighbors(&self, hex: Hex) -> impl Iterator<Item = Hex> {
        hex.neighbors()
            .into_iter()
            .flatten()
            .filter(move |&n| self.contains(hex) && self.contains(n))
    }

    pub fn edges(&self) -> impl Iterator<Item = HexEdge> + '_ {
        self.edges
            .iter()
            .map(|(&(a, b), &features)| HexEdge { a, b, features })
    }

    /// An ordinary land crossing has all flags false. Invalid crossings return None.
    pub fn edge_features(&self, a: Hex, b: Hex) -> Option<EdgeFeatures> {
        if self.tile(a)?.terrain == Terrain::Water
            || self.tile(b)?.terrain == Terrain::Water
            || a.distance(b) != 1
        {
            return None;
        }
        Some(self.edges.get(&edge_key(a, b)).copied().unwrap_or_default())
    }

    fn apply_tiles(
        &mut self,
        overrides: impl IntoIterator<Item = (Hex, TileOverride)>,
    ) -> Result<(), MapError> {
        let mut seen = vec![false; self.tiles.len()];
        let mut cities = BTreeSet::new();
        for (i, (hex, patch)) in overrides.into_iter().enumerate() {
            let error = |kind, field: &str| MapError::new(kind, format!("map.tiles[{i}]{field}"));
            let index = self.index(hex).ok_or_else(|| {
                let field = if (0..self.width).contains(&hex.q) {
                    ".r"
                } else {
                    ".q"
                };
                error(MapErrorKind::OutsideMap, field)
            })?;
            if seen[index] {
                return Err(error(MapErrorKind::DuplicateTile, ""));
            }
            seen[index] = true;
            let tile = &mut self.tiles[index];
            if let Some(terrain) = patch.terrain {
                tile.terrain = terrain;
            }
            if let Some(controller) = patch.controller {
                if controller.as_ref().is_some_and(|id| !valid_id(&id.0)) {
                    return Err(error(MapErrorKind::InvalidId, ".controller"));
                }
                tile.controller = controller;
            }
            if let Some(city) = &patch.city_id {
                if !valid_id(city) {
                    return Err(error(MapErrorKind::InvalidId, ".city_id"));
                }
                if !cities.insert(city.clone()) {
                    return Err(error(MapErrorKind::DuplicateCity, ".city_id"));
                }
            }
            if patch.supply_source && tile.terrain == Terrain::Water {
                return Err(error(MapErrorKind::SourceOnWater, ".supply_source"));
            }
            tile.city_id = patch.city_id;
            tile.supply_source = patch.supply_source;
        }
        Ok(())
    }

    fn insert_edge(&mut self, i: usize, edge: HexEdge) -> Result<(), MapError> {
        let error = |kind, field: &str| MapError::new(kind, format!("map.edges[{i}]{field}"));
        for (hex, field) in [(edge.a, ".a"), (edge.b, ".b")] {
            let tile = self
                .tile(hex)
                .ok_or_else(|| error(MapErrorKind::OutsideMap, field))?;
            if tile.terrain == Terrain::Water {
                return Err(error(MapErrorKind::EdgeOnWater, field));
            }
        }
        if edge.a.distance(edge.b) != 1 {
            return Err(error(MapErrorKind::NotNeighbors, ".b"));
        }
        if edge.features.bridge && !edge.features.river {
            return Err(error(MapErrorKind::BridgeWithoutRiver, ".bridge"));
        }
        if self
            .edges
            .insert(edge_key(edge.a, edge.b), edge.features)
            .is_some()
        {
            return Err(error(MapErrorKind::DuplicateEdge, ""));
        }
        Ok(())
    }
}
