(function (root, factory) {
  const inventory = typeof module === 'object' && module.exports
    ? require('./inventory.js') : root.DropMenuInventory;
  const api = factory(inventory);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DropMenuOperation = api;
})(globalThis, function (inventory) {
  'use strict';
  const { buildPreview } = inventory;

  const itemKey = item => JSON.stringify([
    item.id, item.name, item.quantity, item.category, item.equipped,
  ]);
  const inventoryKey = items => JSON.stringify(items.map(itemKey));
  const exclusionsKey = ids => JSON.stringify([...new Set(ids)].sort());

  function createOperation({ getInventory, getExcludedIds, drop, onChange = () => {} }) {
    let pending = null;
    let sequence = 0;
    let state = {
      status: 'idle', completedIds: [], skipped: [], failedIds: [],
      total: 0, currentId: null, stopRequested: false, error: '',
    };

    function getState() {
      return { ...state, completedIds: [...state.completedIds],
        skipped: state.skipped.map(item => ({ ...item })), failedIds: [...state.failedIds] };
    }

    function emit() { onChange(getState()); }

    function preview() {
      if (state.status === 'running') throw new Error('An operation is already running.');
      pending = null;
      const items = getInventory();
      const excluded = getExcludedIds();
      const result = buildPreview(items, excluded);
      pending = {
        token: `preview-${++sequence}`,
        actions: result.actions,
        inventory: inventoryKey(items), exclusions: exclusionsKey(excluded),
      };
      state = { status: 'preview', completedIds: [], skipped: result.skipped,
        failedIds: [], total: result.actions.length, currentId: null,
        stopRequested: false, error: '' };
      emit();
      return { token: pending.token, actions: pending.actions.map(item => ({ ...item })),
        skipped: state.skipped.map(item => ({ ...item })) };
    }

    async function confirm(token) {
      if (state.status !== 'preview' || !pending || pending.token !== token) {
        throw new Error('Create a fresh preview before confirming.');
      }
      if (!pending.actions.length) throw new Error('There are no eligible items to drop.');
      const run = pending;
      pending = null;
      let valid = false;
      try {
        buildPreview(getInventory(), getExcludedIds());
        valid = inventoryKey(getInventory()) === run.inventory &&
          exclusionsKey(getExcludedIds()) === run.exclusions;
      } catch { /* Invalid inventory also invalidates the previously confirmed preview. */ }
      if (!valid) {
        state.status = 'stale';
        state.error = 'Inventory or selection changed. Create a new preview.';
        emit();
        throw new Error(state.error);
      }
      state.status = 'running';
      emit();
      for (const action of run.actions) {
        if (state.stopRequested) break;
        let current;
        try {
          current = buildPreview(getInventory(), getExcludedIds()).actions.find(item => item.id === action.id);
        } catch { /* Fail closed when inventory is malformed. */ }
        if (!current || itemKey(current) !== itemKey(action) ||
            exclusionsKey(getExcludedIds()) !== run.exclusions) {
          state.status = 'stale';
          state.error = 'Inventory or selection changed. Remaining actions were stopped.';
          state.currentId = null;
          emit();
          return;
        }
        state.currentId = action.id;
        emit();
        try {
          await drop({ ...action });
          state.completedIds.push(action.id);
        } catch {
          state.failedIds.push(action.id);
          state.status = 'failed';
          state.currentId = null;
          state.error = 'An action failed. No remaining actions were sent and nothing was retried.';
          emit();
          return;
        }
        state.currentId = null;
        emit();
      }
      state.status = state.stopRequested ? 'stopped' : 'completed';
      emit();
    }

    function cancel() {
      if (state.status === 'running') return;
      pending = null;
      state.status = 'cancelled';
      emit();
    }

    function stop() {
      if (state.status !== 'running') return;
      state.stopRequested = true;
      emit();
    }

    return { preview, confirm, cancel, stop, getState };
  }

  return { createOperation };
});
