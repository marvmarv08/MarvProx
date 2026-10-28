const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOperation } = require('../src/operation.js');

function fixture(adapter) {
  let inventory = [
    { id: 'first', name: 'Dirt Block', quantity: 12, category: 'item', equipped: false },
    { id: 'second', name: 'Lava', quantity: 5, category: 'item', equipped: false },
    { id: 'lock', name: 'World Lock', quantity: 1, category: 'lock', equipped: false },
  ];
  let excluded = [];
  const sent = [];
  const operation = createOperation({
    getInventory: () => inventory,
    getExcludedIds: () => excluded,
    drop: async item => {
      sent.push({ ...item });
      if (adapter) await adapter(item, inventory);
      inventory = inventory.filter(row => row.id !== item.id);
    },
    onChange: () => {},
  });
  return { operation, sent, inventory: () => inventory,
    exclude: ids => { excluded = ids; },
    replace: rows => { inventory = rows; } };
}

test('cancelSendsNothing', async () => {
  const f = fixture();
  const p = f.operation.preview();
  f.operation.cancel();
  await assert.rejects(f.operation.confirm(p.token));
  assert.deepEqual(f.sent, []);
  assert.equal(f.operation.getState().status, 'cancelled');
});

test('confirmsExactlyPreviewedActions', async () => {
  const f = fixture();
  f.exclude(['second']);
  const p = f.operation.preview();
  await f.operation.confirm(p.token);
  assert.deepEqual(f.sent.map(x => [x.id, x.quantity]), [['first', 12]]);
  assert.deepEqual(f.inventory().map(x => x.id), ['second', 'lock']);
  assert.deepEqual(f.operation.getState().completedIds, ['first']);
  assert.equal(f.operation.getState().status, 'completed');
});

test('rejectsStaleInventoryOrSelection', async () => {
  for (const change of [
    f => { f.inventory()[0].quantity = 1; },
    f => { f.inventory()[0].id = 'different'; },
    f => { f.inventory()[0].equipped = true; },
    f => { f.inventory()[0].category = 'lock'; },
    f => f.exclude(['first']),
  ]) {
    const f = fixture();
    const p = f.operation.preview();
    change(f);
    await assert.rejects(f.operation.confirm(p.token), /changed|preview/i);
    assert.equal(f.operation.getState().status, 'stale');
    assert.deepEqual(f.sent, []);
  }
});

test('doubleConfirmDoesNotDuplicate', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(() => gate);
  const p = f.operation.preview();
  const run = f.operation.confirm(p.token);
  await assert.rejects(f.operation.confirm(p.token));
  release();
  await run;
  assert.deepEqual(f.sent.map(x => x.id), ['first', 'second']);
});

test('stopDuringPendingActionSendsNothingFurther', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(() => gate);
  const p = f.operation.preview();
  const run = f.operation.confirm(p.token);
  f.operation.stop();
  release();
  await run;
  assert.deepEqual(f.sent.map(x => x.id), ['first']);
  assert.deepEqual(f.operation.getState().completedIds, ['first']);
  assert.deepEqual(f.inventory().map(x => x.id), ['second', 'lock']);
  assert.equal(f.operation.getState().status, 'stopped');
});

test('failureAbortsWithoutRetry', async () => {
  const f = fixture(async () => { throw new Error('Adapter failed'); });
  const p = f.operation.preview();
  await f.operation.confirm(p.token);
  assert.deepEqual(f.sent.map(x => x.id), ['first']);
  assert.deepEqual(f.operation.getState().failedIds, ['first']);
  assert.deepEqual(f.operation.getState().completedIds, []);
  assert.equal(f.operation.getState().status, 'failed');
  await assert.rejects(f.operation.confirm(p.token));
});

test('emptyPreviewCannotRun', async () => {
  const f = fixture();
  f.exclude(['first', 'second']);
  const p = f.operation.preview();
  await assert.rejects(f.operation.confirm(p.token));
  assert.deepEqual(f.sent, []);
});

test('returnedPreviewCannotChangeConfirmedQuantities', async () => {
  const f = fixture();
  const p = f.operation.preview();
  p.actions[0].quantity = 999;
  p.actions.splice(1, 1);
  await f.operation.confirm(p.token);
  assert.deepEqual(f.sent.map(x => [x.id, x.quantity]), [['first', 12], ['second', 5]]);
});

test('newPreviewInvalidatesPreviousToken', async () => {
  const f = fixture();
  const old = f.operation.preview();
  const current = f.operation.preview();
  await assert.rejects(f.operation.confirm(old.token));
  await f.operation.confirm(current.token);
  assert.equal(f.sent.length, 2);
});

test('cannotPreviewOrCancelAnActiveOperation', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(() => gate);
  const run = f.operation.confirm(f.operation.preview().token);
  assert.throws(() => f.operation.preview(), /running/i);
  f.operation.cancel();
  await assert.rejects(f.operation.confirm('other'));
  release();
  await run;
  assert.deepEqual(f.sent.map(x => x.id), ['first', 'second']);
});

test('protectsAQueuedItemThatBecomesEquippedDuringExecution', async () => {
  const f = fixture(async (item, rows) => {
    if (item.id === 'first') rows.find(x => x.id === 'second').equipped = true;
  });
  await f.operation.confirm(f.operation.preview().token);
  assert.deepEqual(f.sent.map(x => x.id), ['first']);
  assert.equal(f.operation.getState().status, 'stale');
});

test('stateSnapshotsCannotModifyExecution', async () => {
  const f = fixture();
  const p = f.operation.preview();
  f.operation.getState().completedIds.push('fake');
  f.operation.getState().skipped.length = 0;
  await f.operation.confirm(p.token);
  assert.deepEqual(f.operation.getState().completedIds, ['first', 'second']);
  assert.equal(f.operation.getState().skipped[0].id, 'lock');
});
