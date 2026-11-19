use super::GameState;
use crate::{FactionId, Hex, Terrain};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupplyLevel {
    Full,
    Low,
    None,
}

pub fn supply_level(cost: Option<u32>) -> SupplyLevel {
    match cost {
        Some(0..=6) => SupplyLevel::Full,
        Some(7..=12) => SupplyLevel::Low,
        _ => SupplyLevel::None,
    }
}

impl SupplyLevel {
    pub(super) fn readiness(self, previous: u8) -> u8 {
        match self {
            Self::Full => (previous + 5).min(100),
            Self::Low => previous.saturating_sub(5),
            Self::None => previous.saturating_sub(15),
        }
    }
    pub(super) fn factors(self) -> (u8, u8) {
        match self {
            Self::Full => (100, 100),
            Self::Low => (75, 90),
            Self::None => (50, 70),
        }
    }
}

impl GameState {
    /// Project costs using current control, occupations and ZOC, without changing saved supply.
    pub fn supply_forecast(&self, faction: &FactionId) -> BTreeMap<Hex, u32> {
        let map = &self.scenario.map;
        let zoc = self.enemy_zoc(faction);
        let occupants: BTreeMap<_, _> = self
            .units
            .values()
            .map(|u| (u.position, &u.faction_id))
            .collect();
        let conducts = |h: Hex| {
            self.controller(h) == Some(faction)
                && match occupants.get(&h) {
                    Some(owner) => *owner == faction,
                    None => !zoc.contains(&h),
                }
        };
        let mut costs = BTreeMap::new();
        let mut queue = BinaryHeap::new();
        for (h, t) in map.tiles() {
            if t.supply_source && t.terrain != Terrain::Water && conducts(h) {
                costs.insert(h, 0);
                queue.push(Reverse((0, h.r, h.q)));
            }
        }
        while let Some(Reverse((cost, r, q))) = queue.pop() {
            let from = Hex { q, r };
            if costs[&from] != cost {
                continue;
            }
            for to in map.neighbors(from) {
                if !conducts(to) {
                    continue;
                }
                let Some(tile) = map.tile(to) else { continue };
                let terrain = match tile.terrain {
                    Terrain::Water => continue,
                    Terrain::Forest | Terrain::Hills => 1,
                    Terrain::Swamp => 2,
                    Terrain::Plain | Terrain::Urban => 0,
                };
                let Some(edge) = map.edge_features(from, to) else {
                    continue;
                };
                let base = if edge.road || edge.rail { 1 } else { 2 };
                let next = cost + base + terrain + 2 * u32::from(edge.river && !edge.bridge);
                if costs.get(&to).is_some_and(|&known| known <= next) {
                    continue;
                }
                costs.insert(to, next);
                queue.push(Reverse((next, to.r, to.q)));
            }
        }
        costs
    }
    pub(super) fn refresh_supply(&mut self, side: usize, begin_phase: bool) {
        let faction = &self.sides[side];
        let forecast = self.supply_forecast(faction);
        for unit in self.units.values_mut().filter(|u| u.faction_id == *faction) {
            unit.supply = supply_level(forecast.get(&unit.position).copied());
            if begin_phase {
                unit.readiness = unit.supply.readiness(unit.readiness);
            }
        }
    }
}
