// Persistent meta-progression, stored in localStorage under one key.
// Everything the player earns across runs lives here.

const KEY = 'kkk_save_v1';

const DEFAULTS = {
  coins: 0,
  best: 0,
  stagesCleared: 0,
  fruitCollected: 0,
  unlocked: ['classic'],
  equipped: 'classic',
  muted: false,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return migrateLegacy({ ...DEFAULTS });
    const parsed = JSON.parse(raw);
    // merge so a save written by an older build gains new fields
    const merged = { ...DEFAULTS, ...parsed };
    merged.unlocked = Array.isArray(merged.unlocked) && merged.unlocked.length
      ? [...new Set([...merged.unlocked, 'classic'])]
      : [...DEFAULTS.unlocked];
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

// Carry over progress from the pre-shop build so early players keep their best score.
function migrateLegacy(base) {
  try {
    const oldBest = Number(localStorage.getItem('kkk_best') || 0);
    if (oldBest > 0) base.best = oldBest;
    if (localStorage.getItem('kkk_muted') === '1') base.muted = true;
  } catch { /* localStorage unavailable */ }
  return base;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* quota or private mode; game still runs in-memory */ }
}

export const save = {
  get all() { return { ...state }; },
  get coins() { return state.coins; },
  get best() { return state.best; },
  get stagesCleared() { return state.stagesCleared; },
  get fruitCollected() { return state.fruitCollected; },
  get equipped() { return state.equipped; },
  get muted() { return state.muted; },

  isUnlocked(id) { return state.unlocked.includes(id); },
  unlockedIds() { return [...state.unlocked]; },

  addCoins(n) {
    state.coins = Math.max(0, state.coins + n);
    persist();
    return state.coins;
  },
  spendCoins(n) {
    if (state.coins < n) return false;
    state.coins -= n;
    persist();
    return true;
  },
  recordBest(score) {
    if (score > state.best) {
      state.best = score;
      persist();
      return true;
    }
    return false;
  },
  addStagesCleared(n) { state.stagesCleared += n; persist(); },
  addFruit(n) { state.fruitCollected += n; persist(); },
  unlock(id) {
    if (!state.unlocked.includes(id)) {
      state.unlocked.push(id);
      persist();
    }
  },
  equip(id) {
    if (!state.unlocked.includes(id)) return false;
    state.equipped = id;
    persist();
    return true;
  },
  setMuted(v) { state.muted = !!v; persist(); },

  reset() {
    state = { ...DEFAULTS, unlocked: [...DEFAULTS.unlocked] };
    persist();
  },
};
