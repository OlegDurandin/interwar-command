use game_core::game::{EventKind, GameAction, GameError, GameState, OrderFlags, Outcome, Phase};
use game_core::scenario::UnitId;
use game_core::{FactionId, Hex};
use serde_json::{Value, json};

const CROSSING: &[u8] = include_bytes!("../../../content/scenarios/crossing.json");

fn faction(id: &str) -> FactionId {
    FactionId(id.into())
}
fn unit(id: &str) -> UnitId {
    UnitId(id.into())
}
fn entrench(id: &str) -> GameAction {
    GameAction::Entrench { unit_id: unit(id) }
}
fn end() -> GameAction {
    GameAction::EndPhase {}
}

fn prepared(edit: impl FnOnce(&mut Value)) -> GameState {
    let mut data: Value = serde_json::from_slice(CROSSING).unwrap();
    edit(&mut data);
    GameState::load(&serde_json::to_vec(&data).unwrap()).unwrap()
}
fn active() -> GameState {
    let mut game = GameState::load(CROSSING).unwrap();
    game.start().unwrap();
    game
}

#[test]
fn first_phase_is_explicit_once_and_uses_the_starting_faction() {
    let mut game = prepared(|s| {
        s["starting_faction_id"] = json!("red");
        s["random_seed"] = json!("18446744073709551615");
        s["factions"].as_array_mut().unwrap().reverse();
    });
    assert_eq!(game.phase(), &Phase::NotStarted);
    assert_eq!(game.apply_action(end()).unwrap_err(), GameError::NotStarted);
    assert!(game.commands().is_empty() && game.events().is_empty());
    game.start().unwrap();
    assert_eq!(game.start(), Err(GameError::AlreadyStarted));
    assert_eq!(game.state_revision(), 0);
    assert_eq!(game.rng_seed(), u64::MAX);
    assert_eq!(game.combat_index(), 0);
    assert_eq!(
        game.phase(),
        &Phase::Active {
            round: 1,
            active_faction: faction("red")
        }
    );
    assert_eq!(game.events().len(), 1);
    assert_eq!((game.events()[0].revision, game.events()[0].order), (0, 0));
    assert!(game.commands().is_empty());
    assert_eq!(game.units().len(), game.scenario().units.len());
    for initial in &game.scenario().units {
        let live = &game.units()[&initial.id];
        assert_eq!(live.position, initial.position());
        assert_eq!(live.strength, initial.strength);
        assert_eq!(live.orders, OrderFlags::default());
    }
    game.apply_action(entrench("east_hq")).unwrap();
    game.apply_action(end()).unwrap();
    assert_eq!(
        game.phase(),
        &Phase::Active {
            round: 1,
            active_faction: faction("blue")
        }
    );
    game.apply_action(end()).unwrap();
    assert_eq!(
        game.phase(),
        &Phase::Active {
            round: 2,
            active_faction: faction("red")
        }
    );
}

#[test]
fn orders_reset_only_when_their_owner_begins_a_phase() {
    let mut game = active();
    let id = unit("west_inf");
    let applied = game.apply_action(entrench("west_inf")).unwrap();
    assert_eq!(applied.state_revision, 1);
    assert_eq!(applied.events.len(), 1);
    assert_eq!(
        applied.events[0].kind,
        EventKind::Entrenched {
            unit_id: id.clone(),
            level: 1
        }
    );
    assert_eq!(game.units()[&id].entrenchment, 1);
    assert!(game.units()[&id].orders.entrenched_this_phase);
    assert_eq!(
        game.apply_action(entrench("west_inf")).unwrap_err(),
        GameError::OrderAlreadyUsed
    );
    game.apply_action(end()).unwrap();
    assert!(game.units()[&id].orders.entrenched_this_phase);
    game.apply_action(entrench("east_inf")).unwrap();
    game.apply_action(end()).unwrap();
    assert!(game.units()[&unit("east_inf")].orders.entrenched_this_phase);
    assert_eq!(game.units()[&id].orders, OrderFlags::default());
    game.apply_action(entrench("west_inf")).unwrap();
    assert_eq!(game.units()[&id].entrenchment, 2);
    game.apply_action(end()).unwrap();
    game.apply_action(end()).unwrap();
    assert_eq!(
        game.apply_action(entrench("west_inf")).unwrap_err(),
        GameError::EntrenchmentLimit
    );
    let initial = game.scenario().units.iter().find(|u| u.id == id).unwrap();
    assert_eq!(initial.entrenchment, 0);
}

#[test]
fn rejected_commands_leave_all_state_and_history_intact() {
    let mut game = active();
    let expected = active();
    for (action, error) in [
        (entrench("missing"), GameError::UnknownUnit),
        (entrench("east_hq"), GameError::WrongFaction),
        (
            GameAction::Move {
                unit_id: unit("west_inf"),
                destination: Hex { q: 1, r: 2 },
            },
            GameError::Unreachable,
        ),
        (
            GameAction::Attack {
                attacker_id: unit("west_inf"),
                defender_id: unit("east_inf"),
            },
            GameError::OutOfRange,
        ),
    ] {
        assert_eq!(game.apply_action(action).unwrap_err(), error);
        assert_eq!(game, expected);
    }
    assert_eq!(game.start(), Err(GameError::AlreadyStarted));
    assert_eq!(game, expected);
}

