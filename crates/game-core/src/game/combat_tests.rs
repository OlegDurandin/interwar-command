use super::*;
use crate::{
    Hex,
    game::{GameAction, OrderFlags},
};
const SCENARIO: &[u8] = include_bytes!("../../../../content/scenarios/crossing.json");
fn id(s: &str) -> UnitId {
    UnitId(s.into())
}
fn ready() -> GameState {
    let mut g = GameState::load(SCENARIO).unwrap();
    g.start().unwrap();
    g.units
        .retain(|k, _| k == &id("west_inf") || k == &id("east_inf"));
    g.units.get_mut(&id("west_inf")).unwrap().position = Hex { q: 4, r: 2 };
    g
}
fn order() -> GameAction {
    GameAction::Attack {
        attacker_id: id("west_inf"),
        defender_id: id("east_inf"),
    }
}
#[test]
fn formula_reference_rows_and_all_nine_actual_losses() {
    let mut g = ready();
    let a = id("west_inf");
    let d = id("east_inf");
    let fight = g.engagement(&a, &d).unwrap();
    assert_eq!((fight.modifiers.attack, fight.modifiers.defense), (6, 6));
    for ja in -1..=1 {
        for jd in -1..=1 {
            let expected = Losses {
                attacker: u8::from(ja <= jd),
                defender: u8::from(ja >= jd),
            };
            assert_eq!(fight.losses([ja, jd]), expected);
        }
    }
    g.units.get_mut(&d).unwrap().position = Hex { q: 5, r: 3 }; // forest
    g.units.get_mut(&a).unwrap().position = Hex { q: 4, r: 3 };
    let forest = g.engagement(&a, &d).unwrap();
    assert_eq!(
        (
            forest.modifiers.attack,
            forest.modifiers.defense,
            forest.losses([0, 0])
        ),
        (
            6,
            7,
            Losses {
                attacker: 1,
                defender: 0
            }
        )
    );
    let mut g = ready();
    g.units.get_mut(&d).unwrap().strength = 8;
    let weaker = g.engagement(&a, &d).unwrap();
    assert_eq!(
        (weaker.modifiers.defense, weaker.losses([0, 0])),
        (
            4,
            Losses {
                attacker: 0,
                defender: 1
            }
        )
    );
    g.units.get_mut(&d).unwrap().strength = 10;
    let guns = g.units.get_mut(&a).unwrap();
    guns.unit_type = UnitType::Artillery;
    guns.position = Hex { q: 3, r: 2 };
    let ranged = g.engagement(&a, &d).unwrap();
    assert_eq!(
        (
            ranged.modifiers.attack,
            ranged.modifiers.defense,
            ranged.losses([0, 0])
        ),
        (
            7,
            6,
            Losses {
                attacker: 0,
                defender: 1
            }
        )
    );
}
#[test]
fn river_bridge_and_hq_bonuses_follow_current_positions_and_saved_supply() {
    let mut g = GameState::load(SCENARIO).unwrap();
    g.start().unwrap();
    let a = id("west_inf");
    let d = id("east_inf");
    let hq = id("east_hq");
    let reserve = id("east_reserve");
    g.units.get_mut(&a).unwrap().position = Hex { q: 3, r: 2 };
    g.units.get_mut(&d).unwrap().position = Hex { q: 4, r: 1 };
    g.units.get_mut(&hq).unwrap().position = Hex { q: 5, r: 1 };
    let second = g.units.get_mut(&reserve).unwrap();
    second.position = Hex { q: 5, r: 0 };
    second.unit_type = UnitType::Headquarters;
    let m = g.preview_attack(&a, &d).unwrap().modifiers;
    assert_eq!((m.river, m.defense_hq, m.defense), (1, 1, 8));
    for h in [&hq, &reserve] {
        g.units.get_mut(h).unwrap().supply = SupplyLevel::None;
    }
    assert_eq!(g.preview_attack(&a, &d).unwrap().modifiers.defense_hq, 0);
    g.units.get_mut(&d).unwrap().position = Hex { q: 4, r: 2 };
    let bridge = g.preview_attack(&a, &d).unwrap().modifiers;
    assert_eq!((bridge.river, bridge.terrain), (0, 2));
    g.units.get_mut(&hq).unwrap().supply = SupplyLevel::Low;
    assert_eq!(g.preview_attack(&a, &d).unwrap().modifiers.defense_hq, 1);
    g.units.get_mut(&d).unwrap().unit_type = UnitType::Headquarters;
    assert_eq!(g.preview_attack(&a, &d).unwrap().modifiers.defense_hq, 0);
}

