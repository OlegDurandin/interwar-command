use super::{EventKind, GameError, GameState, OrderFlags, Phase};
use crate::{
    FactionId, Hex, Map, Terrain,
    scenario::{UnitId, UnitType},
};
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet, BinaryHeap},
};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveRoute {
    /// Includes the starting hex and destination, in traversal order.
    pub path: Vec<Hex>,
    pub cost: u8,
}

struct MovementRules;
impl MovementRules {
    const READINESS_COST: u8 = 5;
    fn budget(kind: UnitType) -> u8 {
        match kind {
            UnitType::Cavalry => 4,
            UnitType::Artillery => 2,
            UnitType::Infantry | UnitType::Headquarters => 3,
        }
    }
    fn cost(map: &Map, from: Hex, to: Hex) -> Option<u8> {
        let edge = map.edge_features(from, to)?;
        let base = if edge.road || edge.rail {
            1
        } else {
            match map.tile(to)?.terrain {
                Terrain::Plain | Terrain::Urban => 1,
                Terrain::Forest | Terrain::Hills => 2,
                Terrain::Swamp => 3,
                Terrain::Water => return None,
            }
        };
        Some(base + u8::from(edge.river && !edge.bridge))
    }
}

impl GameState {
    /// Existing land cells threatened by opposing counters at their current positions.
    pub fn enemy_zoc(&self, faction: &FactionId) -> BTreeSet<Hex> {
        let map = &self.scenario.map;
        self.units
            .values()
            .filter(|u| u.faction_id != *faction && u.unit_type != UnitType::Headquarters)
            .flat_map(|u| map.neighbors(u.position))
            .filter(|&h| map.tile(h).is_some_and(|t| t.terrain != Terrain::Water))
            .collect()
    }

    pub(super) fn take_control(&mut self, at: Hex, side: &FactionId) {
        if self
            .scenario
            .map
            .tile(at)
            .and_then(|t| t.controller.as_ref())
            == Some(side)
        {
            self.control_changes.remove(&at);
        } else {
            self.control_changes.insert(at, side.clone());
        }
    }
    pub fn controller(&self, hex: Hex) -> Option<&FactionId> {
        self.control_changes
            .get(&hex)
            .or_else(|| self.scenario.map.tile(hex)?.controller.as_ref())
    }

    pub fn reachable(&self, id: &UnitId) -> Result<BTreeMap<Hex, MoveRoute>, GameError> {
        let active = match &self.phase {
            Phase::NotStarted => return Err(GameError::NotStarted),
            Phase::Finished { .. } => return Err(GameError::Finished),
            Phase::Active { active_faction, .. } => active_faction,
        };
        let unit = self.units.get(id).ok_or(GameError::UnknownUnit)?;
        if unit.faction_id != *active {
            return Err(GameError::WrongFaction);
        }
        if unit.orders != OrderFlags::default() {
            return Err(GameError::OrderAlreadyUsed);
        }
        let map = &self.scenario.map;
        let start = unit.position;
        let budget = MovementRules::budget(unit.unit_type);
        let occupied: BTreeSet<_> = self.units.values().map(|u| u.position).collect();
        let zoc = self.enemy_zoc(active);
        let mut queue = BinaryHeap::from([Reverse((0, start.r, start.q))]);
        let mut paths = BTreeMap::from([(
            start,
            MoveRoute {
                cost: 0,
                path: vec![start],
            },
        )]);
        while let Some(Reverse((spent, r, q))) = queue.pop() {
            let from = Hex { q, r };
            if spent != paths[&from].cost || (from != start && zoc.contains(&from)) {
                continue;
            }
            for to in map.neighbors(from) {
                if occupied.contains(&to)
                    || (from == start && zoc.contains(&start) && zoc.contains(&to))
                {
                    continue;
                }
                let Some(step) = MovementRules::cost(map, from, to) else {
                    continue;
                };
                let cost = spent + step;
                if cost > budget || paths.get(&to).is_some_and(|route| route.cost <= cost) {
                    continue;
                }
                let mut path = paths[&from].path.clone();
                path.push(to);
                paths.insert(to, MoveRoute { cost, path });
                queue.push(Reverse((cost, to.r, to.q)));
            }
        }
        paths.remove(&start);
        Ok(paths)
    }

    pub(super) fn move_unit(
        &mut self,
        id: &UnitId,
        destination: Hex,
    ) -> Result<Vec<EventKind>, GameError> {
        let route = self
            .reachable(id)?
            .remove(&destination)
            .ok_or(GameError::Unreachable)?;
        let unit = self.units.get_mut(id).ok_or(GameError::UnknownUnit)?;
        let owner = unit.faction_id.clone();
        unit.position = destination;
        unit.readiness = unit.readiness.saturating_sub(MovementRules::READINESS_COST);
        unit.entrenchment = 0;
        unit.orders.moved_this_phase = true;
        let mut changes = Vec::new();
        for &at in route.path.iter().skip(1) {
            if self.controller(at) != Some(&owner) {
                self.take_control(at, &owner);
                changes.push(EventKind::ControlChanged {
                    at,
                    faction: owner.clone(),
                });
            }
        }
        let mut events = vec![EventKind::UnitMoved {
            unit_id: id.clone(),
            route,
        }];
        events.extend(changes);
        Ok(events)
    }
}
