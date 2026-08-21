// 칼칼칼 — knife throwing game.
// 2D canvas port of the original PlayCanvas build's mechanics:
// gameManager.js / treeController.js / knife.js / stageChecker.js / pointChecker.js
import { PATTERNS, stageConfig } from './patterns.js';

// ---- tuning constants (values from the original scene attributes) ----
const KNIFE_SPEED = 1650;      // px/s upward flight (orig knifeSpeed 20 world units/s)
const BACK_SPEED = 900;        // bounce-back speed after a failed hit
const BACK_SPIN = 720;         // deg/s spin while bouncing away
const RESULT_DELAY = 1.0;      // seconds before the game-over panel appears
const RESPAWN_DELAY = 1.0;     // seconds the new log stays hidden between stages
const LERP_COUNT = 2.3;        // seconds to lerp toward a new rotation speed
const HIT_TOLERANCE_DEG = 11;  // angular half-width of a knife for collision

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

    this.status = 'title'; // title | playing | gameover
    this.stage = 0;
    this.score = 0;
    this.best = Number(localStorage.getItem('kkk_best') || 0);
    this.knivesLeft = 0;

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
    this.muted = localStorage.getItem('kkk_muted') === '1';

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

  get logCenter() { return { x: DESIGN_W / 2, y: 330 }; }
  get logRadius() { return 132; }
  get knifeStartY() { return 690; }

  // ---------------- lifecycle ----------------
  startGame() {
    if (this.status === 'playing') return;
    this.status = 'playing';
    this.stage = 0;
    this.score = 0;
    this.knivesLeft = 0;
    this.flying.length = 0;
    this.particles.length = 0;
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
    this.flying.length = 0;
    this.particles.length = 0;
    this.gameOverVisible = false;
    this.hasKnifeReady = false;
    this._titleLog();
  }

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
      hiddenTimer: 0,
      shakeT: 0,
    };
  }

  // Mirrors gameManager.resetStage: pick a random pattern for the stage,
  // seed the pre-stuck knives, reset the required knife count.
  _nextStage(delay) {
    const cfg = stageConfig(this.stage);
    const names = cfg.patterns;
    const name = names[Math.floor(Math.random() * names.length)];
    const pat = PATTERNS[name];

    this.knivesLeft = cfg.requireKnife + 1;
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
      hiddenTimer: delay,
      shakeT: 0,
    };
    this.stagePulse = 1;
  }

  // Mirrors gameManager.spawnKnife: decrement first, advance stage when exhausted.
  _spawnKnife() {
    this.knivesLeft--;
    if (this.knivesLeft < 0) {
      this.stage++;
      this._burstLog();
      this._nextStage(RESPAWN_DELAY);
      this._spawnKnife();
      return;
    }
    this.hasKnifeReady = true;
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

  _onStick(localAngle) {
    this.log.knives.push({ angle: localAngle, initial: false });
    this.log.shakeT = 0.22;
    this.shake = 7;
    this.hitFlash = 0.18;
    this.score++;
    this.scorePulse = 1;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('kkk_best', String(this.best));
    }
    this._woodChips(localAngle);
    this.sfx('hit1');
    this._spawnKnife();
  }

  _onFail(knife) {
    knife.failed = true;
    knife.vy = BACK_SPEED;
    knife.spin = BACK_SPIN;
    this.shake = 12;
    this.status = 'gameover';
    this.resultTimer = RESULT_DELAY;
    this._sparks();
    this.sfx('fail');
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
    ctx.restore();

    // HUD + overlays in design space without shake
    ctx.save();
    ctx.translate(this.offX, this.offY);
    ctx.scale(this.scale, this.scale);
    if (this.status !== 'title') this._drawHud(ctx);
    if (this.status === 'title') this._drawTitle(ctx);
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
    ctx.restore();
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
  // Matches dagger.png, which is drawn tip-at-top / handle-at-bottom.
  _drawKnifeSprite(ctx, scale = 1) {
    const img = this.assets.img.dagger;
    const h = 108 * scale;
    const w = 29 * scale;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -w / 2, 0, w, h);
    } else {
      ctx.fillStyle = '#d8d8dc';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w / 2, h * 0.42); ctx.lineTo(-w / 2, h * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e0b33a';
      ctx.fillRect(-w * 0.8, h * 0.42, w * 1.6, h * 0.09);
      ctx.fillStyle = '#8e2f2f';
      ctx.fillRect(-w * 0.3, h * 0.51, w * 0.6, h * 0.42);
    }
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
    ctx.translate(DESIGN_W / 2, 150);
    ctx.scale(ps, ps);
    ctx.font = '700 62px "Jua", system-ui, sans-serif';
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
    this._roundRect(ctx, 90, 754, DESIGN_W - 180, 62, 12);
    ctx.fill();
    ctx.strokeStyle = '#c9942a';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 90, 754, DESIGN_W - 180, 62, 12);
    ctx.stroke();
    ctx.fillStyle = '#4a2d13';
    ctx.font = '700 26px "Jua", system-ui, sans-serif';
    ctx.fillText('시작하기', DESIGN_W / 2, 786);
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
    ctx.fillText('점수', DESIGN_W / 2, 405);
    ctx.font = '700 56px "Jua", system-ui, sans-serif';
    ctx.fillStyle = '#4a2d13';
    ctx.fillText(String(this.score), DESIGN_W / 2, 450);
    ctx.font = '700 18px "Jua", system-ui, sans-serif';
    ctx.fillStyle = '#6b3f27';
    ctx.fillText(`최고점수  ${this.best}`, DESIGN_W / 2, 500);

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
      // start button OR anywhere on the card area
      if (p.y > 740 && p.y < 830 && p.x > 90 && p.x < DESIGN_W - 90) this.startGame();
      else this.startGame();
      return;
    }
    if (this.status === 'gameover') {
      if (this.gameOverVisible) { this.restart(); this.startGame(); }
      return;
    }
    this.shoot();
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
    };
  }
}
