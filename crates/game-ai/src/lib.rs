//! Deterministic single-order opponent for the fictional board game (SPEC §10).
use game_core::{
    Hex,
    game::{EventKind, GameAction, GameError, GameState, Phase, SupplyLevel, supply_level},
};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Priority {
    Entrench,
    Approach,
    Supply,
    Objective,
    Attack,
}
struct Choice {
    rank: (Priority, i64),
    order: GameAction,
}

/// Candidates arrive in stable unit ID, action, row, column or target ID order.
/// Retain the earliest candidate when scores are equal.
fn consider(best: &mut Option<Choice>, rank: (Priority, i64), order: GameAction) {
    if best.as_ref().is_none_or(|b| rank > b.rank) {
        *best = Some(Choice { rank, order });
    }
}
fn supply_rank(level: SupplyLevel) -> i64 {
    match level {
        SupplyLevel::Full => 2,
        SupplyLevel::Low => 1,
        SupplyLevel::None => 0,
    }
}

pub fn next_action(game: &GameState) -> Result<GameAction, GameError> {
    let side = match game.phase() {
        Phase::Active { active_faction, .. } => active_faction,
        Phase::NotStarted => return Err(GameError::NotStarted),
        Phase::Finished { .. } => return Err(GameError::Finished),
    };
    let own: Vec<_> = game
        .units()
        .iter()
        .filter(|(_, u)| &u.faction_id == side)
        .collect();
    let orders = game
        .commands()
        .iter()
        .rev()
        .take_while(|a| !matches!(a, GameAction::EndPhase {}))
        .count();
    let casualties=game.events().iter().rev().take_while(|e|!matches!(e.kind,EventKind::PhaseStarted{..}))
        .filter(|e|matches!(&e.kind,EventKind::UnitDestroyed{unit_id} if game.scenario().units.iter().any(|u|&u.id==unit_id && &u.faction_id==side))).count();
    if own.is_empty() || orders >= 2 * (own.len() + casualties) {
        return Ok(GameAction::EndPhase {});
    }
    let goals: Vec<_> = game
        .scenario()
        .objectives
        .iter()
        .map(|o| (Hex { q: o.q, r: o.r }, o.points_per_round))
        .collect();
    let distance = |at: Hex| {
        goals
            .iter()
            .filter(|(h, _)| game.controller(*h) != Some(side))
            .map(|(h, _)| at.distance(*h))
            .min()
    };
    let supply = game.supply_forecast(side);
    let mut best = None;
    for (id, u) in own {
        for (target, d) in game.units().iter().filter(|(_, v)| &v.faction_id != side) {
            if let Ok(p) = game.preview_attack(id, target) {
                let benefit = i64::from(p.defender.min + p.defender.max)
                    - i64::from(p.attacker.min + p.attacker.max);
                if benefit > 0 && (p.attacker.max < u.strength || p.defender.min >= d.strength) {
                    consider(
                        &mut best,
                        (Priority::Attack, benefit),
                        GameAction::Attack {
                            attacker_id: id.clone(),
                            defender_id: target.clone(),
                        },
                    );
                }
            }
        }
        if let Ok(routes) = game.reachable(id) {
            let mut ordered: Vec<_> = routes.into_iter().collect();
            ordered.sort_by_key(|(h, _)| (h.r, h.q));
            for (to, route) in ordered {
                let goal = goals
                    .iter()
                    .filter(|(h, _)| game.controller(*h) != Some(side) && route.path.contains(h))
                    .map(|(_, points)| i64::from(*points))
                    .sum::<i64>();
                let held = goals.iter().any(|(h, _)| *h == u.position);
                let level = supply_rank(supply_level(supply.get(&to).copied()));
                let gain = level - supply_rank(u.supply);
                let closer = distance(u.position)
                    .zip(distance(to))
                    .map_or(0, |(a, b)| a as i64 - b as i64);
                let rank = if goal > 0 {
                    (Priority::Objective, goal * 10 - i64::from(route.cost))
                } else if !held && gain > 0 {
                    (Priority::Supply, gain * 10 - i64::from(route.cost))
                } else if !held && closer > 0 {
                    (
                        Priority::Approach,
                        closer * 10 + level - i64::from(route.cost),
                    )
                } else {
                    continue;
                };
                consider(
                    &mut best,
                    rank,
                    GameAction::Move {
                        unit_id: id.clone(),
                        destination: to,
                    },
                );
            }
        }
        if game.can_entrench(id).is_ok() {
            consider(
                &mut best,
                (Priority::Entrench, 0),
                GameAction::Entrench {
                    unit_id: id.clone(),
                },
            );
        }
    }
    Ok(best.map_or(GameAction::EndPhase {}, |b| b.order))
}

#[cfg(test)]
mod tests {
    use super::*;
    const SCENARIO: &[u8] = include_bytes!("../../../content/scenarios/crossing.json");
    #[test]
    fn deterministic_opponents_finish_using_only_accepted_commands_within_phase_budget() {
        let mut g = GameState::load(SCENARIO).unwrap();
        g.start().unwrap();
        let mut limit = 0;
        let mut spent = 0;
        let mut meaningful = false;
        for _ in 0..250 {
            let Phase::Active { active_faction, .. } = g.phase() else {
                break;
            };
            if spent == 0 {
                limit = 2 * g
                    .units()
                    .values()
                    .filter(|u| &u.faction_id == active_faction)
                    .count();
            }
            let a = next_action(&g).unwrap();
            assert_eq!(next_action(&g).unwrap(), a);
            if matches!(a, GameAction::EndPhase {}) {
                assert!(spent <= limit);
                spent = 0;
            } else {
                spent += 1;
                assert!(spent <= limit);
            }
            meaningful |= matches!(a, GameAction::Move { .. } | GameAction::Attack { .. });
            g.apply_action(a).unwrap();
        }
        assert!(meaningful && matches!(g.phase(), Phase::Finished { .. }));
        assert_eq!(g, GameState::replay(SCENARIO, g.commands()).unwrap());
    }
}
