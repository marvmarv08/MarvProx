(function () {
  'use strict';
  const { sampleInventory, buildPreview } = globalThis.DropMenuInventory;
  const { createOperation } = globalThis.DropMenuOperation;
  const $ = id => document.getElementById(id);
  let inventory = sampleInventory();
  const catalog = new Map(inventory.map(item => [item.id, item]));
  const excluded = new Set();
  let pendingToken = null;
  let operation;

  function textNode(tag, content, className) {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function renderInventory(state) {
    const running = state.status === 'running';
    const result = buildPreview(inventory, [...excluded]);
    const protections = new Map(buildPreview(inventory, []).skipped.map(item => [item.id, item.reason]));
    const cards = inventory.map(item => {
      const protectedReason = protections.get(item.id);
      const selected = !protectedReason && !excluded.has(item.id);
      const card = document.createElement('article');
      card.className = `item-card${protectedReason ? ' protected' : selected ? '' : ' excluded'}`;
      const initials = item.id === 'unknown' ? '?' : item.name.split(' ').map(word => word[0]).slice(0, 2).join('');
      card.append(textNode('div', initials, `item-visual ${item.id}`),
        textNode('span', `×${item.quantity}`, 'quantity'), textNode('h3', item.name, 'item-name'),
        textNode('p', protectedReason || (selected ? 'Included in next preview' : 'Stays in your inventory'), 'item-reason'));
      const label = document.createElement('label');
      label.className = 'item-control';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected;
      checkbox.disabled = Boolean(protectedReason) || running;
      checkbox.setAttribute('aria-label', `Include ${item.name}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) excluded.delete(item.id);
        else excluded.add(item.id);
        pendingToken = null;
        if (operation.getState().status === 'preview') operation.cancel();
        render(operation.getState());
        const next = [...$('inventory-grid').querySelectorAll('input')].find(input => input.getAttribute('aria-label') === `Include ${item.name}`);
        next?.focus();
      });
      label.append(checkbox, textNode('span', protectedReason ? 'Protected' : selected ? 'Included' : 'Keep item'));
      card.append(label);
      return card;
    });
    $('inventory-grid').replaceChildren(...cards);
    $('stack-count').textContent = `${inventory.length} stacks`;
    $('nav-count').textContent = inventory.length;
    $('selected-stacks').textContent = result.actions.length;
    $('selected-quantity').textContent = result.actions.reduce((total, item) => total + item.quantity, 0).toLocaleString('en-US');
    $('protected-stacks').textContent = protections.size;
    $('excluded-stacks').textContent = result.skipped.length - protections.size;
    $('preview-button').disabled = running || !result.actions.length;
    $('reset-button').disabled = running;
    $('stop-button').disabled = !running || state.stopRequested;
    $('stop-button').textContent = state.stopRequested && running ? 'Stopping…' : 'Stop';
  }

  function renderList(id, entries, emptyMessage) {
    $(id).replaceChildren(...(entries.length
      ? entries.map(entry => textNode('li', entry)) : [textNode('li', emptyMessage, 'empty-list')]));
  }

  function render(state) {
    renderInventory(state);
    const titles = { idle: 'Ready', preview: 'Preview ready', running: state.stopRequested ? 'Stopping' : 'Running',
      completed: 'Completed', cancelled: 'Cancelled', stopped: 'Stopped', stale: 'Preview expired', failed: 'Failed' };
    $('operation-status').textContent = titles[state.status];
    $('operation-status').dataset.status = state.status;
    const itemName = id => catalog.get(id)?.name || id;
    const itemDescription = id => `${itemName(id)} ×${catalog.get(id)?.quantity || 0}`;
    const messages = {
      idle: 'Preview your selection to get started.',
      preview: state.total ? `${state.total} stacks ready to review. No actions have started.` : 'No eligible items selected. Protected items will stay.',
      running: state.stopRequested ? 'Stopping after the current sample action finishes.' : `Simulating a drop: ${state.currentId ? itemName(state.currentId) : 'preparing next item'}…`,
      completed: `Finished. ${state.completedIds.length} sample stacks removed. Your real items are unchanged.`,
      cancelled: 'Preview cancelled. No sample items were dropped.',
      stopped: `Stopped. ${state.completedIds.length} sample stacks removed; remaining items stayed.`,
      stale: state.error,
      failed: state.error,
    };
    $('operation-message').textContent = messages[state.status];
    $('operation-progress').max = Math.max(state.total, 1);
    $('operation-progress').value = state.completedIds.length;
    $('completed-count').textContent = state.completedIds.length;
    $('skipped-count').textContent = state.skipped.length;
    $('failed-count').textContent = state.failedIds.length;
    renderList('completed-list', state.completedIds.map(itemDescription), 'No completed actions yet.');
    renderList('skipped-list', state.skipped.map(item => `${itemName(item.id)} — ${item.reason}`), 'Protected and excluded items appear here.');
    renderList('failed-list', state.failedIds.map(itemDescription), 'No failed actions.');
  }

  function newOperation() {
    return createOperation({
      getInventory: () => inventory,
      getExcludedIds: () => [...excluded],
      drop: async item => {
        await new Promise(resolve => setTimeout(resolve, 650));
        const current = inventory.find(row => row.id === item.id);
        if (!current || current.quantity !== item.quantity) throw new Error('Sample inventory changed.');
        inventory = inventory.filter(row => row.id !== item.id);
      },
      onChange: render,
    });
  }

  function cancelPreview() {
    pendingToken = null;
    operation.cancel();
    if ($('preview-dialog').open) $('preview-dialog').close();
    $('preview-button').focus();
  }

  $('preview-button').addEventListener('click', () => {
    try {
      const preview = operation.preview();
      pendingToken = preview.token;
      $('preview-items').replaceChildren(...preview.actions.map(item => {
        const row = document.createElement('li');
        row.append(textNode('span', item.name), textNode('span', `×${item.quantity}`));
        return row;
      }));
      const total = preview.actions.reduce((sum, item) => sum + item.quantity, 0);
      $('preview-total').textContent = `${total.toLocaleString('en-US')} sample items across ${preview.actions.length} stacks. ${preview.skipped.length} stacks will stay.`;
      $('confirm-button').disabled = !preview.actions.length;
      $('preview-dialog').showModal();
    } catch (error) { $('operation-message').textContent = error.message; }
  });

  $('cancel-button').addEventListener('click', cancelPreview);
  $('preview-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelPreview(); });
  $('confirm-button').addEventListener('click', async () => {
    if (!pendingToken) return;
    const token = pendingToken;
    pendingToken = null;
    $('confirm-button').disabled = true;
    $('preview-dialog').close();
    try {
      const run = operation.confirm(token);
      $('stop-button').focus();
      await run;
    } catch (error) { $('operation-message').textContent = error.message; }
    $('reset-button').focus();
  });
  $('stop-button').addEventListener('click', () => operation.stop());
  $('reset-button').addEventListener('click', () => {
    if (operation.getState().status === 'running') return;
    pendingToken = null;
    inventory = sampleInventory();
    excluded.clear();
    operation = newOperation();
    render(operation.getState());
  });
  operation = newOperation();
  render(operation.getState());
})();
