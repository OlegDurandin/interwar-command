use super::{EventKind, GameError, GameState, Phase, SupplyLevel, UnitState};
use crate::{
    Terrain,
    scenario::{UnitId, UnitType},
};
use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Losses {
    pub attacker: u8,
    pub defender: u8,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LossRange {
    pub min: u8,
    pub max: u8,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CombatModifiers {
    pub attack: u8,
    pub defense: u8,
    pub attack_factor: u8,
    pub defense_factor: u8,
    pub attack_hq: u8,
    pub defense_hq: u8,
    pub terrain: u8,
    pub river: u8,
    pub entrenchment: u8,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CombatPreview {
    pub modifiers: CombatModifiers,
    pub attacker: LossRange,
    pub defender: LossRange,
}

fn stats(kind: UnitType) -> (u8, u8, u64) {
    match kind {
        UnitType::Infantry => (6, 6, 1),
        UnitType::Cavalry => (5, 4, 1),
        UnitType::Artillery => (7, 3, 2),
        UnitType::Headquarters => (0, 3, 0),
    }
}
fn scaled(base: u8, unit: &UnitState, factor: u8) -> u8 {
    (u64::from(base) * u64::from(unit.strength) * u64::from(unit.readiness) * u64::from(factor)
        / 100_000) as u8
}
struct Engagement {
    modifiers: CombatModifiers,
    strength: [u8; 2],
    ranged: bool,
}
impl Engagement {
    fn losses(&self, [ja, jd]: [i8; 2]) -> Losses {
        let a = (i16::from(self.modifiers.attack) + i16::from(ja)).max(0);
        let d = (i16::from(self.modifiers.defense) + i16::from(jd)).max(1);
        let defender = (1 + (a - d).div_euclid(3)).clamp(0, if self.ranged { 2 } else { 4 }) as u8;
        let attacker = if self.ranged {
            0
        } else {
            (1 + (d - a).div_euclid(4)).clamp(0, 3) as u8
        };
        Losses {
            attacker: attacker.min(self.strength[0]),
            defender: defender.min(self.strength[1]),
        }
    }
    fn preview(&self) -> CombatPreview {
        let mut attacker = LossRange {
            min: u8::MAX,
            max: 0,
        };
        let mut defender = attacker;
        for a in -1..=1 {
            for d in -1..=1 {
                let l = self.losses([a, d]);
                attacker.min = attacker.min.min(l.attacker);
                attacker.max = attacker.max.max(l.attacker);
                defender.min = defender.min.min(l.defender);
                defender.max = defender.max.max(l.defender);
            }
        }
        CombatPreview {
            modifiers: self.modifiers,
            attacker,
            defender,
        }
    }
}
fn combat_roll(seed: u64, index: u64) -> [i8; 2] {
    let mut bytes = [0; 32];
    bytes[..8].copy_from_slice(&seed.to_le_bytes());
    bytes[8..16].copy_from_slice(&index.to_le_bytes());
    bytes[16..].copy_from_slice(b"IWC-COMBAT-v0.1!");
    let mut rng = ChaCha8Rng::from_seed(bytes);
    std::array::from_fn(|_| {
        loop {
            let word = rng.next_u32();
            if word != u32::MAX {
                break (word % 3) as i8 - 1;
            }
        }
    })
}

impl GameState {
    fn hq_bonus(&self, unit: &UnitState) -> u8 {
        u8::from(
            unit.unit_type != UnitType::Headquarters
                && self.units.values().any(|u| {
                    u.unit_type == UnitType::Headquarters
                        && u.faction_id == unit.faction_id
                        && u.supply != SupplyLevel::None
                        && u.position.distance(unit.position) == 1
                }),
        )
    }
    fn engagement(&self, attacker: &UnitId, defender: &UnitId) -> Result<Engagement, GameError> {
        let active = match &self.phase {
            Phase::NotStarted => return Err(GameError::NotStarted),
            Phase::Finished { .. } => return Err(GameError::Finished),
            Phase::Active { active_faction, .. } => active_faction,
        };
        let a = self.units.get(attacker).ok_or(GameError::UnknownUnit)?;
        let d = self.units.get(defender).ok_or(GameError::UnknownUnit)?;
        if &a.faction_id != active {
            return Err(GameError::WrongFaction);
        }
        if a.faction_id == d.faction_id {
            return Err(GameError::InvalidTarget);
        }
        let (attack, _, range) = stats(a.unit_type);
        if range == 0 {
            return Err(GameError::CannotAttack);
        }
        if a.orders.attacked_this_phase
            || a.orders.entrenched_this_phase
            || (a.unit_type == UnitType::Artillery && a.orders.moved_this_phase)
        {
            return Err(GameError::OrderAlreadyUsed);
        }
        let distance = a.position.distance(d.position);
        if !(1..=range).contains(&distance) {
            return Err(GameError::OutOfRange);
        }
        let map = &self.scenario.map;
        let terrain = match map.tile(d.position).map(|t| t.terrain) {
            Some(Terrain::Forest | Terrain::Swamp) => 1,
            Some(Terrain::Hills | Terrain::Urban) => 2,
            Some(Terrain::Plain) => 0,
            _ => return Err(GameError::InvalidTarget),
        };
        let river = u8::from(
            distance == 1
                && map
                    .edge_features(a.position, d.position)
                    .is_some_and(|e| e.river && !e.bridge),
        );
        let attack_hq = self.hq_bonus(a);
        let defense_hq = self.hq_bonus(d);
        let attack_factor = a.supply.factors().0;
        let defense_factor = d.supply.factors().1;
        let defense = scaled(stats(d.unit_type).1, d, defense_factor)
            + terrain
            + d.entrenchment
            + defense_hq
            + river;
        Ok(Engagement {
            strength: [a.strength, d.strength],
            ranged: distance == 2,
            modifiers: CombatModifiers {
                attack: scaled(attack, a, attack_factor) + attack_hq,
                defense: defense.max(1),
                attack_factor,
                defense_factor,
                attack_hq,
                defense_hq,
                terrain,
                river,
                entrenchment: d.entrenchment,
            },
        })
    }
    pub fn preview_attack(
        &self,
        attacker: &UnitId,
        defender: &UnitId,
    ) -> Result<CombatPreview, GameError> {
        Ok(self.engagement(attacker, defender)?.preview())
    }
    pub(super) fn attack(&mut self, a: &UnitId, d: &UnitId) -> Result<Vec<EventKind>, GameError> {
        let fight = self.engagement(a, d)?;
        let next = self
            .combat_index
            .checked_add(1)
            .ok_or(GameError::CounterOverflow)?;
        let jitter = combat_roll(self.rng_seed(), self.combat_index);
        let losses = fight.losses(jitter);
        let at = self.units[d].position;
        let mut facts = vec![EventKind::CombatResolved {
            attacker: a.clone(),
            defender: d.clone(),
            jitter,
            losses,
        }];
        let mut participants = [(a, losses.attacker), (d, losses.defender)];
        participants.sort_by_key(|(id, _)| *id);
        for (id, loss) in participants {
            let unit = self.units.get_mut(id).expect("validated participant");
            unit.strength -= loss;
            if unit.strength == 0 {
                self.units.remove(id);
                facts.push(EventKind::UnitDestroyed {
                    unit_id: id.clone(),
                });
            } else if id == a {
                unit.readiness = unit.readiness.saturating_sub(10);
                unit.orders.attacked_this_phase = true;
                unit.entrenchment = 0;
            }
        }
        if !fight.ranged
            && !self.units.contains_key(d)
            && let Some(unit) = self.units.get_mut(a)
        {
            unit.position = at;
            let faction = unit.faction_id.clone();
            self.take_control(at, &faction);
            facts.push(EventKind::UnitAdvanced {
                unit_id: a.clone(),
                at,
            });
            facts.push(EventKind::ControlChanged { at, faction });
        }
        self.combat_index = next;
        Ok(facts)
    }
}

#[cfg(test)]
#[path = "combat_tests.rs"]
mod tests;