#[test]
fn golden_seed_index_jitters_and_results() {
    let mut g = ready();
    for (seed, index, jitter, attack_loss, defense_loss) in [
        (42, 0, [1, 1], 1, 1),
        (42, 1, [0, -1], 0, 1),
        (42, 2, [-1, 0], 1, 0),
        (u64::MAX, 0, [-1, 1], 1, 0),
        (0, 0, [1, 0], 0, 1),
    ] {
        g.scenario.random_seed = seed;
        g.combat_index = index;
        let before = g.engagement(&id("west_inf"), &id("east_inf")).unwrap();
        assert_eq!(combat_roll(seed, index), jitter);
        assert_eq!(
            before.losses(jitter),
            Losses {
                attacker: attack_loss,
                defender: defense_loss
            }
        );
    }
}
#[test]
fn preview_is_read_only_and_orders_are_atomic() {
    let mut g = ready();
    let a = id("west_inf");
    let d = id("east_inf");
    let p = g.preview_attack(&a, &d).unwrap();
    assert_eq!(
        (p.attacker, p.defender),
        (LossRange { min: 0, max: 1 }, LossRange { min: 0, max: 1 })
    );
    assert_eq!(g, ready());
    g.apply_action(order()).unwrap();
    assert_eq!(g.combat_index(), 1);
    assert_eq!((g.units[&a].strength, g.units[&d].strength), (9, 9));
    assert_eq!((g.units[&a].readiness, g.units[&d].readiness), (90, 100));
    assert_eq!(g.units[&d].orders, OrderFlags::default());
    assert_eq!(
        g.apply_action(order()).unwrap_err(),
        GameError::OrderAlreadyUsed
    );
    assert_eq!(g.reachable(&a).unwrap_err(), GameError::OrderAlreadyUsed);
    let mut g = ready();
    g.combat_index = u64::MAX;
    let mut expected = ready();
    expected.combat_index = u64::MAX;
    assert_eq!(
        g.apply_action(order()).unwrap_err(),
        GameError::CounterOverflow
    );
    assert_eq!(g, expected);
}
#[test]
fn simultaneous_deaths_and_ranged_kill_leave_control_unchanged() {
    let a = id("west_inf");
    let d = id("east_inf");
    let at = Hex { q: 5, r: 2 };
    for (range, attacker_hp, seed, alive, advance) in [
        (1, 1, 0, false, false),
        (1, 10, 42, true, true),
        (2, 10, 42, true, false),
    ] {
        let mut g = ready();
        let u = g.units.get_mut(&a).unwrap();
        u.unit_type = UnitType::Artillery;
        u.strength = attacker_hp;
        u.position = Hex { q: 5 - range, r: 2 };
        g.units.get_mut(&d).unwrap().strength = 1;
        g.scenario.random_seed = seed;
        let p = g.preview_attack(&a, &d).unwrap();
        assert!(p.defender.max <= 1);
        if range == 2 {
            assert_eq!(p.attacker.max, 0);
        }
        g.apply_action(order()).unwrap();
        assert!(!g.units.contains_key(&d));
        assert_eq!(g.units.contains_key(&a), alive);
        assert_eq!(
            g.controller(at).unwrap().0,
            if advance { "blue" } else { "red" }
        );
        if alive {
            assert_eq!(g.units[&a].position == at, advance);
        }
        assert_eq!(
            g.events
                .iter()
                .filter(|e| matches!(e.kind, EventKind::UnitDestroyed { .. }))
                .count(),
            if alive { 1 } else { 2 }
        );
    }
}
#[test]
fn attack_orders_and_saved_supply_modifiers() {
    let mut g = ready();
    let a = id("west_inf");
    let d = id("east_inf");
    g.units.get_mut(&a).unwrap().supply = SupplyLevel::Low;
    g.units.get_mut(&d).unwrap().supply = SupplyLevel::None;
    g.units.get_mut(&d).unwrap().entrenchment = 2;
    let m = g.preview_attack(&a, &d).unwrap().modifiers;
    assert_eq!(
        (m.attack, m.defense, m.attack_factor, m.defense_factor),
        (4, 6, 75, 70)
    );
    g.units.get_mut(&a).unwrap().orders.moved_this_phase = true;
    assert!(g.preview_attack(&a, &d).is_ok());
    g.units.get_mut(&a).unwrap().unit_type = UnitType::Artillery;
    assert_eq!(g.preview_attack(&a, &d), Err(GameError::OrderAlreadyUsed));
    g.units.get_mut(&a).unwrap().unit_type = UnitType::Headquarters;
    assert_eq!(g.preview_attack(&a, &d), Err(GameError::CannotAttack));
    assert_eq!(g.preview_attack(&a, &a), Err(GameError::InvalidTarget));
    assert_eq!(g.preview_attack(&d, &a), Err(GameError::WrongFaction));
    let mut g = ready();
    g.apply_action(GameAction::Entrench { unit_id: a.clone() })
        .unwrap();
    assert_eq!(
        g.apply_action(order()).unwrap_err(),
        GameError::OrderAlreadyUsed
    );
}
