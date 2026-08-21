import { KnifeGame } from './game.js';

const IMG = {
  bg: 'assets/img/bg.png',
  log: 'assets/img/log.png',
  dagger: 'assets/img/dagger.png',
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

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tap(e.clientX, e.clientY);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    tap(window.innerWidth / 2, window.innerHeight / 2);
  }
});

document.getElementById('sound').addEventListener('click', (e) => {
  e.stopPropagation();
  game.muted = !game.muted;
  localStorage.setItem('kkk_muted', game.muted ? '1' : '0');
  e.currentTarget.textContent = game.muted ? '🔇' : '🔊';
});

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

function freeLocalAngle() {
  const taken = game.log.knives.map((k) => k.angle);
  for (let a = 0; a < 360; a += 3) {
    if (taken.every((t) => angDist(t, a) > 24)) return a;
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
};
