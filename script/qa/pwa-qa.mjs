#!/usr/bin/env node
// PWA installability QA — verifies the manifest, icons and service worker on a
// deployed origin, i.e. the preconditions for wrapping the game as a Play Store
// TWA with Bubblewrap.
// Usage: node script/qa/pwa-qa.mjs [--url https://.../]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const URL = argOf('--url', 'https://genie-phantom.github.io/knifegame-clone/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa2');
fs.mkdirSync(EV, { recursive: true });

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 45000 });

  // manifest is linked and parses with the fields an installable app needs
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  const manifestUrl = new global.URL(href, URL).toString();
  const mres = await page.request.get(manifestUrl);
  const manifest = await mres.json();
  const required = ['name', 'short_name', 'start_url', 'display', 'icons'];
  const missing = required.filter((k) => !manifest[k]);
  const okManifest =
    mres.ok() && missing.length === 0 &&
    manifest.display === 'standalone' &&
    Array.isArray(manifest.icons) && manifest.icons.length >= 2;
  record('manifest is installable', okManifest, {
    status: mres.status(), missing, display: manifest.display, icons: manifest.icons.length,
  });

  // every declared icon actually resolves, incl. the 192/512 pair Play needs
  const iconChecks = [];
  for (const ic of manifest.icons) {
    const u = new global.URL(ic.src, manifestUrl).toString();
    const r = await page.request.get(u);
    iconChecks.push({ src: ic.src, sizes: ic.sizes, purpose: ic.purpose, status: r.status() });
  }
  const sizes = manifest.icons.map((i) => i.sizes);
  const okIcons =
    iconChecks.every((c) => c.status === 200) &&
    sizes.includes('192x192') && sizes.includes('512x512') &&
    manifest.icons.some((i) => (i.purpose || '').includes('maskable'));
  record('all icons resolve incl. 192/512 + maskable', okIcons, iconChecks);

  // service worker registers and reaches an active state
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { supported: true, registered: false };
    await navigator.serviceWorker.ready;
    return { supported: true, registered: true, scope: reg.scope, active: !!reg.active };
  });
  record('service worker registers and activates', sw.registered === true && sw.active === true, sw);

  fs.writeFileSync(path.join(EV, 'pwa.json'), JSON.stringify({ manifest, iconChecks, sw }, null, 2));
  await page.screenshot({ path: path.join(EV, 'pwa-prod.png') });
} catch (err) {
  record('pwa QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