#[test]
fn round_boundary_scores_once_and_commits_one_ordered_event_batch() {
    let mut game = active();
    let batch = game.apply_action(end()).unwrap();
    assert_eq!(batch.state_revision, 1);
    assert_eq!(batch.events.len(), 2);
    assert_eq!(game.score(&faction("red")), Some(0));
    let batch = game.apply_action(end()).unwrap();
    assert_eq!(batch.state_revision, 2);
    assert_eq!(
        batch
            .events
            .iter()
            .map(|event| &event.kind)
            .collect::<Vec<_>>(),
        [
            &EventKind::PhaseEnded {
                round: 1,
                faction: faction("red")
            },
            &EventKind::RoundEnded { round: 1 },
            &EventKind::ObjectiveScored {
                objective_id: "bridgehead".into(),
                faction: faction("red"),
                points: 2
            },
            &EventKind::PhaseStarted {
                round: 2,
                faction: faction("blue")
            },
        ]
    );
    for (i, event) in batch.events.iter().enumerate() {
        assert_eq!((event.revision, event.order), (2, i));
    }
    assert_eq!(game.commands(), &[end(), end()]);
    assert_eq!(game.score(&faction("red")), Some(2));
    assert_eq!(game.score(&faction("blue")), Some(0));
    assert_eq!(game.score(&faction("absent")), None);
    game.apply_action(end()).unwrap();
    assert_eq!(game.score(&faction("red")), Some(2));
}

#[test]
fn reaching_target_finishes_on_b_phase_and_rejects_further_orders() {
    let finish = || {
        let mut game = prepared(|s| s["victory"]["target_score"] = json!(2));
        game.start().unwrap();
        game.apply_action(end()).unwrap();
        game.apply_action(end()).unwrap();
        game
    };
    let mut game = finish();
    let expected = finish();
    assert_eq!(game.state_revision(), 2);
    assert_eq!(
        game.phase(),
        &Phase::Finished {
            round: 1,
            result: Outcome::Winner(faction("red"))
        }
    );
    assert_eq!(
        game.events().last().unwrap().kind,
        EventKind::GameFinished {
            round: 1,
            result: Outcome::Winner(faction("red"))
        }
    );
    assert_eq!(game.apply_action(end()).unwrap_err(), GameError::Finished);
    assert_eq!(
        game.apply_action(entrench("west_inf")).unwrap_err(),
        GameError::Finished
    );
    assert_eq!(game.start(), Err(GameError::Finished));
    assert_eq!(game, expected);
}

#[test]
fn round_limit_and_simultaneous_targets_resolve_using_final_scores() {
    for (blue, red, target, outcome) in [
        (1, 1, Some(1), Outcome::Draw),
        (3, 1, Some(1), Outcome::Winner(faction("blue"))),
        (1, 2, None, Outcome::Winner(faction("red"))),
    ] {
        let mut game = prepared(|s| {
            s["objectives"] = json!([
                {"id":"west","q":1,"r":2,"type":"control","points_per_round":blue},
                {"id":"neutral","q":3,"r":2,"type":"control","points_per_round":100},
                {"id":"east","q":4,"r":2,"type":"control","points_per_round":red}
            ]);
            s["victory"] = match target {
                Some(score) => json!({"max_rounds":10,"target_score":score}),
                None => json!({"max_rounds":1}),
            };
        });
        game.start().unwrap();
        game.apply_action(end()).unwrap();
        game.apply_action(end()).unwrap();
        assert_eq!(
            game.phase(),
            &Phase::Finished {
                round: 1,
                result: outcome
            }
        );
        assert_eq!(game.score(&faction("blue")), Some(blue));
        assert_eq!(game.score(&faction("red")), Some(red));
        let awarded: Vec<_> = game
            .events()
            .iter()
            .filter_map(|e| match &e.kind {
                EventKind::ObjectiveScored { objective_id, .. } => Some(objective_id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(awarded, ["east", "west"]);
    }
}

#[test]
fn json_commands_are_strict_and_do_not_accept_caller_supplied_factions() {
    for (action, data) in [
        (end(), json!({"type":"end_phase"})),
        (entrench("u"), json!({"type":"entrench","unit_id":"u"})),
        (
            GameAction::Move {
                unit_id: unit("u"),
                destination: Hex { q: 0, r: -1 },
            },
            json!({"type":"move","unit_id":"u","destination":{"q":0,"r":-1}}),
        ),
        (
            GameAction::Attack {
                attacker_id: unit("u"),
                defender_id: unit("v"),
            },
            json!({"type":"attack","attacker_id":"u","defender_id":"v"}),
        ),
    ] {
        assert_eq!(serde_json::to_value(&action).unwrap(), data);
        assert_eq!(serde_json::from_value::<GameAction>(data).unwrap(), action);
    }
    for invalid in [
        json!({"type":"end_phase","faction_id":"red"}),
        json!({"type":"attack","attacker_id":"u"}),
        json!({"type":"move","unit_id":"u","destination":{"q":1,"r":0,"x":3}}),
        json!({"type":"recruit"}),
    ] {
        assert!(serde_json::from_value::<GameAction>(invalid).is_err());
    }
}
