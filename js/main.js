import { KnifeGame } from './game.js';
import { save, __setDayOffset } from './save.js';

const IMG = {
  bg: 'assets/img/bg.png',
  log: 'assets/img/log.png',
  dagger: 'assets/img/dagger.png',
  spark: 'assets/img/spark.png',
};
const SFX = {
  hit1: 'assets/sfx/hit1.mp3',
  fail: 'assets/sfx/fail.mp3',
  click: 'assets/sfx/click.mp3',
  bang: 'assets/sfx/bang.mp3',
};

const loadImage = (src) =>
  new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(i); // game renders vector fallbacks if art is missing
    i.src = src;
  });

const loadAudio = (src) =>
  new Promise((res) => {
    const a = new Audio();
    a.preload = 'auto';
    a.oncanplaythrough = () => res(a);
    a.onerror = () => res(a);
    a.src = src;
    setTimeout(() => res(a), 1500);
  });

const assets = { img: {}, sfx: {} };

await Promise.all([
  ...Object.entries(IMG).map(async ([k, v]) => { assets.img[k] = await loadImage(v); }),
  ...Object.entries(SFX).map(async ([k, v]) => { assets.sfx[k] = await loadAudio(v); }),
]);

const canvas = document.getElementById('game');
const game = new KnifeGame(canvas, assets);

const tap = (x, y) => game.handleTap(x, y);

// Pointer handling. Outside the shop a press acts immediately so throwing stays
// as responsive as the original. In the shop the action is deferred to release
// and suppressed when the pointer was dragged, so scrolling never buys a skin.
let press = null;

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  press = { x: e.clientX, y: e.clientY, moved: 0, shop: game.status === 'shop' };
  if (!press.shop) tap(e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  const dy = press.y - e.clientY;
  press.moved += Math.abs(dy) + Math.abs(press.x - e.clientX);
  press.x = e.clientX;
  press.y = e.clientY;
  if (press.shop) game.scrollShop(dy);
});

const endPress = (e) => {
  if (!press) return;
  if (press.shop && press.moved < 12) tap(e.clientX, e.clientY);
  press = null;
};
canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', () => { press = null; });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    tap(window.innerWidth / 2, window.innerHeight / 2);
  }
});

// Sound now lives in the in-game settings panel, so there is no floating
// HTML control competing with the canvas UI.

// shop grid scrolling with a mouse wheel
canvas.addEventListener('wheel', (e) => {
  if (game.status !== 'shop') return;
  e.preventDefault();
  game.scrollShop(e.deltaY);
}, { passive: false });

// ---- deterministic control surface used by script/qa/knife-qa.mjs ----
const norm360 = (d) => ((d % 360) + 360) % 360;
const angDist = (a, b) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};

// Rotate the log so that the impact angle (-log.angle) lands where we want,
// then fire. This exercises the SAME shoot()/collision path a real tap does.
function aimLogAt(localTargetAngle) {
  game.log.angle = norm360(-localTargetAngle);
}

// An angle clear of both stuck knives and live fruit, so a "plain" test throw
// never accidentally collects a fruit and skews coin/combo assertions.
function freeLocalAngle() {
  const taken = [
    ...game.log.knives.map((k) => k.angle),
    ...game.log.fruits.filter((f) => f.alive).map((f) => f.angle),
  ];
  for (let a = 0; a < 360; a += 3) {
    if (taken.every((t) => angDist(t, a) > 26)) return a;
  }
  return 0;
}

const settle = () =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const s = game.getState();
      const done = s.flying === 0 && !s.logHidden;
      if (done || performance.now() - t0 > 4000) resolve(s);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

window.__game = {
  ready: true,
  instance: game,
  getState: () => game.getState(),
  startGame: () => game.startGame(),
  restart: () => game.restart(),
  settle,
  isGameOverOverlayVisible: () => game.gameOverVisible === true && game.overlayAlpha > 0.5,
  throwAtFreeAngle() {
    aimLogAt(freeLocalAngle());
    game.log.speed = 0;
    game.log.targetSpeed = 0;
    game.log.timer = 99;
    return game.shoot();
  },
  throwAtOccupiedAngle() {
    const taken = game.log.knives;
    if (!taken.length) throw new Error('no stuck knife to collide with');
    aimLogAt(taken[taken.length - 1].angle);
    game.log.speed = 0;
    game.log.targetSpeed = 0;
    game.log.timer = 99;
    return game.shoot();
  },

  // ---- content-depth test surface ----
  spawnFruitForTest() {
    game.log.fruits.length = 0;
    game._spawnFruits(game.log, 1);
    return game.log.fruits.map((f) => f.angle);
  },
  throwAtFruit() {
    const fruit = game.log.fruits.find((f) => f.alive);
    if (!fruit) throw new Error('no live fruit to aim at');
    aimLogAt(fruit.angle);
    game.log.speed = 0;
    game.log.targetSpeed = 0;
    game.log.timer = 99;
    return game.shoot();
  },
  jumpToStage(stageNo) {
    game.stage = stageNo - 1;
    game._nextStage(0);
    game.hasKnifeReady = false;
    game._spawnKnife();
    return game.getState();
  },
  grantCoins: (n) => game.coins = save.addCoins(n),
  getShop: () => game.getShop(),
  buySkin: (id) => game.buySkin(id),
  equipSkin: (id) => game.equipSkin(id),
  openShop: () => game.openShop(),
  closeShop: () => game.closeShop(),
  resetSave() {
    __setDayOffset(0);
    save.reset();
    game.coins = save.coins;
    game.best = save.best;
    game.fruitCollected = save.fruitCollected;
  },

  // ---- retention test surface ----
  getQuests: () => game.getQuests(),
  getDaily: () => game.getDaily(),
  claimQuest: (id) => game.claimQuest(id),
  claimDaily: () => game.claimDaily(),
  openQuests: () => game.openQuests(),
  closeQuests: () => game.closeQuests(),
  debugSetQuestProgress: (id, v) => save.setQuestProgress(id, v),

  // ---- exit-to-title test surface ----
  getExitRect: () => game.getExitRect(),
  getExitConfirmRect: () => game.getExitConfirmRect(),
  getExitCancelRect: () => game.getExitCancelRect(),
  getHomeRect: () => game.getHomeRect(),
  getReplayRect: () => game.getReplayRect(),

  // ---- pause / settings test surface ----
  getPauseRect: () => game.getPauseRect(),
  getResumeRect: () => game.getResumeRect(),
  getPauseSettingsRect: () => game.getPauseSettingsRect(),
  getQuitRect: () => game.getQuitRect(),
  getSettingsRect: () => game.getSettingsRect(),
  getSettingsCloseRect: () => game.getSettingsCloseRect(),
  getSoundToggleRect: () => game.getSoundToggleRect(),
  getHapticToggleRect: () => game.getHapticToggleRect(),
  getResetRect: () => game.getResetRect(),
  getResetConfirmRect: () => game.getResetConfirmRect(),
  getResetCancelRect: () => game.getResetCancelRect(),
  getSettings: () => game.getSettings(),
  openSettings: () => game.openSettings(),
  closeSettings: () => game.closeSettings(),
  pause: () => game.pause(),
  resume: () => game.resume(),
  // Convert design-space coords to client coords and go through the REAL tap
  // handler, so tests exercise the same path a finger does.
  tapDesign(dx, dy) {
    game.handleTap(game.offX + dx * game.scale, game.offY + dy * game.scale);
  },
  debugAdvanceDay: (n) => { __setDayOffset(n); return game.getQuests(); },
};
