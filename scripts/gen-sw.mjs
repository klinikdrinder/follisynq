// Generates out/sw.js with a precache list of the static app shell (runs after `next build`).
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const OUT = 'out';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push('/' + relative(OUT, p).replace(/\\/g, '/')); } })(OUT);
const assets = files.filter((f) => !f.endsWith('.map') && f !== '/sw.js' && !f.endsWith('.txt'));
const version = createHash('sha256').update(assets.join('|') + Date.now()).digest('hex').slice(0, 12);
const sw = `/* Follisync service worker — offline app shell. Never caches API traffic or clinical media. */
const CACHE = 'follisync-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase etc. always go to network
  if (e.request.mode === 'navigate') {
    const page = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(page, c)); return r; })
      .catch(() => caches.match(page).then((r) => r || caches.match('/index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
`;
writeFileSync(join(OUT, 'sw.js'), sw);
console.log(`sw.js: ${assets.length} assets precached (cache ${version})`);
