const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const shellFiles = ['index.html', 'app.js', 'styles.css', 'service-worker.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const oldFiles = Object.fromEntries(shellFiles.map(name => [name, execFileSync('git', ['show', `919f33f:${name}`])]));
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png' };
let oldRelease = false;
let nextRelease = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname.replace(/^\/bleed-cycle\//, '') || 'index.html';
  if (!shellFiles.includes(name)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[name.split('.').pop()], 'Cache-Control': 'no-store' });
  let body = oldRelease ? oldFiles[name] : fs.readFileSync(name);
  if (nextRelease && ['index.html', 'app.js', 'service-worker.js'].includes(name)) body = Buffer.from(body.toString().replaceAll('v23', 'v24').replaceAll('v=23', 'v=24'));
  res.end(body);
});
const fixture = fs.readFileSync(process.env.PRIVATE_BACKUP || '/dev/null', 'utf8') || JSON.stringify({
  version: 1,
  cycles: [{ start: '2026-01-01', end: '2026-01-05' }, { start: '2026-10-26' }],
  settings: {cycleLength: 28, bleedLength: 5}, notes: {}
});
const expectedCycles = JSON.parse(fixture).cycles.length;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/bleed-cycle/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: {width: 390, height: 844}, timezoneId: 'Europe/Tallinn' });
    const page = await context.newPage();
    await page.clock.install({time: new Date('2026-10-27T10:00:00+02:00')});
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(url);
    await page.locator('#importWelcome').setInputFiles({name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(fixture)});
    await page.locator('#dashboard:not(.hidden)').waitFor();
    assert.equal(await page.locator('.day-cell').count(), 42);
    assert.ok((await page.locator('#todayCard').innerText()).includes('День 2'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bleed-cycle-pwa-v1')).cycles.length), expectedCycles);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#quickEndButton').click();
    await page.locator('#newCycleEnd').fill('2026-10-27');
    await page.locator('#newCycleSubmit').click();
    await page.locator('.day-cell.today').click();
    await page.locator('#dayNote').fill('Сегодня лучше. <script>test</script>');
    await page.locator('#saveDayNote').click();
    assert.match(await page.locator('#noteStatus').innerText(), /сохранена/);
    await page.keyboard.press('Escape');
    await page.locator('.day-cell.today').click();
    assert.equal(await page.locator('#dayNote').inputValue(), 'Сегодня лучше. <script>test</script>');
    await page.keyboard.press('Escape');
    await page.locator('[data-view="settings"]').click();
    await page.locator('#settingDetail').selectOption('short');
    await page.locator('#settingsForm button[type="submit"]').click();
    await page.locator('[data-view="calendar"]').click();
    await page.locator('.day-cell.today').click();
    assert.equal(await page.locator('.metric').count(), 4);
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload();
    await page.locator('.day-cell').first().waitFor();
    assert.equal(await page.locator('.day-cell').count(), 42);
    await context.setOffline(false);
    await page.setViewportSize({width: 320, height: 740});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path: '/tmp/bleed-v23-mobile.png', fullPage: true});
    // Future updates must not discard an open form.
    await page.locator('.day-cell.today').click();
    await page.locator('#dayNote').fill('Unsaved form survives an update');
    nextRelease = true;
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForFunction(async () => (await caches.keys()).includes('bleed-cycle-pwa-v24'));
    await page.locator('#updateButton:not(.hidden-install)').waitFor();
    assert.equal(await page.locator('#dayNote').inputValue(), 'Unsaved form survives an update');
    assert.equal(await page.locator('script[src="app.js?v=23"]').count(), 1);
    await page.locator('#saveDayNote').click();
    await page.keyboard.press('Escape');
    await page.locator('#updateButton').click();
    await page.waitForFunction(() => Boolean(document.querySelector('script[src="app.js?v=24"]')));
    await page.locator('.day-cell').first().waitFor();
    assert.match(await page.evaluate(() => localStorage.getItem('bleed-cycle-pwa-v1')), /Unsaved form survives an update/);
    nextRelease = false;
    assert.deepEqual(errors, []);
    await context.close();

    // A real v22 installation must upgrade, keep the backup, and launch offline.
    oldRelease = true;
    const legacy = await browser.newContext();
    const upgradePage = await legacy.newPage();
    await upgradePage.goto(url);
    await upgradePage.evaluate(async fixture => {
      localStorage.setItem('bleed-cycle-pwa-v1', fixture);
      await navigator.serviceWorker.ready;
    }, fixture);
    await upgradePage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await upgradePage.reload();
    oldRelease = false;
    await upgradePage.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await upgradePage.waitForFunction(() => document.querySelector('script[src="app.js?v=23"]'), {timeout: 20000});
    await upgradePage.locator('.day-cell').first().waitFor();
    assert.equal(await upgradePage.evaluate(() => localStorage.getItem('bleed-cycle-pwa-v1')), fixture);
    assert.equal(await upgradePage.evaluate(() => caches.keys()).then(keys => keys.includes('bleed-cycle-pwa-v22')), false);
    await legacy.setOffline(true);
    await upgradePage.reload();
    assert.equal(await upgradePage.locator('.day-cell').count(), 42);
    await legacy.close();
    console.log('mobile UI, import, editing, notes, settings, offline and v22 → v23 update passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
