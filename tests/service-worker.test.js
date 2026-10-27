const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker({ failInstall = false } = {}) {
  const handlers = {}, deleted = [], messages = [];
  let skipped = false;
  vm.runInNewContext(fs.readFileSync('service-worker.js', 'utf8'), {
    URL, Request,
    fetch: async () => new Response('missing', { status: 404 }),
    caches: {
      keys: async () => ['other-app-cache', 'bleed-cycle-pwa-v22', 'bleed-cycle-pwa-v23'],
      delete: async key => deleted.push(key),
      open: async () => ({
        addAll: async () => { if (failInstall) throw new Error('offline'); },
        match: async request => request === './index.html' ? new Response('release shell') : undefined
      })
    },
    // Resolve relative Request URLs as a browser does.
    Request: class extends Request { constructor(url, opts) { super(new URL(url, 'https://example.com/bleed-cycle/'), opts); } },
    self: {
      location: { origin: 'https://example.com' },
      registration: { scope: 'https://example.com/bleed-cycle/' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => {}, matchAll: async () => [{ postMessage: message => messages.push(message) }] }
    }
  });
  return { handlers, deleted, messages, skipped: () => skipped };
}

(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = fs.readFileSync('service-worker.js', 'utf8');
  for (const asset of ['app.js', 'styles.css']) {
    const ref = html.match(new RegExp(`${asset.replace('.', "\\.")}\\?v=\\d+`))?.[0];
    assert.ok(ref && script.includes(ref), `${asset} must use the same version in HTML and precache`);
  }
  const broken = worker({ failInstall: true });
  let pending;
  broken.handlers.install({ waitUntil: promise => { pending = promise; } });
  await assert.rejects(pending, /offline/);
  assert.deepEqual(broken.deleted, ['bleed-cycle-pwa-v23']);
  assert.equal(broken.skipped(), false);

  const healthy = worker();
  healthy.handlers.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(healthy.skipped(), true);
  healthy.handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(healthy.deleted, ['bleed-cycle-pwa-v22']);
  assert.equal(healthy.messages.length, 1);

  healthy.handlers.fetch({ request: { url: 'https://example.com/bleed-cycle/', method: 'GET', mode: 'navigate' }, respondWith: promise => { pending = promise; } });
  assert.equal(await (await pending).text(), 'release shell');
  healthy.handlers.fetch({ request: { url: 'https://example.com/bleed-cycle/missing.js', method: 'GET' }, respondWith: promise => { pending = promise; } });
  assert.equal((await pending).status, 404);
  let handled = false;
  healthy.handlers.fetch({ request: { url: 'https://example.com/other-app/', method: 'GET', mode: 'navigate' }, respondWith: () => { handled = true; } });
  assert.equal(handled, false);
  console.log('service worker installation, cache isolation and response tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
