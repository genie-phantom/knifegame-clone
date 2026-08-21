// Knife skin catalog.
//
// `classic` renders the original dagger sprite. Every other skin is drawn
// procedurally so the silhouettes genuinely differ rather than being one
// sprite in different colours. Each draw fn works in the same local space as
// the sprite: tip at (0,0), blade running down +y, handle at the far end.

const BLADE_L = 62;   // tip -> guard
const TOTAL_L = 108;  // tip -> pommel

// shared helpers -----------------------------------------------------------
function bladeShape(ctx, halfW, len, waist = 0.45) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(halfW, len * waist, halfW * 0.72, len);
  ctx.lineTo(-halfW * 0.72, len);
  ctx.quadraticCurveTo(-halfW, len * waist, 0, 0);
  ctx.closePath();
}

function metalFill(ctx, light, dark) {
  const g = ctx.createLinearGradient(-10, 0, 10, 0);
  g.addColorStop(0, dark);
  g.addColorStop(0.45, light);
  g.addColorStop(0.55, light);
  g.addColorStop(1, dark);
  return g;
}

function outline(ctx, w = 2.5, color = 'rgba(38,24,16,0.9)') {
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function guard(ctx, y, w, h, color, edge) {
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(-w * 0.75, y + h * 1.5, -w * 0.34, y + h);
  ctx.lineTo(w * 0.34, y + h);
  ctx.quadraticCurveTo(w * 0.75, y + h * 1.5, w, y);
  ctx.quadraticCurveTo(0, y - h * 0.5, -w, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  outline(ctx, 2.2, edge);
}

function grip(ctx, y, w, len, color, dark, pommel) {
  const g = ctx.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, dark);
  g.addColorStop(0.5, color);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(-w * 1.1, y + len * 0.6, -w * 0.7, y + len);
  ctx.lineTo(w * 0.7, y + len);
  ctx.quadraticCurveTo(w * 1.1, y + len * 0.6, w, y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  outline(ctx, 2.2);
  // pommel
  ctx.beginPath();
  ctx.ellipse(0, y + len + 3, w * 0.85, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = pommel;
  ctx.fill();
  outline(ctx, 2);
}

// individual skins ---------------------------------------------------------
function drawSteel(ctx, o) {
  bladeShape(ctx, 13, BLADE_L);
  ctx.fillStyle = metalFill(ctx, o.light, o.dark);
  ctx.fill();
  outline(ctx);
  guard(ctx, BLADE_L, 22, 7, o.guard, 'rgba(38,24,16,0.9)');
  grip(ctx, BLADE_L + 7, 8, TOTAL_L - BLADE_L - 14, o.grip, o.gripDark, o.guard);
}

function drawCleaver(ctx, o) {
  // wide, square-tipped chopper
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(15, 4);
  ctx.lineTo(16, BLADE_L - 6);
  ctx.quadraticCurveTo(16, BLADE_L, 10, BLADE_L);
  ctx.lineTo(-11, BLADE_L);
  ctx.closePath();
  ctx.fillStyle = metalFill(ctx, o.light, o.dark);
  ctx.fill();
  outline(ctx);
  grip(ctx, BLADE_L, 8.5, TOTAL_L - BLADE_L - 6, o.grip, o.gripDark, o.guard);
}

function drawKunai(ctx, o) {
  // narrow diamond blade, ring pommel
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, BLADE_L * 0.34);
  ctx.lineTo(7, BLADE_L);
  ctx.lineTo(-7, BLADE_L);
  ctx.lineTo(-10, BLADE_L * 0.34);
  ctx.closePath();
  ctx.fillStyle = metalFill(ctx, o.light, o.dark);
  ctx.fill();
  outline(ctx);
  grip(ctx, BLADE_L, 6.5, TOTAL_L - BLADE_L - 16, o.grip, o.gripDark, o.guard);
  ctx.beginPath();
  ctx.arc(0, TOTAL_L - 8, 8, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = o.guard;
  ctx.stroke();
  outline(ctx, 1.8);
}

function drawKatana(ctx, o) {
  // slim curved blade with a long wrapped grip
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(11, BLADE_L * 0.5, 9, BLADE_L + 6);
  ctx.lineTo(-5, BLADE_L + 6);
  ctx.quadraticCurveTo(-4, BLADE_L * 0.5, 0, 0);
  ctx.closePath();
  ctx.fillStyle = metalFill(ctx, o.light, o.dark);
  ctx.fill();
  outline(ctx);
  ctx.beginPath();
  ctx.ellipse(2, BLADE_L + 8, 15, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.guard;
  ctx.fill();
  outline(ctx, 2.2);
  grip(ctx, BLADE_L + 12, 7, TOTAL_L - BLADE_L - 18, o.grip, o.gripDark, o.guard);
  // wrap bands
  ctx.strokeStyle = 'rgba(30,20,14,0.55)';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    const y = BLADE_L + 12 + ((TOTAL_L - BLADE_L - 18) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(-7, y);
    ctx.lineTo(7, y + 3);
    ctx.stroke();
  }
}

function drawTrident(ctx, o) {
  // three-pronged fork
  ctx.fillStyle = metalFill(ctx, o.light, o.dark);
  for (const dx of [-11, 0, 11]) {
    ctx.save();
    ctx.translate(dx, dx === 0 ? 0 : 12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, BLADE_L * 0.55);
    ctx.lineTo(-5, BLADE_L * 0.55);
    ctx.closePath();
    ctx.fill();
    outline(ctx, 2);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.rect(-13, BLADE_L * 0.55, 26, 10);
  ctx.fillStyle = o.guard;
  ctx.fill();
  outline(ctx, 2.2);
  grip(ctx, BLADE_L * 0.55 + 10, 7.5, TOTAL_L - BLADE_L * 0.55 - 20, o.grip, o.gripDark, o.guard);
}

// glow wrapper for premium skins
function withGlow(fn, color) {
  return (ctx, o) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    fn(ctx, o);
    ctx.restore();
  };
}

export const SKINS = [
  {
    id: 'classic', name: '기본 단검', price: 0, sprite: true,
    palette: { light: '#e9e9ef', dark: '#9a9aa6', guard: '#d8ab3c', grip: '#8e2f2f', gripDark: '#5e1c1c' },
  },
  {
    id: 'bronze', name: '청동 단검', price: 60, draw: drawSteel,
    palette: { light: '#e8b171', dark: '#a06a30', guard: '#7a4a1e', grip: '#4f3320', gripDark: '#33200f' },
  },
  {
    id: 'cleaver', name: '식칼', price: 120, draw: drawCleaver,
    palette: { light: '#eceff2', dark: '#98a2ab', guard: '#5c4632', grip: '#6b4a2c', gripDark: '#432c18' },
  },
  {
    id: 'kunai', name: '쿠나이', price: 200, draw: drawKunai,
    palette: { light: '#b9c0c8', dark: '#6e767f', guard: '#3b3f45', grip: '#2b2f34', gripDark: '#1a1d21' },
  },
  {
    id: 'katana', name: '카타나', price: 320, draw: drawKatana,
    palette: { light: '#f2f5f8', dark: '#9fb0bd', guard: '#c9962f', grip: '#243447', gripDark: '#14202e' },
  },
  {
    id: 'ember', name: '불꽃 단검', price: 480, draw: withGlow(drawSteel, 'rgba(255,140,40,0.9)'),
    palette: { light: '#ffd9a8', dark: '#e0632a', guard: '#ffb03a', grip: '#6b2410', gripDark: '#3f1408' },
  },
  {
    id: 'frost', name: '서리 단검', price: 640, draw: withGlow(drawKunai, 'rgba(120,210,255,0.9)'),
    palette: { light: '#e8fbff', dark: '#6fc4e8', guard: '#9fe6ff', grip: '#1d4457', gripDark: '#0f2833' },
  },
  {
    id: 'trident', name: '삼지창', price: 820, draw: drawTrident,
    palette: { light: '#dfe6ea', dark: '#8b979f', guard: '#b0873a', grip: '#3d4a52', gripDark: '#232d33' },
  },
  {
    id: 'void', name: '공허의 칼', price: 1200, draw: withGlow(drawKatana, 'rgba(180,110,255,0.95)'),
    palette: { light: '#e5d4ff', dark: '#7b4fc0', guard: '#c9a2ff', grip: '#2a1746', gripDark: '#170b28' },
  },
];

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

// Draw a skin in sprite-local space (tip at origin, blade down +y).
export function drawSkin(ctx, skin, daggerImg) {
  if (skin.sprite) {
    if (daggerImg && daggerImg.complete && daggerImg.naturalWidth) {
      ctx.drawImage(daggerImg, -29 / 2, 0, 29, TOTAL_L);
      return;
    }
    drawSteel(ctx, skin.palette);
    return;
  }
  skin.draw(ctx, skin.palette);
}
