#!/usr/bin/env node
// Exit-during-play QA: leaving a run mid-game must be possible, guarded by a
// confirm so a stray tap cannot throw away progress, and must never double as
// a knife throw.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const URL = argOf('--url', 'http://127.0.0.1:8099/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa4');
fs.mkdirSync(EV, { recursive: true });

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const dump = (l, d) => fs.writeFileSync(path.join(EV, `${l}.json`), JSON.stringify(d, null, 2));

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()); });
const ready = () => page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 15000 });

try {
  const resp = await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  if (!resp || !resp.ok()) throw new Error(`page load failed: HTTP ${resp ? resp.status() : 'no-response'}`);
  await ready();

  // ---------- C1: exit button opens a confirm and does NOT throw a knife ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      G.resetSave(); G.restart(); G.startGame();
      await new Promise((res) => requestAnimationFrame(res));
      const before = G.getState();
      const rect = G.getExitRect();
      G.tapDesign(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      const after = G.getState();
      return { before, after, rect };
    });
    await page.screenshot({ path: path.join(EV, 'exit-confirm.png') });
    dump('exit-open', r);
    const pass =
      r.after.exitConfirm === true &&
      r.after.status === 'playing' &&
      r.after.flying === 0 &&                      // the tap must not have thrown
      r.after.knivesLeft === r.before.knivesLeft;  // and must not consume a knife
    record('C1 exit button opens confirm without throwing', pass, {
      exitConfirm: r.after.exitConfirm, flying: r.after.flying,
      knives: [r.before.knivesLeft, r.after.knivesLeft],
    });
  }

  // ---------- C2: while the confirm is up the run is frozen ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game, g = G.instance;
      const a1 = g.log.angle;
      await new Promise((res) => setTimeout(res, 350));
      const a2 = g.log.angle;
      return { a1, a2, moved: Math.abs(a2 - a1) };
    });
    dump('exit-paused', r);
    const pass = r.moved < 0.001;
    record('C2 run is paused while the confirm is open', pass, r);
  }

  // ---------- C3: cancelling resumes the same run, progress intact ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      const before = G.getState();
      const rect = G.getExitCancelRect();
      G.tapDesign(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      const after = G.getState();
      // the log must be turning again
      const a1 = G.instance.log.angle;
      await new Promise((res) => setTimeout(res, 300));
      const moved = Math.abs(G.instance.log.angle - a1) > 0.001;
      return { before, after, moved };
    });
    dump('exit-cancel', r);
    const pass =
      r.after.exitConfirm === false &&
      r.after.status === 'playing' &&
      r.after.score === r.before.score &&
      r.after.stage === r.before.stage &&
      r.moved === true;
    record('C3 cancel resumes the run with progress intact', pass, {
      exitConfirm: r.after.exitConfirm, status: r.after.status,
      score: [r.before.score, r.after.score], resumedSpinning: r.moved,
    });
  }

  // ---------- C4: confirming leaves the run and returns to the title ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      G.tapDesign(G.getExitRect().x + 20, G.getExitRect().y + 20);
      await new Promise((res) => requestAnimationFrame(res));
      const rect = G.getExitConfirmRect();
      G.tapDesign(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      return G.getState();
    });
    await page.screenshot({ path: path.join(EV, 'exit-title.png') });
    dump('exit-confirm-yes', r);
    const pass = r.status === 'title' && r.exitConfirm === false;
    record('C4 confirming returns to the title screen', pass, { status: r.status, exitConfirm: r.exitConfirm });
  }

  // ---------- C5: game over offers a way home instead of only replaying ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game, g = G.instance;
      G.restart(); G.startGame();
      await new Promise((res) => requestAnimationFrame(res));
      g._onFail({ });                       // force the run to end
      g.resultTimer = 0; g.gameOverVisible = true; g.overlayAlpha = 1;
      await new Promise((res) => requestAnimationFrame(res));
      const rect = G.getHomeRect();
      G.tapDesign(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      // give the overlay a few frames to prove it is really gone, not fading
      await new Promise((res) => setTimeout(res, 250));
      return { ...G.getState(), overlayAlpha: G.instance.overlayAlpha };
    });
    await page.screenshot({ path: path.join(EV, 'gameover-home.png') });
    dump('gameover-home', r);
    const pass = r.status === 'title' && r.overlayAlpha < 0.01;
    record('C5 home button returns to title with no lingering overlay', pass, {
      status: r.status, overlayAlpha: r.overlayAlpha,
    });
  }

  if (pageErrors.length) record('no page errors', false, { errors: pageErrors.slice(0, 5) });
  else record('no page errors', true, {});
} catch (err) {
  record('exit QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

fs.writeFileSync(path.join(EV, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ; evidence: ${EV} ===`);
process.exit(failed.length ? 1 : 0);
