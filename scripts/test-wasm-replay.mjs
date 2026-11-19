import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import init, { MovementSession } from '../crates/game-wasm/pkg/game_wasm.js';
const read = name => readFile(new URL(name,import.meta.url),'utf8');
test('compiled WASM reproduces the native state and event log, then restores the same revision', async () => {
  const bytes=await readFile(new URL('../crates/game-wasm/pkg/game_wasm_bg.wasm',import.meta.url));
  await init({module_or_path:bytes});
  const fixture=JSON.parse(await read('../crates/game-core/tests/crossing-replay.json'));
  const scenario=await read('../content/scenarios/crossing.json');
  const game=new MovementSession(scenario);
  try {
    for (const order of fixture.commands) game.apply_action(order);
    const raw=game.serialize_save();
    const save=JSON.parse(raw);
    for (const key of ['commands','scenario_content_hash','state_hash','history_hash']) assert.deepEqual(save[key],fixture[key]);
    const loaded=MovementSession.load_save(raw);
    try {assert.equal(loaded.state_hash(),fixture.state_hash);assert.deepEqual(loaded.journal(),game.journal());}
    finally {loaded.free();}
  } finally {game.free();}
  const maxScenario=JSON.parse(scenario);
  maxScenario.random_seed='18446744073709551615';
  const maxGame=new MovementSession(JSON.stringify(maxScenario));
  try {assert.equal(JSON.parse(maxGame.serialize_save()).state.rng_seed,maxScenario.random_seed);}
  finally {maxGame.free();}
});
