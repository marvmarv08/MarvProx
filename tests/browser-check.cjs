const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  const checks = [];
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.locator('.item-card').last().waitFor();
    assert.equal(await page.locator('.item-card').count(), 8);
    assert.equal(await page.locator('.item-card input:disabled').count(), 3);
    assert.match(await page.locator('#simulation-banner').innerText(), /not connected to Growtopia/i);
    checks.push('file:// startup and protected inventory');
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });

    const preview = page.getByRole('button', { name: 'Preview Drop All', exact: true });
    await page.getByRole('checkbox', { name: 'Include Dirt Block', exact: true }).uncheck();
    await preview.click();
    assert.equal(await page.locator('#preview-items li').count(), 4);
    assert.doesNotMatch(await page.locator('#preview-items').innerText(), /Dirt Block|World Lock|Pickaxe|Unidentified/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('.item-card').count(), 8);
    checks.push('exclusions, preview, and cancellation');

    await page.getByRole('button', { name: 'Reset Sample Inventory', exact: true }).click();
    await preview.click();
    await page.getByRole('button', { name: 'Confirm simulated drop', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#operation-status').dataset.status === 'stopped');
    assert.equal(await page.locator('.item-card').count(), 7);
    checks.push('stop prevents later actions while the pending one finishes');

    await page.getByRole('button', { name: 'Reset Sample Inventory', exact: true }).click();
    await preview.click();
    await page.getByRole('button', { name: 'Confirm simulated drop', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#operation-status').dataset.status === 'completed');
    assert.equal(await page.locator('.item-card').count(), 3);
    assert.equal(await page.locator('.item-card input:disabled').count(), 3);
    assert.equal(await preview.isDisabled(), true);
    assert.match(await page.locator('#completed-list').innerText(), /Dirt Block/);
    assert.match(await page.locator('#skipped-list').innerText(), /World Lock/);
    checks.push('completed drops, separate progress lists, and empty eligible inventory');

    await page.getByRole('button', { name: 'Reset Sample Inventory', exact: true }).click();
    assert.equal(await page.locator('.item-card').count(), 8);
    await preview.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#preview-dialog').evaluate(element => element.open), false);
    assert.equal(await preview.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Reset Sample Inventory', exact: true }).evaluate(element => element === document.activeElement), true);
    checks.push('reset and keyboard dialog cancellation with restored focus');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
    checks.push('mobile layout without horizontal overflow');
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    checks.push('no browser errors or HTTP requests');
    await fs.writeFile(path.join(artifacts, 'browser-results.json'), JSON.stringify({
      platform: process.platform, browser: await browser.version(), checks, errors, remoteRequests,
    }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
