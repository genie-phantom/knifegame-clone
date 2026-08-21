// 칼칼칼 — knife throwing game.
// 2D canvas port of the original PlayCanvas build's mechanics:
// gameManager.js / treeController.js / knife.js / stageChecker.js / pointChecker.js
import { PATTERNS, stageConfig } from './patterns.js';
import { save } from './save.js';
import { SKINS, skinById, drawSkin } from './skins.js';

// ---- tuning constants (values from the original scene attributes) ----
const KNIFE_SPEED = 1650;      // px/s upward flight (orig knifeSpeed 20 world units/s)
const BACK_SPEED = 900;        // bounce-back speed after a failed hit
const BACK_SPIN = 720;         // deg/s spin while bouncing away
const RESULT_DELAY = 1.0;      // seconds before the game-over panel appears
const RESPAWN_DELAY = 1.0;     // seconds the new log stays hidden between stages
const LERP_COUNT = 2.3;        // seconds to lerp toward a new rotation speed
const HIT_TOLERANCE_DEG = 11;  // angular half-width of a knife for collision

// ---- content-depth tuning ----
const BOSS_EVERY = 5;          // every Nth stage is a boss
const FRUIT_COIN = 3;          // coins per fruit
const COMBO_STEP = 0.5;        // score multiplier gained per combo level
const COMBO_MAX = 5;           // multiplier ceiling
const FRUIT_TOLERANCE_DEG = 15;// fruit is a slightly fatter target than a knife
const STAGE_CLEAR_COINS = 5;   // coins for clearing a normal stage
const BOSS_CLEAR_COINS = 25;   // coins for felling a boss

const DESIGN_W = 420;
const DESIGN_H = 860;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm360 = (d) => ((d % 360) + 360) % 360;
// shortest absolute angular distance between two headings
const angDist = (a, b) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};

