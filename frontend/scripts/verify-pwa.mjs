import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
assert.equal(manifest.name, 'Luftfartsfag Studentportal');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) assert(existsSync(`dist${icon.src}`), `Missing icon: ${icon.src}`);
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /rel="manifest"[^>]+crossorigin="use-credentials"/);
assert(existsSync('dist/sw.js'));
const sw = readFileSync('dist/sw.js', 'utf8');
assert(!sw.includes('__WB_MANIFEST'), 'Service worker precache was not injected');
assert(!/url:["'](?:\/?index\.html|\/?api(?:\/|["']))/.test(sw), 'HTML or API must not be precached');
assert(!existsSync('dist/404.html'), 'Keep Cloudflare Pages SPA fallback');
assert(JSON.parse(readFileSync('dist/_routes.json', 'utf8')).include.includes('/api/*'));
console.log('Built PWA manifest, icons, worker and Pages routing verified.');
