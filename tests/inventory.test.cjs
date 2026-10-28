const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPreview, sampleInventory } = require('../src/inventory.js');

const item = (id, overrides = {}) => ({
  id, name: 'Dirt Block', quantity: 12, category: 'item', equipped: false, ...overrides,
});

// Removing any protection branch would incorrectly queue one of these items.
test('protectsLocksEquippedUnknownAndExcluded', () => {
  const result = buildPreview([
    item('plain'), item('lock', { category: 'LoCk' }),
    item('equipped', { equipped: true }), item('unknown', { category: 'unknown' }),
    item('new-type', { category: 'unrecognized' }), item('excluded'),
  ], ['excluded']);
  assert.deepEqual(result.actions.map(x => x.id), ['plain']);
  assert.deepEqual(result.skipped.map(x => x.id), ['lock', 'equipped', 'unknown', 'new-type', 'excluded']);
  assert.ok(result.skipped.every(x => typeof x.reason === 'string' && x.reason.length > 0));
});

test('rejectsDuplicateOrMissingIds', () => {
  for (const rows of [[item('a'), item('a')], [item('')], [item('   ')], [item(null)]]) {
    assert.throws(() => buildPreview(rows, []), /id/i);
  }
});

test('rejectsInvalidQuantities', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12']) {
    assert.throws(() => buildPreview([item('a', { quantity })], []), /quantity/i);
  }
});

test('handlesEmptyInventoryWithoutMutation', () => {
  assert.deepEqual(buildPreview([], []), { actions: [], skipped: [] });
  const rows = [item('a')];
  const result = buildPreview(rows, []);
  result.actions[0].quantity = 1;
  assert.equal(rows[0].quantity, 12);
});

test('protectsItemsWithoutExplicitEquipmentInformation', () => {
  const missing = item('missing');
  delete missing.equipped;
  assert.deepEqual(buildPreview([missing], []).actions, []);
});

test('sampleProviderReturnsIndependentInventories', () => {
  const first = sampleInventory();
  assert.ok(buildPreview(first, []).actions.length >= 3);
  first[0].quantity = 0;
  assert.ok(sampleInventory()[0].quantity > 0);
});
