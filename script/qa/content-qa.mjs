#!/usr/bin/env node
// Content-depth QA — verifies the meta-progression systems layered on the base game:
// fruit/coin economy, combo multiplier, boss stages, and shop unlock persistence.
// Usage: node script/qa/content-qa.mjs [--url http://127.0.0.1:8099] [--evidence-dir /tmp/ulw-knife-qa2]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const URL = argOf('--url', 'http://127.0.0.1:8099/');
const EV = argOf('--evidence-dir', '/tmp/ulw-knife-qa2');
fs.mkdirSync(EV, { recursive: true });

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const dump = (label, data) =>
  fs.writeFileSync(path.join(EV, `${label}.json`), JSON.stringify(data, null, 2));

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

  // ---------- C1: fruit hit awards coins ----------
  {
    await page.evaluate(() => { window.__game.resetSave(); window.__game.restart(); window.__game.startGame(); });
    await page.waitForTimeout(400);
    // guarantee a fruit exists to aim at
    await page.evaluate(() => window.__game.spawnFruitForTest());
    const before = await page.evaluate(() => window.__game.getState());
    await page.evaluate(async () => {
      window.__game.throwAtFruit();
      await window.__game.settle();
    });
    const after = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'fruit.png') });
    dump('fruit', { before, after });
    const pass = after.coins > before.coins && after.fruitCollected > before.fruitCollected;
    record('C1 fruit hit awards coins', pass, {
      coins: [before.coins, after.coins],
      fruitCollected: [before.fruitCollected, after.fruitCollected],
    });
  }

  // ---------- C2: combo multiplier raises score gain ----------
  {
    await page.evaluate(() => { window.__game.restart(); window.__game.startGame(); });
    await page.waitForTimeout(400);
    const deltas = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const b = window.__game.getState().score;
        window.__game.throwAtFreeAngle();
        await window.__game.settle();
        out.push(window.__game.getState().score - b);
      }
      return out;
    });
    const after = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'combo.png') });
    dump('combo', { deltas, after });
    const pass = after.combo === 3 && deltas[2] > deltas[0];
    record('C2 combo multiplier scales score gain', pass, { deltas, combo: after.combo });
  }

  // ---------- C3: boss stage needs multiple hits ----------
  {
    await page.evaluate(() => { window.__game.restart(); window.__game.startGame(); window.__game.jumpToStage(5); });
    await page.waitForTimeout(700);
    const atBoss = await page.evaluate(() => window.__game.getState());
    const hpTrail = await page.evaluate(async () => {
      const t = [window.__game.getState().bossHp];
      for (let i = 0; i < 2; i++) {
        window.__game.throwAtFreeAngle();
        await window.__game.settle();
        t.push(window.__game.getState().bossHp);
      }
      return t;
    });
    const midBoss = await page.evaluate(() => window.__game.getState());
    await page.screenshot({ path: path.join(EV, 'boss.png') });
    dump('boss', { atBoss, hpTrail, midBoss });
    const pass =
      atBoss.isBoss === true &&
      atBoss.stage === 5 &&
      hpTrail[0] > hpTrail[hpTrail.length - 1] && // hp actually drops
      hpTrail[hpTrail.length - 1] > 0 &&          // not one-shot
      midBoss.stage === 5;                        // stage held until hp hits 0
    record('C3 boss stage requires multiple hits', pass, {
      isBoss: atBoss.isBoss, stage: [atBoss.stage, midBoss.stage], hpTrail,
    });
  }

  // ---------- C4: shop purchase + equip survives reload ----------
  {
    const bought = await page.evaluate(() => {
      window.__game.resetSave();
      window.__game.grantCoins(9999);
      const locked = window.__game.getShop().find((s) => !s.unlocked);
      if (!locked) throw new Error('no locked skin available to buy');
      const ok = window.__game.buySkin(locked.id);
      const eq = window.__game.equipSkin(locked.id);
      return { id: locked.id, price: locked.price, ok, eq, state: window.__game.getState() };
    });
    await page.reload({ waitUntil: 'load' });
    await ready();
    const afterReload = await page.evaluate((id) => {
      const s = window.__game.getShop().find((x) => x.id === id);
      return { skin: s, state: window.__game.getState() };
    }, bought.id);
    await page.screenshot({ path: path.join(EV, 'shop.png') });
    dump('shop', { bought, afterReload });
    const pass =
      bought.ok === true &&
      afterReload.skin.unlocked === true &&
      afterReload.state.equippedSkin === bought.id &&
      afterReload.state.coins === 9999 - bought.price;
    record('C4 shop purchase and equip persist across reload', pass, {
      id: bought.id,
      unlocked: afterReload.skin.unlocked,
      equipped: afterReload.state.equippedSkin,
      coins: afterReload.state.coins,
      expectedCoins: 9999 - bought.price,
    });
  }

  if (pageErrors.length) record('no page errors', false, { errors: pageErrors.slice(0, 5) });
  else record('no page errors', true, {});
} catch (err) {
  record('content QA run completed', false, { error: String(err && err.message ? err.message : err) });
} finally {
  await ctx.close();
  await browser.close();
}

fs.writeFileSync(path.join(EV, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ; evidence: ${EV} ===`);
process.exit(failed.length ? 1 : 0);
