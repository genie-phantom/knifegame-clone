// Persistent meta-progression, stored in localStorage under one key.
// Everything the player earns across runs lives here.
import { rollQuests, dayKey, questById, isPeakMetric, dailyReward } from './quests.js';

const KEY = 'kkk_save_v1';

const DEFAULTS = {
  coins: 0,
  best: 0,
  stagesCleared: 0,
  fruitCollected: 0,
  unlocked: ['classic'],
  equipped: 'classic',
  muted: false,
  haptic: true,
  // daily systems
  questDay: 0,        // dayKey the current quest set was rolled for
  questIds: [],
  questProgress: {},  // id -> number
  questClaimed: {},   // id -> true
  lastClaimDay: 0,    // dayKey of the last daily-bonus claim
  streak: 0,
};

// Test hook: shifts the notion of "today" so daily rollover can be exercised
// without waiting for real time to pass.
let dayOffset = 0;
export const __setDayOffset = (n) => { dayOffset = n; refreshDaily(); };
const today = () => dayKey(dayOffset);

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

// Roll a fresh quest set when the calendar day changes. Progress and claims
// reset with it; the streak is evaluated separately on claim.
function refreshDaily() {
  const d = today();
  if (state.questDay === d && state.questIds.length === 3) return false;
  state.questDay = d;
  state.questIds = rollQuests(d);
  state.questProgress = {};
  state.questClaimed = {};
  persist();
  return true;
}

export const save = {
  get all() { return { ...state }; },
  get coins() { return state.coins; },
  get best() { return state.best; },
  get stagesCleared() { return state.stagesCleared; },
  get fruitCollected() { return state.fruitCollected; },
  get equipped() { return state.equipped; },
  get muted() { return state.muted; },
  get haptic() { return state.haptic !== false; },

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
  setHaptic(v) { state.haptic = !!v; persist(); },

  // ---------------- daily quests ----------------
  quests() {
    refreshDaily();
    return state.questIds.map((id) => {
      const def = questById(id);
      const progress = Math.min(state.questProgress[id] || 0, def.goal);
      return {
        id,
        text: def.text(def.goal),
        metric: def.metric,
        goal: def.goal,
        reward: def.reward,
        progress,
        complete: progress >= def.goal,
        claimed: !!state.questClaimed[id],
      };
    });
  },

  // Report a gameplay event toward every active quest watching that metric.
  // Totalling metrics accumulate; peak metrics keep the best single value.
  reportMetric(metric, value) {
    refreshDaily();
    let changed = false;
    for (const id of state.questIds) {
      const def = questById(id);
      if (!def || def.metric !== metric) continue;
      const cur = state.questProgress[id] || 0;
      const next = isPeakMetric(metric) ? Math.max(cur, value) : cur + value;
      if (next !== cur) {
        state.questProgress[id] = Math.min(next, def.goal);
        changed = true;
      }
    }
    if (changed) persist();
    return changed;
  },

  setQuestProgress(id, value) {
    refreshDaily();
    if (!state.questIds.includes(id)) return false;
    state.questProgress[id] = value;
    persist();
    return true;
  },

  claimQuest(id) {
    refreshDaily();
    if (!state.questIds.includes(id)) return false;
    if (state.questClaimed[id]) return false;
    const def = questById(id);
    if ((state.questProgress[id] || 0) < def.goal) return false;
    state.questClaimed[id] = true;
    state.coins += def.reward;
    persist();
    return true;
  },

  // ---------------- daily login streak ----------------
  dailyStatus() {
    const d = today();
    return {
      claimedToday: state.lastClaimDay === d,
      streak: state.streak,
      nextReward: dailyReward(state.lastClaimDay === d ? state.streak : state.streak + 1),
    };
  },

  claimDaily() {
    const d = today();
    if (state.lastClaimDay === d) {
      return { ok: false, streak: state.streak, reward: 0, reason: 'already-claimed' };
    }
    // consecutive only when the previous claim was literally yesterday
    const yesterday = dayKey(dayOffset - 1);
    state.streak = state.lastClaimDay === yesterday ? state.streak + 1 : 1;
    state.lastClaimDay = d;
    const reward = dailyReward(state.streak);
    state.coins += reward;
    persist();
    return { ok: true, streak: state.streak, reward };
  },

  reset() {
    state = { ...DEFAULTS, unlocked: [...DEFAULTS.unlocked], questProgress: {}, questClaimed: {}, questIds: [] };
    refreshDaily();
    persist();
  },
};
