#!/usr/bin/env node
// Pause menu + settings QA.
// Leaving a run and changing preferences must be reachable, obvious and safe.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const URL = argOf('--url', 'http://127.0.0.1:8099/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa5');
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
const tapRect = (name) => page.evaluate((n) => {
  const r = window.__game[n]();
  window.__game.tapDesign(r.x + r.w / 2, r.y + r.h / 2);
}, name);

try {
  const resp = await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  if (!resp || !resp.ok()) throw new Error(`page load failed: HTTP ${resp ? resp.status() : 'no-response'}`);
  await ready();

  // ---------- C1: pause control opens the menu, costs nothing ----------
  {
    await page.evaluate(() => { window.__game.resetSave(); window.__game.restart(); window.__game.startGame(); });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.__game.getState());
    await tapRect('getPauseRect');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'pause.png') });
    dump('pause', { before, after });
    const pass =
      after.paused === true &&
      after.overlay === 'pause' &&
      after.flying === 0 &&
      after.knivesLeft === before.knivesLeft;
    record('C1 pause menu opens without throwing or consuming a knife', pass, {
      paused: after.paused, overlay: after.overlay, flying: after.flying,
      knives: [before.knivesLeft, after.knivesLeft],
    });
  }

  // ---------- C2: the run is frozen while paused, and resumes intact ----------
  {
    const frozen = await page.evaluate(async () => {
      const g = window.__game.instance;
      const a1 = g.log.angle;
      await new Promise((r) => setTimeout(r, 320));
      return { a1, a2: g.log.angle };
    });
    const before = await page.evaluate(() => window.__game.getState());
    await tapRect('getResumeRect');
    await page.waitForTimeout(200);
    const resumed = await page.evaluate(async () => {
      const G = window.__game, g = G.instance;
      const a1 = g.log.angle;
      await new Promise((r) => setTimeout(r, 320));
      return { moved: Math.abs(g.log.angle - a1) > 0.001, state: G.getState() };
    });
    dump('pause-frozen', { frozen, before, resumed });
    const pass =
      Math.abs(frozen.a2 - frozen.a1) < 0.001 &&
      resumed.moved === true &&
      resumed.state.paused === false &&
      resumed.state.score === before.score &&
      resumed.state.stage === before.stage;
    record('C2 run frozen while paused, resumes intact', pass, {
      frozenDelta: Math.abs(frozen.a2 - frozen.a1), resumedSpinning: resumed.moved,
      score: [before.score, resumed.state.score],
    });
  }

  // ---------- C3: quit from the pause menu reaches the title, banks the score ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      // land a couple of knives so the run has a score worth banking
      for (let i = 0; i < 2; i++) { G.throwAtFreeAngle(); await G.settle(); }
      const mid = G.getState();
      const rq = G.getPauseRect(); G.tapDesign(rq.x + rq.w / 2, rq.y + rq.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      const rquit = G.getQuitRect(); G.tapDesign(rquit.x + rquit.w / 2, rquit.y + rquit.h / 2);
      await new Promise((res) => requestAnimationFrame(res));
      const confirming = G.getState();
      const ryes = G.getExitConfirmRect(); G.tapDesign(ryes.x + ryes.w / 2, ryes.y + ryes.h / 2);
      await new Promise((res) => setTimeout(res, 260));
      return { mid, confirming, after: G.getState(), overlayAlpha: G.instance.overlayAlpha };
    });
    await page.screenshot({ path: path.join(EV, 'quit.png') });
    dump('quit', r);
    const pass =
      r.after.status === 'title' &&
      r.overlayAlpha < 0.01 &&
      r.after.best >= r.mid.score &&
      r.mid.score > 0;
    record('C3 quit from pause reaches title and banks the score', pass, {
      status: r.after.status, overlayAlpha: r.overlayAlpha,
      score: r.mid.score, best: r.after.best,
    });
  }

  // ---------- C4: settings reachable from title AND pause, returns whence it came ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      const step = async () => new Promise((res) => requestAnimationFrame(res));
      // from the title
      G.restart(); await step();
      const rs = G.getSettingsRect(); G.tapDesign(rs.x + rs.w / 2, rs.y + rs.h / 2);
      await step();
      const fromTitle = G.getState().overlay;
      const rc = G.getSettingsCloseRect(); G.tapDesign(rc.x + rc.w / 2, rc.y + rc.h / 2);
      await step();
      const backToTitle = G.getState();

      // from the pause menu
      G.startGame(); await step();
      const rp = G.getPauseRect(); G.tapDesign(rp.x + rp.w / 2, rp.y + rp.h / 2);
      await step();
      const rs2 = G.getPauseSettingsRect(); G.tapDesign(rs2.x + rs2.w / 2, rs2.y + rs2.h / 2);
      await step();
      const fromPause = G.getState().overlay;
      const rc2 = G.getSettingsCloseRect(); G.tapDesign(rc2.x + rc2.w / 2, rc2.y + rc2.h / 2);
      await step();
      const backToPause = G.getState();
      return { fromTitle, backToTitle, fromPause, backToPause };
    });
    await page.screenshot({ path: path.join(EV, 'settings.png') });
    dump('settings-nav', r);
    const pass =
      r.fromTitle === 'settings' &&
      r.backToTitle.status === 'title' && r.backToTitle.overlay === null &&
      r.fromPause === 'settings' &&
      r.backToPause.overlay === 'pause' && r.backToPause.paused === true &&
      r.backToPause.status === 'playing';
    record('C4 settings opens from title and pause, returns correctly', pass, r);
  }

  // ---------- C5: sound + haptic toggles persist across reload ----------
  {
    const before = await page.evaluate(async () => {
      const G = window.__game;
      const step = () => new Promise((res) => requestAnimationFrame(res));
      G.closeSettings(); G.restart(); await step();
      const rs = G.getSettingsRect(); G.tapDesign(rs.x + rs.w / 2, rs.y + rs.h / 2);
      await step();
      const rSound = G.getSoundToggleRect(); G.tapDesign(rSound.x + rSound.w / 2, rSound.y + rSound.h / 2);
      const rHap = G.getHapticToggleRect(); G.tapDesign(rHap.x + rHap.w / 2, rHap.y + rHap.h / 2);
      await step();
      return G.getSettings();
    });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const after = await page.evaluate(() => ({ settings: window.__game.getSettings(), muted: window.__game.instance.muted }));
    dump('settings-persist', { before, after });
    const pass =
      before.soundOn === false && before.hapticOn === false &&
      after.settings.soundOn === false && after.settings.hapticOn === false &&
      after.muted === true;
    record('C5 sound and haptic toggles persist across reload', pass, { before, after });
  }

  // ---------- C6: reset progress is guarded, then actually resets ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      const step = () => new Promise((res) => requestAnimationFrame(res));
      G.resetSave();
      G.grantCoins(900);
      G.buySkin('bronze');
      const seeded = G.getState();

      G.restart(); await step();
      const rs = G.getSettingsRect(); G.tapDesign(rs.x + rs.w / 2, rs.y + rs.h / 2);
      await step();
      // first tap only ASKS
      const rr = G.getResetRect(); G.tapDesign(rr.x + rr.w / 2, rr.y + rr.h / 2);
      await step();
      const asked = G.getState();
      const afterAsk = { coins: asked.coins, unlocked: asked.unlockedSkins.length, overlay: asked.overlay };
      // now confirm
      const rc = G.getResetConfirmRect(); G.tapDesign(rc.x + rc.w / 2, rc.y + rc.h / 2);
      await step();
      return { seeded, afterAsk, afterConfirm: G.getState() };
    });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const persisted = await page.evaluate(() => window.__game.getState());
    dump('reset', { ...r, persisted });
    const pass =
      r.seeded.coins === 900 - 60 && r.seeded.unlockedSkins.length === 2 &&
      r.afterAsk.coins === r.seeded.coins &&           // nothing cleared before confirming
      r.afterAsk.unlocked === 2 &&
      r.afterConfirm.coins === 0 &&
      r.afterConfirm.unlockedSkins.length === 1 &&
      persisted.coins === 0 && persisted.unlockedSkins.length === 1;
    record('C6 reset progress is guarded then clears and persists', pass, {
      seededCoins: r.seeded.coins, afterAsk: r.afterAsk,
      afterConfirmCoins: r.afterConfirm.coins, persistedCoins: persisted.coins,
      persistedSkins: persisted.unlockedSkins.length,
    });
  }

  if (pageErrors.length) record('no page errors', false, { errors: pageErrors.slice(0, 5) });
  else record('no page errors', true, {});
} catch (err) {
  record('settings QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

fs.writeFileSync(path.join(EV, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ; evidence: ${EV} ===`);
process.exit(failed.length ? 1 : 0);
