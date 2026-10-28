(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DropMenuInventory = api;
})(globalThis, function () {
  'use strict';

  function sampleInventory() {
    return [
      { id: 'dirt', name: 'Dirt Block', quantity: 150, category: 'item', equipped: false },
      { id: 'cave', name: 'Cave Background', quantity: 60, category: 'item', equipped: false },
      { id: 'lava', name: 'Lava', quantity: 30, category: 'item', equipped: false },
      { id: 'wood', name: 'Wooden Background', quantity: 45, category: 'item', equipped: false },
      { id: 'glass', name: 'Glass Pane', quantity: 12, category: 'item', equipped: false },
      { id: 'world-lock', name: 'World Lock', quantity: 3, category: 'lock', equipped: false },
      { id: 'pickaxe', name: 'Pickaxe', quantity: 1, category: 'item', equipped: true },
      { id: 'unknown', name: 'Unidentified Item', quantity: 1, category: 'unknown', equipped: false },
    ];
  }

  function buildPreview(items, excludedIds) {
    if (!Array.isArray(items) || !Array.isArray(excludedIds) ||
        excludedIds.some(id => typeof id !== 'string')) {
      throw new Error('Inventory and exclusions must be lists of valid items and IDs.');
    }
    const ids = new Set();
    const excluded = new Set(excludedIds);
    const actions = [];
    const skipped = [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() ||
          item.id !== item.id.trim() || ids.has(item.id)) {
        throw new Error('Every item needs a unique, nonempty ID without surrounding spaces.');
      }
      ids.add(item.id);
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new Error('Every item quantity must be a positive whole number.');
      }
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error('Every item needs a readable name.');
      }
      const category = typeof item.category === 'string' ? item.category.toLowerCase() : 'unknown';
      let reason = '';
      if (category === 'lock') reason = 'Lock protected';
      else if (item.equipped === true) reason = 'Equipped item protected';
      else if (category !== 'item' || item.equipped !== false) reason = 'Unidentified item protected';
      else if (excluded.has(item.id)) reason = 'Excluded by you';
      if (reason) skipped.push({ id: item.id, reason });
      else actions.push({ ...item });
    }
    return { actions, skipped };
  }

  return { sampleInventory, buildPreview };
});
