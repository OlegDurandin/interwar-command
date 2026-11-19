const assert = require('node:assert/strict');
const test = require('node:test');
const Ajv = require('ajv');

const schema = require('../content/schemas/scenario-v1.schema.json');
const fixture = require('../content/scenarios/crossing.json');
const validate = new Ajv({ format: 'full' }).compile(schema);

test('the v1 schema accepts the bundled training scenario', () => {
  assert.ok(validate(fixture), JSON.stringify(validate.errors));
});

test('the bundled Warsaw scenario matches v1', () => {
  assert.ok(validate(require('../content/scenarios/warsaw-1920.json')), JSON.stringify(validate.errors));
});

test('the seed pattern covers the full unsigned 64-bit range', () => {
  for (const value of ['0', '1', '9007199254740993', '18446744073709551615']) {
    assert.ok(validate({ ...fixture, random_seed: value }), value);
  }
  for (const value of [42, '', '00', '-1', '+1', '1\n', '18446744073709551616', '99999999999999999999']) {
    assert.equal(validate({ ...fixture, random_seed: value }), false, JSON.stringify(value));
  }
});

test('strict objects, edge flags, counts, and metadata use v1 constraints', () => {
  const changes = [
    data => { data.units[0].supply_source = true; },
    data => { data.map.tiles[0].terrain = null; },
    data => { data.map.edges = [{ a: [0, 0], b: [1, 0], bridge: true }]; },
    data => { data.factions.pop(); },
    data => { data.objectives = []; },
    data => { data.victory.target_score = null; },
    data => { data.historicity = 'historical'; },
  ];
  for (const change of changes) {
    const data = structuredClone(fixture);
    change(data);
    assert.equal(validate(data), false, change.toString());
  }
});
