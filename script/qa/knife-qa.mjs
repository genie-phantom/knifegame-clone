#!/usr/bin/env node
// Knife game QA — drives the real game in Chromium and asserts the 3 success criteria.
// Usage: node script/qa/knife-qa.mjs [--url http://127.0.0.1:8099] [--evidence-dir /tmp/ulw-knife-qa]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const URL = argOf('--url', 'http://127.0.0.1:8099/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa');
fs.mkdirSync(EV, { recursive: true });

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: { width: 420, height: 860 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('[console.error] ' + m.text());
});

const dump = (label, state) =>
  fs.writeFileSync(path.join(EV, `${label}.json`), JSON.stringify(state, null, 2));

try {
  const resp = await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  if (!resp || !resp.ok()) throw new Error(`page load failed: HTTP ${resp ? resp.status() : 'no-response'}`);

  // The game MUST expose a deterministic test API on window.__game
  await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: 15000 });

  // ---------- Criterion 1: HAPPY PATH — knife sticks, score increments ----------
  {
    await page.evaluate(() => window.__game.startGame());
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.__game.getState());
    // deterministic throw into a guaranteed-empty angle
    await page.evaluate(() => window.__game.throwAtFreeAngle());
    await page.waitForFunction(
      (b) => window.__game.getState().score > b,
      before.score,
      { timeout: 6000 },
    );
    const after = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'hit.png') });
    dump('hit', { before, after });
    const pass =
      after.score === before.score + 1 &&
      after.stuckKnives === before.stuckKnives + 1 &&
      after.status === 'playing';
    record('C1 happy-path: knife sticks and score increments', pass, {
      score: [before.score, after.score],
      stuck: [before.stuckKnives, after.stuckKnives],
      status: after.status,
    });
  }

  // ---------- Criterion 3: LEVEL PROGRESSION (run before gameover so state is alive) ----------
  {
    await page.evaluate(() => window.__game.restart());
    await page.evaluate(() => window.__game.startGame());
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.__game.getState());
    // land exactly the number of knives required to clear the current stage
    await page.evaluate(async () => {
      const need = window.__game.getState().knivesLeft;
      for (let i = 0; i < need; i++) {
        window.__game.throwAtFreeAngle();
        await window.__game.settle();
      }
    });
    await page.waitForFunction((b) => window.__game.getState().stage > b, before.stage, { timeout: 15000 });
    await page.waitForTimeout(1400); // stage respawn delay
    const after = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'level2.png') });
    dump('level2', { before, after });
    const pass =
      after.stage === before.stage + 1 &&
      after.knivesLeft === after.stageRequiredKnives &&
      after.status === 'playing' &&
      after.rotationSpeedProfile !== before.rotationSpeedProfile;
    record('C3 level progression: stage advances, knives reset, new rotation profile', pass, {
      stage: [before.stage, after.stage],
      knivesLeft: after.knivesLeft,
      required: after.stageRequiredKnives,
      profile: [before.rotationSpeedProfile, after.rotationSpeedProfile],
    });
  }

  // ---------- Criterion 2: EDGE/FAIL — hitting a stuck knife ends the game ----------
  {
    await page.evaluate(() => window.__game.restart());
    await page.evaluate(() => window.__game.startGame());
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      window.__game.throwAtFreeAngle();
      await window.__game.settle();
    });
    const before = await page.evaluate(() => window.__game.getState());
    await page.evaluate(() => window.__game.throwAtOccupiedAngle());
    await page.waitForFunction(() => window.__game.getState().status === 'gameover', null, { timeout: 8000 });
    await page.waitForTimeout(1600); // result delay before overlay
    const after = await page.evaluate(() => window.__game.getState());
    const overlayVisible = await page.evaluate(() => window.__game.isGameOverOverlayVisible());
    await page.screenshot({ path: path.join(EV, 'gameover.png') });
    dump('gameover', { before, after, overlayVisible });
    const pass = after.status === 'gameover' && overlayVisible === true && before.stuckKnives > 0;
    record('C2 fail-state: hitting a stuck knife ends the game with overlay', pass, {
      status: after.status,
      overlayVisible,
      stuckBefore: before.stuckKnives,
    });
  }

  if (pageErrors.length) record('no page errors', false, { errors: pageErrors.slice(0, 5) });
  else record('no page errors', true, {});
} catch (err) {
  record('QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

fs.writeFileSync(path.join(EV, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ; evidence: ${EV} ===`);
process.exit(failed.length ? 1 : 0);
