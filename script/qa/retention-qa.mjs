#!/usr/bin/env node
// Retention + bugfix QA.
// Covers the two boss-stage bugs and the daily quest / login streak systems.
// Usage: node script/qa/retention-qa.mjs [--url ...] [--evidence-dir ...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const URL = argOf('--url', 'http://127.0.0.1:8099/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa3');
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

  // ---------- C1: a boss stage must be losable by running out of knives ----------
  {
    const r = await page.evaluate(() => {
      const G = window.__game, g = G.instance;
      G.resetSave(); G.restart(); G.startGame(); G.jumpToStage(5);
      const land = () => {
        const nd = (d) => ((d % 360) + 360) % 360;
        const ad = (a, b) => { const d = Math.abs(nd(a) - nd(b)); return d > 180 ? 360 - d : d; };
        const taken = [...g.log.knives.map(k => k.angle), ...g.log.fruits.filter(f => f.alive).map(f => f.angle)];
        let ang = 0;
        for (let a = 0; a < 360; a += 3) if (taken.every(t => ad(t, a) > 26)) { ang = a; break; }
        g._onStick(ang);
      };
      let throws = 0;
      const trail = [];
      while (throws < 30) {
        const s = G.getState();
        if (s.status !== 'playing') break;
        if (g.log.boss) g.log.boss.hp = 3;   // boss never dies
        g.log.fruits.length = 0;
        land();
        throws++;
        trail.push(G.getState().knivesLeft);
      }
      return { throws, status: G.getState().status, trail: trail.slice(0, 12) };
    });
    dump('boss-exhaust', r);
    // With a boss pinned alive, the knife supply must run out and end the run.
    const pass = r.throws < 30 && r.status !== 'playing';
    record('C1 boss stage is losable by knife exhaustion', pass, r);
  }

  // ---------- C2: HUD pip capacity matches the real knife allocation ----------
  {
    const r = await page.evaluate(() => {
      const G = window.__game;
      G.restart(); G.startGame();
      const seen = [];
      for (const stage of [1, 2, 5, 10]) {
        G.jumpToStage(stage);
        const s = G.getState();
        seen.push({
          stage: s.stage, isBoss: s.isBoss, bossHp: s.bossHp,
          knivesLeft: s.knivesLeft, stageRequiredKnives: s.stageRequiredKnives,
        });
      }
      return seen;
    });
    dump('pips', r);
    const pass = r.every((s) => s.knivesLeft <= s.stageRequiredKnives && s.stageRequiredKnives > 0);
    record('C2 stageRequiredKnives covers the real allocation', pass, r);
  }

  // ---------- C3: quest progress, claim once, reward exact ----------
  {
    const r = await page.evaluate(async () => {
      const G = window.__game;
      G.resetSave();
      const quests = G.getQuests();
      // force a deterministic, trivially completable quest set
      G.debugSetQuestProgress(quests[0].id, quests[0].goal);
      const before = G.getState().coins;
      const q = G.getQuests().find((x) => x.id === quests[0].id);
      const first = G.claimQuest(q.id);
      const afterFirst = G.getState().coins;
      const second = G.claimQuest(q.id);   // must be refused
      const afterSecond = G.getState().coins;
      return {
        questId: q.id, goal: q.goal, reward: q.reward, complete: q.complete,
        before, afterFirst, afterSecond, first, second,
      };
    });
    await page.screenshot({ path: path.join(EV, 'quest.png') });
    dump('quest', r);
    const pass =
      r.complete === true &&
      r.first === true &&
      r.afterFirst === r.before + r.reward &&
      r.second === false &&
      r.afterSecond === r.afterFirst;
    record('C3 quest completes, claims once, pays exact reward', pass, r);
  }

  // ---------- C4: quest state survives reload; a new day reissues quests ----------
  {
    const beforeReload = await page.evaluate(() => {
      const G = window.__game;
      G.resetSave();
      const q = G.getQuests();
      G.debugSetQuestProgress(q[0].id, 1);
      return { ids: G.getQuests().map((x) => x.id), progress: G.getQuests()[0].progress };
    });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const afterReload = await page.evaluate(() => ({
      ids: window.__game.getQuests().map((x) => x.id),
      progress: window.__game.getQuests()[0].progress,
    }));
    const afterDay = await page.evaluate(() => {
      window.__game.debugAdvanceDay(1);
      const q = window.__game.getQuests();
      return { ids: q.map((x) => x.id), progress: q[0].progress, claimed: q.filter((x) => x.claimed).length };
    });
    dump('quest-refresh', { beforeReload, afterReload, afterDay });
    const pass =
      JSON.stringify(beforeReload.ids) === JSON.stringify(afterReload.ids) &&
      afterReload.progress === beforeReload.progress &&
      afterDay.progress === 0 &&
      afterDay.claimed === 0;
    record('C4 quests persist across reload and refresh next day', pass, { beforeReload, afterReload, afterDay });
  }

  // ---------- C5: login streak escalates, resets after a missed day ----------
  {
    const r = await page.evaluate(() => {
      const G = window.__game;
      G.resetSave();
      const d1 = G.claimDaily();
      G.debugAdvanceDay(1);
      const d2 = G.claimDaily();
      G.debugAdvanceDay(3);          // skipped days
      const d3 = G.claimDaily();
      return { d1, d2, d3 };
    });
    dump('streak', r);
    const pass =
      r.d1.ok === true && r.d1.streak === 1 &&
      r.d2.ok === true && r.d2.streak === 2 && r.d2.reward >= r.d1.reward &&
      r.d3.ok === true && r.d3.streak === 1;
    record('C5 daily streak escalates and resets on a missed day', pass, r);
  }

  if (pageErrors.length) record('no page errors', false, { errors: pageErrors.slice(0, 5) });
  else record('no page errors', true, {});
} catch (err) {
  record('retention QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

fs.writeFileSync(path.join(EV, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ; evidence: ${EV} ===`);
process.exit(failed.length ? 1 : 0);
