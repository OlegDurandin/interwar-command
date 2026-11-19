use super::{ErrorCode, ScenarioError};
use super::{Faction, HistoricalContext, Historicity, Objective, Unit, Victory};
use crate::{EdgeFeatures, FactionId, Hex, HexEdge, Map, Terrain, TileOverride};
use serde::{Deserialize, Deserializer};

/// With #[serde(default)], distinguishes a missing field from its present value
/// (including an explicit null for a nullable T).
pub(super) fn provided<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Document {
    pub schema_version: u32,
    pub rules_version: String,
    pub id: String,
    pub title: String,
    pub historicity: Historicity,
    pub turn_days: u32,
    pub description: Option<String>,
    pub period: Option<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub historical_context: Option<HistoricalContext>,
    pub map: MapInput,
    pub factions: Vec<Faction>,
    pub units: Vec<Unit>,
    pub objectives: Vec<Objective>,
    pub victory: Victory,
    pub starting_faction_id: FactionId,
    pub random_seed: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MapInput {
    width: i32,
    height: i32,
    default_terrain: Terrain,
    #[serde(deserialize_with = "Option::deserialize")]
    default_controller: Option<FactionId>,
    #[serde(default)]
    tiles: Vec<Cell>,
    #[serde(default)]
    edges: Vec<Edge>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cell {
    q: i32,
    r: i32,
    #[serde(default, deserialize_with = "provided")]
    terrain: Option<Terrain>,
    #[serde(default, deserialize_with = "provided")]
    controller: Option<Option<FactionId>>,
    city_id: Option<String>,
    #[serde(default)]
    supply_source: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Edge {
    a: [i32; 2],
    b: [i32; 2],
    #[serde(default)]
    river: bool,
    #[serde(default)]
    bridge: bool,
    #[serde(default)]
    road: bool,
    #[serde(default)]
    rail: bool,
}

impl MapInput {
    pub fn normalize(self, factions: &[Faction]) -> Result<Map, ScenarioError> {
        if let Some(id) = &self.default_controller {
            super::validate::faction_ref(id, factions, "map.default_controller")?;
        }
        for (i, tile) in self.tiles.iter().enumerate() {
            if let Some(Some(id)) = &tile.controller {
                super::validate::faction_ref(id, factions, &format!("map.tiles[{i}].controller"))?;
            }
        }
        let tiles = self.tiles.into_iter().map(|tile| {
            let position = Hex {
                q: tile.q,
                r: tile.r,
            };
            (
                position,
                TileOverride {
                    terrain: tile.terrain,
                    controller: tile.controller,
                    city_id: tile.city_id,
                    supply_source: tile.supply_source,
                },
            )
        });
        let edges = self.edges.into_iter().map(|edge| HexEdge {
            a: Hex {
                q: edge.a[0],
                r: edge.a[1],
            },
            b: Hex {
                q: edge.b[0],
                r: edge.b[1],
            },
            features: EdgeFeatures {
                river: edge.river,
                bridge: edge.bridge,
                road: edge.road,
                rail: edge.rail,
            },
        });
        Map::new(
            self.width,
            self.height,
            self.default_terrain,
            self.default_controller,
            tiles,
            edges,
        )
        .map_err(|e| ScenarioError::new(ErrorCode::Map(e.kind), e.path.clone(), e.to_string()))
    }
}