export class KnifeGame {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);

    this.status = 'title'; // title | playing | gameover | shop
    this.stage = 0;
    this.score = 0;
    this.best = save.best;
    this.knivesLeft = 0;

    // content-depth state
    this.coins = save.coins;
    this.combo = 0;
    this.bestCombo = 0;
    this.runCoins = 0;
    this.fruitCollected = save.fruitCollected;
    this.comboPulse = 0;
    this.coinPulse = 0;
    this.floaters = [];      // floating score/coin text
    this.sparks = [];        // spark flipbook instances
    this.shopScroll = 0;
    this.shopMessage = '';
    this.shopMessageT = 0;

    this.log = null;
    this.flying = [];     // knives in flight or bouncing away
    this._titleLog();
    this.hasKnifeReady = false;
    this.overlayAlpha = 0;
    this.gameOverVisible = false;
    this.resultTimer = 0;

    this.particles = [];
    this.shake = 0;
    this.scorePulse = 0;
    this.stagePulse = 0;
    this.hitFlash = 0;
    this.muted = save.muted;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.lastTime = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---------------- layout ----------------
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // letterbox the 420x860 design space
    this.scale = Math.min(w / DESIGN_W, h / DESIGN_H);
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.offX = (w - DESIGN_W * this.scale) / 2;
    this.offY = (h - DESIGN_H * this.scale) / 2;
  }

  get logCenter() { return { x: DESIGN_W / 2, y: 366 }; }
  get logRadius() { return 132; }
  get knifeStartY() { return 690; }

  // ---------------- lifecycle ----------------
  startGame() {
    if (this.status === 'playing') return;
    this.status = 'playing';
    this.stage = 0;
    this.score = 0;
    this.knivesLeft = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.runCoins = 0;
    this.flying.length = 0;
    this.particles.length = 0;
    this.floaters.length = 0;
    this.gameOverVisible = false;
    this.log = null;
    this._nextStage(0);
    this._spawnKnife();
    this.sfx('click');
  }

  restart() {
    this.status = 'title';
    this.stage = 0;
    this.score = 0;
    this.knivesLeft = 0;
    this.combo = 0;
    this.flying.length = 0;
    this.particles.length = 0;
    this.floaters.length = 0;
    this.gameOverVisible = false;
    this.hasKnifeReady = false;
    this._titleLog();
  }

  openShop() { if (this.status === 'title') this.status = 'shop'; }
  closeShop() { if (this.status === 'shop') this.status = 'title'; }

  get isBoss() { return this.log ? !!this.log.boss : false; }
  // Multiplier reflects the streak ALREADY banked, so the first hit of a run
  // scores a plain 1 and the bonus only builds from the second hit on.
  get multiplier() { return Math.min(1 + Math.max(0, this.combo - 1) * COMBO_STEP, COMBO_MAX); }

  // Idle log spinning behind the title card, like the original's home screen.
  _titleLog() {
    const pat = PATTERNS.Tree_e_1;
    this.log = {
      name: 'title',
      angle: 0,
      sequences: pat.sequences,
      seqIndex: 0,
      speed: 60,
      targetSpeed: 60,
      isReverse: false,
      timer: 999,
      lerpTimer: 0,
      knives: [],
      fruits: [],
      boss: null,
      hiddenTimer: 0,
      shakeT: 0,
    };
  }

  // Fruit sits at a free angle on the rim; hitting it pays coins instead of
  // ending the run, so it rewards precision without punishing a near miss.
  _spawnFruits(log, count) {
    for (let i = 0; i < count; i++) {
      const a = this._freeAngleOn(log, 30);
      if (a === null) return;
      log.fruits.push({ angle: a, alive: true, pop: 0 });
    }
  }

  // Find an angle clear of every knife AND fruit already on the log.
  _freeAngleOn(log, minGap) {
    const taken = [
      ...log.knives.map((k) => k.angle),
      ...log.fruits.filter((f) => f.alive).map((f) => f.angle),
    ];
    const start = Math.random() * 360;
    for (let step = 0; step < 120; step++) {
      const a = norm360(start + step * 3);
      if (taken.every((t) => angDist(t, a) > minGap)) return a;
    }
    return null;
  }

  // Mirrors gameManager.resetStage: pick a random pattern for the stage,
  // seed the pre-stuck knives, reset the required knife count.
  _nextStage(delay) {
    const cfg = stageConfig(this.stage);
    const names = cfg.patterns;
    const name = names[Math.floor(Math.random() * names.length)];
    const pat = PATTERNS[name];

    // Every BOSS_EVERY-th stage (1-indexed) is a boss: a tougher target that
    // soaks several hits before it breaks, and pays out accordingly.
    const stageNo = this.stage + 1;
    const isBoss = stageNo % BOSS_EVERY === 0;
    const bossHp = isBoss ? 3 + Math.floor(this.stage / BOSS_EVERY) : 0;

    this.knivesLeft = (isBoss ? bossHp + 2 : cfg.requireKnife) + 1;
    this.log = {
      name,
      angle: 0,
      sequences: pat.sequences,
      seqIndex: 0,
      speed: pat.sequences[0].speed,
      targetSpeed: pat.sequences[0].speed,
      isReverse: pat.sequences[0].isReverse,
      timer: pat.sequences[0].duration,
      lerpTimer: LERP_COUNT,
      // knives stick in LOCAL log space; they rotate with the log
      knives: pat.initialKnives.map((a) => ({ angle: norm360(a), initial: true })),
      fruits: [],
      boss: isBoss ? { hp: bossHp, maxHp: bossHp, flash: 0 } : null,
      hiddenTimer: delay,
      shakeT: 0,
    };

    // Fruit appears from stage 2 on, more often later; bosses always carry one.
    const fruitCount = isBoss ? 1 : (this.stage >= 1 && Math.random() < 0.55 ? 1 : 0);
    if (fruitCount) this._spawnFruits(this.log, fruitCount);

    this.stagePulse = 1;
  }

  // Mirrors gameManager.spawnKnife: decrement first, advance stage when exhausted.
  // A boss stage refuses to advance until its HP is gone.
  _spawnKnife() {
    this.knivesLeft--;
    if (this.knivesLeft < 0) {
      if (this.log && this.log.boss && this.log.boss.hp > 0) {
        // out of knives with the boss still standing: give one more so the
        // run ends on a real miss rather than a silent stall
        this.knivesLeft = 0;
        this.hasKnifeReady = true;
        return;
      }
      this._clearStage();
      return;
    }
    this.hasKnifeReady = true;
  }

  _clearStage() {
    const wasBoss = this.isBoss;
    this.stage++;
    save.addStagesCleared(1);
    this._awardCoins(wasBoss ? BOSS_CLEAR_COINS : STAGE_CLEAR_COINS,
      this.logCenter.x, this.logCenter.y, wasBoss ? 'BOSS!' : null);
    this._burstLog();
    this._nextStage(RESPAWN_DELAY);
    this._spawnKnife();
  }

  // Mirrors gameManager.onShoot guards.
  shoot() {
    if (this.status !== 'playing') return false;
    if (!this.hasKnifeReady) return false;
    if (!this.log || this.log.hiddenTimer > 0) return false;
    this.hasKnifeReady = false;
    this.flying.push({
      x: this.logCenter.x,
      y: this.knifeStartY,
      vy: -KNIFE_SPEED,
      spin: 0,
      rot: 0,
      failed: false,
    });
    this.sfx('click');
    return true;
  }

  // Mirrors treeController.onTriggerEnter: the impact angle is the log's own
  // current rotation, so the knife sticks at the log-local angle facing down.
  _impactAngle() {
    return norm360(-this.log.angle);
  }

  _occupied(localAngle) {
    return this.log.knives.some((k) => angDist(k.angle, localAngle) < HIT_TOLERANCE_DEG);
  }

  // A live fruit sitting at the impact angle, if any.
  _fruitAt(localAngle) {
    return this.log.fruits.find(
      (f) => f.alive && angDist(f.angle, localAngle) < FRUIT_TOLERANCE_DEG,
    );
  }

  _awardCoins(n, x, y, label) {
    this.coins = save.addCoins(n);
    this.runCoins += n;
    this.coinPulse = 1;
    this.floaters.push({
      x, y, vy: -46, t: 0, life: 1.0,
      text: label ? `${label} +${n}` : `+${n}`,
      color: '#ffd35c',
    });
  }

  _onStick(localAngle) {
    const fruit = this._fruitAt(localAngle);

    this.log.knives.push({ angle: localAngle, initial: false });
    this.log.shakeT = 0.22;
    this.shake = 7;
    this.hitFlash = 0.18;

    // combo grows per successful throw and scales the points awarded
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.comboPulse = 1;
    const gained = Math.round(1 * this.multiplier);
    this.score += gained;
    this.scorePulse = 1;
    if (this.score > this.best) {
      this.best = this.score;
      save.recordBest(this.score);
    }

    const pos = this._rimPoint(localAngle);
    // nudge the multiplier popup toward the log centre so it never lands on
    // the boss bar or the score readout above the target
    if (this.combo >= 2) {
      const c = this.logCenter;
      this.floaters.push({
        x: pos.x + (c.x - pos.x) * 0.55,
        y: pos.y + (c.y - pos.y) * 0.55,
        vy: -40, t: 0, life: 0.85,
        text: `x${this.multiplier.toFixed(1)}`,
        color: '#9ce8ff',
      });
    }

    if (fruit) {
      fruit.alive = false;
      fruit.pop = 0.4;
      this.fruitCollected++;
      save.addFruit(1);
      this._awardCoins(FRUIT_COIN, pos.x, pos.y - 22, null);
      this._fruitBurst(localAngle);
      this.sfx('bang');
    }

    // boss takes a hit; the stage will not advance until its HP is gone
    const boss = this.log.boss;
    if (boss && boss.hp > 0) {
      boss.hp--;
      boss.flash = 0.3;
      this.shake = 11;
      if (boss.hp === 0) {
        this.knivesLeft = 0;
        this._spark(pos.x, pos.y);
      }
    }

    this._woodChips(localAngle);
    this._spark(pos.x, pos.y);
    this.sfx('hit1');
    this._spawnKnife();
  }

  _onFail(knife) {
    knife.failed = true;
    knife.vy = BACK_SPEED;
    knife.spin = BACK_SPIN;
    this.shake = 12;
    this.combo = 0;
    this.status = 'gameover';
    this.resultTimer = RESULT_DELAY;
    save.recordBest(this.score);
    this._sparks();
    this.sfx('fail');
  }

  // World-space point on the log rim for a log-local angle.
  _rimPoint(localAngle) {
    const worldA = norm360(localAngle + this.log.angle);
    const rad = (worldA - 90) * Math.PI / 180;
    const c = this.logCenter;
    return { x: c.x + Math.cos(rad) * this.logRadius, y: c.y + Math.sin(rad) * this.logRadius };
  }

  // ---------------- effects ----------------
  _woodChips(localAngle) {
    const worldA = norm360(localAngle + this.log.angle);
    const rad = (worldA - 90) * Math.PI / 180;
    const c = this.logCenter;
    const px = c.x + Math.cos(rad) * this.logRadius;
    const py = c.y + Math.sin(rad) * this.logRadius;
    for (let i = 0; i < 10; i++) {
      const a = rad + (Math.random() - 0.5) * 1.9;
      const sp = 60 + Math.random() * 200;
      this.particles.push({
        x: px, y: py,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.45 + Math.random() * 0.35, t: 0,
        size: 2 + Math.random() * 4,
        color: ['#c89a5c', '#8f6237', '#6d4522'][i % 3],
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  // One instance of the 4x4 spark flipbook from the original game's atlas.
  _spark(x, y) {
    this.sparks.push({ x, y, t: 0, life: 0.4, rot: Math.random() * Math.PI * 2, scale: 0.5 + Math.random() * 0.35 });
  }

  _fruitBurst(localAngle) {
    const p = this._rimPoint(localAngle);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 280;
      this.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 110,
        life: 0.5 + Math.random() * 0.4, t: 0,
        size: 3 + Math.random() * 5,
        color: ['#e8455f', '#ff7d94', '#c22f45', '#6fc44a'][i % 4],
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      });
    }
  }

  _sparks() {
    const c = this.logCenter;
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 340;
      this.particles.push({
        x: c.x, y: c.y + this.logRadius * 0.75,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        life: 0.5 + Math.random() * 0.5, t: 0,
        size: 2 + Math.random() * 3,
        color: ['#ffd479', '#ff9a3c', '#fff3c4'][i % 3],
        rot: 0, vr: 0,
      });
    }
  }

  _burstLog() {
    if (!this.log) return;
    const c = this.logCenter;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 100 + Math.random() * 380;
      this.particles.push({
        x: c.x + (Math.random() - 0.5) * 120,
        y: c.y + (Math.random() - 0.5) * 120,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200,
        life: 0.7 + Math.random() * 0.5, t: 0,
        size: 4 + Math.random() * 9,
        color: ['#a97142', '#7b4b26', '#c89a5c', '#5c8b3a'][i % 4],
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      });
    }
    this.shake = 10;
    this.sfx('bang');
  }

  sfx(name) {
    if (this.muted) return;
    const a = this.assets.sfx[name];
    if (!a) return;
    try {
      const n = a.cloneNode();
      n.volume = name === 'fail' ? 0.7 : 0.5;
      n.play().catch(() => {});
    } catch { /* audio unavailable in headless */ }
  }

  // ---------------- update ----------------
  _loop(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = clamp(dt, 0, 0.05); // guard against tab-switch spikes
    this.update(dt);
    this.render();
    requestAnimationFrame(this._loop);
  }

  update(dt) {
    // decay visual timers
    this.shake = Math.max(0, this.shake - dt * 45);
    this.scorePulse = Math.max(0, this.scorePulse - dt * 4);
    this.stagePulse = Math.max(0, this.stagePulse - dt * 2);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    this.comboPulse = Math.max(0, this.comboPulse - dt * 3);
    this.coinPulse = Math.max(0, this.coinPulse - dt * 3);
    this.shopMessageT = Math.max(0, this.shopMessageT - dt);

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }

    // floating score / coin text
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) { this.floaters.splice(i, 1); continue; }
      f.y += f.vy * dt;
      f.vy += 34 * dt;
    }

    // spark flipbooks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.life) this.sparks.splice(i, 1);
    }

    if (this.log) {
      if (this.log.boss) this.log.boss.flash = Math.max(0, this.log.boss.flash - dt);
      for (const f of this.log.fruits) if (f.pop > 0) f.pop = Math.max(0, f.pop - dt);
    }

    if (this.log) {
      const L = this.log;
      if (L.hiddenTimer > 0) L.hiddenTimer -= dt;
      L.shakeT = Math.max(0, L.shakeT - dt);

      // treeController.update: lerp speed toward the phase target, then rotate
      L.lerpTimer -= dt;
      const amount = clamp(1 - L.lerpTimer / LERP_COUNT, 0, 1);
      L.speed = L.speed + (L.targetSpeed - L.speed) * amount * dt * 4;
      L.angle = norm360(L.angle + L.speed * dt * (L.isReverse ? -1 : 1));

      L.timer -= dt;
      if (L.timer < 0) {
        L.lerpTimer = LERP_COUNT;
        L.seqIndex = L.seqIndex + 1 > L.sequences.length - 1 ? 0 : L.seqIndex + 1;
        const s = L.sequences[L.seqIndex];
        L.targetSpeed = s.speed;
        L.timer = s.duration;
        L.isReverse = s.isReverse;
      }
    }

    // flying knives
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const k = this.flying[i];
      k.y += k.vy * dt;
      k.rot += k.spin * dt;
      if (k.failed) {
        if (k.y > DESIGN_H + 200) this.flying.splice(i, 1);
        continue;
      }
      const reach = this.logCenter.y + this.logRadius;
      if (k.y <= reach && this.log && this.log.hiddenTimer <= 0) {
        const local = this._impactAngle();
        if (this._occupied(local)) {
          this._onFail(k);
        } else {
          this.flying.splice(i, 1);
          this._onStick(local);
        }
      } else if (k.y < -200) {
        this.flying.splice(i, 1);
      }
    }

    // game-over panel after the result delay, once no knife is still on screen
    if (this.status === 'gameover' && !this.gameOverVisible) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.gameOverVisible = true;
    }
    this.overlayAlpha += ((this.gameOverVisible ? 1 : 0) - this.overlayAlpha) * clamp(dt * 8, 0, 1);
  }

  // ---------------- render ----------------
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // background fills the whole viewport (outside the letterbox too)
    this._drawBackground(ctx);

    ctx.save();
    ctx.translate(this.offX, this.offY);
    ctx.scale(this.scale, this.scale);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(sx, sy);

    if (this.log && this.log.hiddenTimer <= 0) this._drawLog(ctx);
    this._drawFlying(ctx);
    this._drawParticles(ctx);
    this._drawSparks(ctx);
    this._drawFloaters(ctx);
    ctx.restore();

    // HUD + overlays in design space without shake
    ctx.save();
    ctx.translate(this.offX, this.offY);
    ctx.scale(this.scale, this.scale);
    if (this.status === 'playing' || this.status === 'gameover') this._drawHud(ctx);
    if (this.status === 'title') this._drawTitle(ctx);
    if (this.status === 'shop') this._drawShop(ctx);
    if (this.overlayAlpha > 0.01) this._drawGameOver(ctx);
    ctx.restore();
  }

  _drawBackground(ctx) {
    const bg = this.assets.img.bg;
    ctx.fillStyle = '#413830';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (bg && bg.complete && bg.naturalWidth) {
      // cover-fit, then darken: the original tints this parchment map down to a
      // warm dark-brown backdrop so the log and knives read clearly.
      const r = Math.max(this.viewW / bg.naturalWidth, this.viewH / bg.naturalHeight);
      const w = bg.naturalWidth * r;
      const h = bg.naturalHeight * r;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(bg, (this.viewW - w) / 2, (this.viewH - h) / 2, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(46,38,31,0.55)';
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    // vignette, as in the original's post-effect
    const g = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.25,
      this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.72,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (this.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,236,180,${this.hitFlash * 0.35})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
  }

  _drawLog(ctx) {
    const c = this.logCenter;
    const L = this.log;
    const shakeOff = L.shakeT > 0 ? Math.sin(L.shakeT * 60) * 4 : 0;

    ctx.save();
    ctx.translate(c.x + shakeOff, c.y);

    // log sprite
    ctx.save();
    ctx.rotate(L.angle * Math.PI / 180);
    const img = this.assets.img.log;
    const d = this.logRadius * 2;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -d / 2, -d / 2, d, d);
    } else {
      ctx.fillStyle = '#a9814f';
      ctx.beginPath(); ctx.arc(0, 0, this.logRadius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b4526'; ctx.lineWidth = 14; ctx.stroke();
    }
    ctx.restore();

    // knives stuck in the log rotate with it; drawn ON TOP so the handles
    // protrude past the bark like the original.
    ctx.save();
    ctx.rotate(L.angle * Math.PI / 180);
    for (const k of L.knives) this._drawStuckKnife(ctx, k.angle);
    for (const f of L.fruits) this._drawFruit(ctx, f, L.angle);
    ctx.restore();
    ctx.restore();

    if (L.boss) this._drawBossBar(ctx, L.boss);
  }

  // Apple riding the rim. It is counter-rotated by the log's angle so the
  // fruit always stays upright while the log spins underneath it.
  _drawFruit(ctx, fruit, logAngle) {
    if (!fruit.alive && fruit.pop <= 0) return;
    ctx.save();
    ctx.rotate(fruit.angle * Math.PI / 180);
    ctx.translate(0, this.logRadius - 2);
    ctx.rotate(-(fruit.angle + logAngle) * Math.PI / 180);

    const s = fruit.alive ? 1 : 1 + (0.4 - fruit.pop) * 2;
    ctx.scale(s, s);
    ctx.globalAlpha = fruit.alive ? 1 : Math.max(0, fruit.pop / 0.4);

    // stem
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#6b4526';
    ctx.moveTo(0, -10);
    ctx.quadraticCurveTo(2, -16, 6, -18);
    ctx.stroke();
    // leaf
    ctx.beginPath();
    ctx.ellipse(11, -17, 8, 4.5, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#6fc44a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(38,60,22,0.85)';
    ctx.stroke();
    // body: two lobes so it reads as an apple, not a ball
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 17);
    g.addColorStop(0, '#ff8fa3');
    g.addColorStop(0.55, '#e8455f');
    g.addColorStop(1, '#b0243a');
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.bezierCurveTo(-16, -14, -16, 10, 0, 13);
    ctx.bezierCurveTo(16, 10, 16, -14, 0, -9);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(60,14,22,0.9)';
    ctx.stroke();
    // highlight
    ctx.beginPath();
    ctx.ellipse(-6, -3, 3.2, 5, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.restore();
  }

  _drawBossBar(ctx, boss) {
    const c = this.logCenter;
    const w = 168, h = 12;
    const x = c.x - w / 2, y = c.y - this.logRadius - 26;
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,10,0.7)';
    this._roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 7);
    ctx.fill();
    const frac = Math.max(0, boss.hp / boss.maxHp);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ff5b47');
    g.addColorStop(1, '#ffa23c');
    ctx.fillStyle = g;
    this._roundRect(ctx, x, y, Math.max(2, w * frac), h, 5);
    ctx.fill();
    ctx.fillStyle = '#ffe9c4';
    ctx.font = '700 15px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`BOSS  ${boss.hp}/${boss.maxHp}`, c.x, y - 7);
    ctx.restore();
  }

  // A stuck knife sits at `localAngle` on the log rim: tip buried toward the
  // centre, handle sticking outward.
  _drawStuckKnife(ctx, localAngle) {
    ctx.save();
    // localAngle 0 = straight down (the impact point knives fly in from).
    // Canvas +y is down, so angle 0 needs no extra rotation: the sprite's
    // tip->handle axis (+y) already points outward/down from the centre.
    ctx.rotate(localAngle * Math.PI / 180);
    // Sprite runs tip(origin) -> handle(+y). Placing the tip at radius R-34
    // buries the blade in the log and leaves the handle sticking out past
    // the bark, exactly like the original.
    ctx.translate(0, this.logRadius - 34);
    this._drawKnifeSprite(ctx, 1);
    ctx.restore();
  }

  // Knife sprite: tip at the local origin, pointing UP (-y); handle trails at +y.
  // Delegates to the equipped skin; `classic` uses the original dagger.png.
  _drawKnifeSprite(ctx, scale = 1, skinOverride = null) {
    const skin = skinOverride || skinById(save.equipped);
    if (scale !== 1) {
      ctx.save();
      ctx.scale(scale, scale);
      drawSkin(ctx, skin, this.assets.img.dagger);
      ctx.restore();
      return;
    }
    drawSkin(ctx, skin, this.assets.img.dagger);
  }

  _drawFlying(ctx) {
    for (const k of this.flying) {
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.rot * Math.PI / 180);
      // flying upward: sprite already runs tip-up from its origin
      ctx.translate(0, -108);
      this._drawKnifeSprite(ctx, 1);
      ctx.restore();
    }
    // the ready knife waiting at the bottom
    if (this.hasKnifeReady && this.status === 'playing') {
      ctx.save();
      ctx.translate(this.logCenter.x, this.knifeStartY);
      ctx.translate(0, -108);
      this._drawKnifeSprite(ctx, 1);
      ctx.restore();
    }
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      const a = 1 - p.t / p.life;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  // 4x4 flipbook from the original spark atlas (11_1024.png).
  _drawSparks(ctx) {
    const img = this.assets.img.spark;
    if (!img || !img.complete || !img.naturalWidth) return;
    const cell = img.naturalWidth / 4;
    for (const s of this.sparks) {
      const f = Math.min(15, Math.floor((s.t / s.life) * 16));
      const sxi = (f % 4) * cell;
      const syi = Math.floor(f / 4) * cell;
      const d = 150 * s.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.drawImage(img, sxi, syi, cell, cell, -d / 2, -d / 2, d, d);
      ctx.restore();
    }
  }

  _drawFloaters(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const k = f.t / f.life;
      ctx.globalAlpha = clamp(1 - k * k, 0, 1);
      ctx.font = '700 22px "Jua", system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(40,26,16,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  _drawHud(ctx) {
    // stage pill
    ctx.save();
    const sp = 1 + this.stagePulse * 0.12;
    ctx.translate(DESIGN_W / 2, 74);
    ctx.scale(sp, sp);
    ctx.fillStyle = 'rgba(30,24,18,0.55)';
    this._roundRect(ctx, -66, -21, 132, 42, 21);
    ctx.fill();
    ctx.fillStyle = '#f3e4c8';
    ctx.font = '700 20px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`STAGE ${this.stage + 1}`, 0, 1);
    ctx.restore();

    // score (big, centered, bounces on gain — pointChecker.isBounce)
    ctx.save();
    const ps = 1 + this.scorePulse * 0.3;
    ctx.translate(DESIGN_W / 2, 138);
    ctx.scale(ps, ps);
    ctx.font = '700 54px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(45,30,18,0.8)';
    ctx.strokeText(String(this.score), 0, 0);
    ctx.fillStyle = '#fff6e2';
    ctx.fillText(String(this.score), 0, 0);
    ctx.restore();

    // best
    ctx.save();
    ctx.fillStyle = 'rgba(255,246,226,0.75)';
    ctx.font = '700 16px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`BEST ${this.best}`, DESIGN_W - 20, 74);
    ctx.restore();

    // coin counter
    ctx.save();
    const cp = 1 + this.coinPulse * 0.25;
    ctx.translate(74, 142);
    ctx.scale(cp, cp);
    this._drawCoin(ctx, 0, 0, 11);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 18px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.coins), 17, 1);
    ctx.restore();

    // combo badge
    if (this.combo >= 2) {
      ctx.save();
      const bp = 1 + this.comboPulse * 0.22;
      ctx.translate(DESIGN_W - 74, 142);
      ctx.scale(bp, bp);
      ctx.fillStyle = 'rgba(24,80,110,0.72)';
      this._roundRect(ctx, -52, -16, 104, 32, 16);
      ctx.fill();
      ctx.fillStyle = '#9ce8ff';
      ctx.font = '700 17px "Jua", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this.combo} COMBO`, 0, 1);
      ctx.restore();
    }

    // remaining knife pips at the bottom
    const total = stageConfig(this.stage).requireKnife + 1;
    const left = Math.max(0, this.knivesLeft + (this.hasKnifeReady ? 1 : 0));
    ctx.save();
    ctx.translate(DESIGN_W / 2, DESIGN_H - 58);
    const gap = 26;
    const startX = -((total - 1) * gap) / 2;
    for (let i = 0; i < total; i++) {
      ctx.save();
      ctx.translate(startX + i * gap, 0);
      ctx.globalAlpha = i < left ? 1 : 0.22;
      ctx.scale(0.42, 0.42);
      ctx.translate(0, -54);
      this._drawKnifeSprite(ctx, 1);
      ctx.restore();
    }
    ctx.restore();
  }

  _drawTitle(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 68px "Jua", system-ui, sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#5b2a20';
    ctx.strokeText('칼칼칼', DESIGN_W / 2, 160);
    ctx.fillStyle = '#fbeed6';
    ctx.fillText('칼칼칼', DESIGN_W / 2, 160);

    // instruction card
    ctx.fillStyle = '#e8d7b4';
    this._roundRect(ctx, 40, 530, DESIGN_W - 80, 190, 18);
    ctx.fill();
    ctx.strokeStyle = '#b99c6e';
    ctx.lineWidth = 3;
    this._roundRect(ctx, 40, 530, DESIGN_W - 80, 190, 18);
    ctx.stroke();

    ctx.fillStyle = '#6b3f27';
    ctx.font = '700 26px "Jua", system-ui, sans-serif';
    ctx.fillText('게임방법', DESIGN_W / 2, 568);
    ctx.font = '700 18px "Jua", system-ui, sans-serif';
    ctx.fillText('터치하면 칼이 날아가요.', DESIGN_W / 2, 690);

    ctx.save();
    ctx.translate(DESIGN_W / 2, 600);
    ctx.scale(0.62, 0.62);
    ctx.translate(0, -54);
    this._drawKnifeSprite(ctx, 1);
    ctx.restore();

    // start button
    ctx.fillStyle = '#f5c132';
    this._roundRect(ctx, 40, 742, 226, 60, 12);
    ctx.fill();
    ctx.strokeStyle = '#c9942a';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 40, 742, 226, 60, 12);
    ctx.stroke();
    ctx.fillStyle = '#4a2d13';
    ctx.font = '700 26px "Jua", system-ui, sans-serif';
    ctx.fillText('시작하기', 153, 773);

    // shop button
    ctx.fillStyle = '#7fb2d8';
    this._roundRect(ctx, 278, 742, 102, 60, 12);
    ctx.fill();
    ctx.strokeStyle = '#4d7fa5';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 278, 742, 102, 60, 12);
    ctx.stroke();
    ctx.fillStyle = '#17303f';
    ctx.font = '700 22px "Jua", system-ui, sans-serif';
    ctx.fillText('상점', 329, 773);

    // coin balance
    this._drawCoin(ctx, DESIGN_W / 2 - 34, 714, 12);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 20px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.coins), DESIGN_W / 2 - 16, 715);
    ctx.restore();
  }

  // ---------------- shop ----------------
  // Grid of skins; tapping a card buys it (if affordable) or equips it.
  shopCardRects() {
    const cols = 3, cw = 118, ch = 138, gapX = 8, gapY = 10;
    const x0 = (DESIGN_W - (cols * cw + (cols - 1) * gapX)) / 2;
    const y0 = 176 - this.shopScroll;
    return SKINS.map((s, i) => ({
      skin: s,
      x: x0 + (i % cols) * (cw + gapX),
      y: y0 + Math.floor(i / cols) * (ch + gapY),
      w: cw, h: ch,
    }));
  }

  get shopMaxScroll() {
    const rows = Math.ceil(SKINS.length / 3);
    return Math.max(0, 176 + rows * 148 - (DESIGN_H - 120));
  }

  buySkin(id) {
    const skin = skinById(id);
    if (save.isUnlocked(id)) return false;
    if (!save.spendCoins(skin.price)) {
      this.shopMessage = '코인이 부족해요';
      this.shopMessageT = 1.6;
      return false;
    }
    save.unlock(id);
    this.coins = save.coins;
    this.shopMessage = `${skin.name} 구매 완료!`;
    this.shopMessageT = 1.6;
    this.sfx('bang');
    return true;
  }

  equipSkin(id) {
    const ok = save.equip(id);
    if (ok) {
      this.shopMessage = `${skinById(id).name} 장착`;
      this.shopMessageT = 1.4;
      this.sfx('click');
    }
    return ok;
  }

  getShop() {
    return SKINS.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      unlocked: save.isUnlocked(s.id),
      equipped: save.equipped === s.id,
    }));
  }

  _drawShop(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,15,11,0.94)';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

    // header
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbeed6';
    ctx.font = '700 34px "Jua", system-ui, sans-serif';
    ctx.fillText('상점', DESIGN_W / 2, 74);
    this._drawCoin(ctx, DESIGN_W / 2 - 36, 116, 13);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 22px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.coins), DESIGN_W / 2 - 16, 117);

    // cards, clipped to the scroll viewport
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 150, DESIGN_W, DESIGN_H - 232);
    ctx.clip();
    for (const r of this.shopCardRects()) {
      const unlocked = save.isUnlocked(r.skin.id);
      const equipped = save.equipped === r.skin.id;
      const affordable = this.coins >= r.skin.price;

      ctx.fillStyle = equipped ? '#3f5c46' : unlocked ? '#3d3630' : '#2b2622';
      this._roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.lineWidth = equipped ? 3 : 2;
      ctx.strokeStyle = equipped
        ? '#9fe0ab'
        : unlocked ? 'rgba(255,240,214,0.30)' : 'rgba(255,240,214,0.14)';
      this._roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.stroke();

      // knife preview
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + 20);
      ctx.scale(0.62, 0.62);
      ctx.globalAlpha = unlocked ? 1 : 0.42;
      this._drawKnifeSprite(ctx, 1, r.skin);
      ctx.restore();

      // name
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f3e4c8';
      ctx.font = '700 13px "Jua", system-ui, sans-serif';
      ctx.fillText(r.skin.name, r.x + r.w / 2, r.y + r.h - 34);

      // status line
      if (equipped) {
        ctx.fillStyle = '#9fe0ab';
        ctx.font = '700 13px "Jua", system-ui, sans-serif';
        ctx.fillText('장착중', r.x + r.w / 2, r.y + r.h - 14);
      } else if (unlocked) {
        ctx.fillStyle = '#cfe6ff';
        ctx.font = '700 13px "Jua", system-ui, sans-serif';
        ctx.fillText('장착하기', r.x + r.w / 2, r.y + r.h - 14);
      } else {
        this._drawCoin(ctx, r.x + r.w / 2 - 20, r.y + r.h - 14, 8);
        ctx.fillStyle = affordable ? '#ffe9a8' : '#a08c72';
        ctx.font = '700 14px "Jua", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(r.skin.price), r.x + r.w / 2 - 8, r.y + r.h - 13);
        ctx.textAlign = 'center';
      }
    }
    ctx.restore();

    // toast
    if (this.shopMessageT > 0) {
      ctx.globalAlpha = clamp(this.shopMessageT, 0, 1);
      ctx.fillStyle = 'rgba(30,22,16,0.9)';
      this._roundRect(ctx, 60, DESIGN_H - 150, DESIGN_W - 120, 40, 12);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = '700 17px "Jua", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.shopMessage, DESIGN_W / 2, DESIGN_H - 129);
      ctx.globalAlpha = 1;
    }

    // close button
    ctx.fillStyle = '#f5c132';
    this._roundRect(ctx, 110, DESIGN_H - 92, DESIGN_W - 220, 56, 12);
    ctx.fill();
    ctx.strokeStyle = '#c9942a';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 110, DESIGN_H - 92, DESIGN_W - 220, 56, 12);
    ctx.stroke();
    ctx.fillStyle = '#4a2d13';
    ctx.font = '700 22px "Jua", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('닫기', DESIGN_W / 2, DESIGN_H - 63);
    ctx.restore();
  }

  _drawGameOver(ctx) {
    const a = this.overlayAlpha;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,14,10,0.72)';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

    ctx.fillStyle = '#e8d7b4';
    this._roundRect(ctx, 46, 300, DESIGN_W - 92, 270, 20);
    ctx.fill();
    ctx.strokeStyle = '#b99c6e';
    ctx.lineWidth = 3;
    this._roundRect(ctx, 46, 300, DESIGN_W - 92, 270, 20);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8c3b2c';
    ctx.font = '700 34px "Jua", system-ui, sans-serif';
    ctx.fillText('게임 오버', DESIGN_W / 2, 352);

    ctx.fillStyle = '#6b3f27';
    ctx.font = '700 18px "Jua", system-ui, sans-serif';
    ctx.fillText('점수', DESIGN_W / 2, 396);
    ctx.font = '700 52px "Jua", system-ui, sans-serif';
    ctx.fillStyle = '#4a2d13';
    ctx.fillText(String(this.score), DESIGN_W / 2, 436);
    ctx.font = '700 17px "Jua", system-ui, sans-serif';
    ctx.fillStyle = '#6b3f27';
    ctx.fillText(`최고점수  ${this.best}`, DESIGN_W / 2, 474);

    // run stats: stage reached, best combo, coins earned
    ctx.font = '700 15px "Jua", system-ui, sans-serif';
    ctx.fillStyle = '#7d5334';
    ctx.fillText(`스테이지 ${this.stage + 1}    최대 콤보 ${this.bestCombo}`, DESIGN_W / 2, 505);
    this._drawCoin(ctx, DESIGN_W / 2 - 30, 534, 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a6415';
    ctx.font = '700 17px "Jua", system-ui, sans-serif';
    ctx.fillText(`+${this.runCoins}`, DESIGN_W / 2 - 14, 535);
    ctx.textAlign = 'center';

    ctx.fillStyle = '#f5c132';
    this._roundRect(ctx, 110, 600, DESIGN_W - 220, 60, 12);
    ctx.fill();
    ctx.strokeStyle = '#c9942a';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 110, 600, DESIGN_W - 220, 60, 12);
    ctx.stroke();
    ctx.fillStyle = '#4a2d13';
    ctx.font = '700 24px "Jua", system-ui, sans-serif';
    ctx.fillText('다시하기', DESIGN_W / 2, 631);
    ctx.restore();
  }

  _drawCoin(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
    g.addColorStop(0, '#ffe89a');
    g.addColorStop(1, '#e0a428');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.strokeStyle = '#9a6a12';
    ctx.stroke();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------- input ----------------
  // Design-space coordinates of a viewport point.
  toDesign(clientX, clientY) {
    return {
      x: (clientX - this.offX) / this.scale,
      y: (clientY - this.offY) / this.scale,
    };
  }

  handleTap(clientX, clientY) {
    const p = this.toDesign(clientX, clientY);

    if (this.status === 'title') {
      if (p.y > 742 && p.y < 802 && p.x > 278 && p.x < 380) { this.openShop(); return; }
      this.startGame();
      return;
    }

    if (this.status === 'shop') {
      if (p.y > DESIGN_H - 92 && p.y < DESIGN_H - 36) { this.closeShop(); return; }
      for (const r of this.shopCardRects()) {
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
          if (p.y < 150 || p.y > DESIGN_H - 100) return; // outside the viewport
          if (save.isUnlocked(r.skin.id)) this.equipSkin(r.skin.id);
          else this.buySkin(r.skin.id);
          return;
        }
      }
      return;
    }

    if (this.status === 'gameover') {
      if (this.gameOverVisible) { this.restart(); this.startGame(); }
      return;
    }
    this.shoot();
  }

  // Vertical drag / wheel scroll for the shop grid.
  scrollShop(dy) {
    if (this.status !== 'shop') return;
    this.shopScroll = clamp(this.shopScroll + dy, 0, this.shopMaxScroll);
  }

  // ---------------- test API ----------------
  getState() {
    const L = this.log;
    return {
      status: this.status,
      stage: this.stage + 1,
      score: this.score,
      best: this.best,
      knivesLeft: this.knivesLeft + (this.hasKnifeReady ? 1 : 0),
      stageRequiredKnives: stageConfig(this.stage).requireKnife + 1,
      stuckKnives: L ? L.knives.length : 0,
      pattern: L ? L.name : null,
      rotationSpeedProfile: L ? L.sequences.map((s) => `${s.speed}${s.isReverse ? 'r' : ''}`).join(',') : null,
      flying: this.flying.length,
      logHidden: L ? L.hiddenTimer > 0 : true,
      // content-depth fields
      coins: this.coins,
      combo: this.combo,
      bestCombo: this.bestCombo,
      multiplier: this.multiplier,
      runCoins: this.runCoins,
      fruitCollected: this.fruitCollected,
      fruitsOnLog: L ? L.fruits.filter((f) => f.alive).length : 0,
      isBoss: L ? !!L.boss : false,
      bossHp: L && L.boss ? L.boss.hp : 0,
      bossMaxHp: L && L.boss ? L.boss.maxHp : 0,
      equippedSkin: save.equipped,
      unlockedSkins: save.unlockedIds(),
      stagesCleared: save.stagesCleared,
    };
  }
}
