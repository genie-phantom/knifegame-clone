// Daily quests.
//
// Three quests are drawn each calendar day from the pool below. The draw is
// seeded by the day itself, so every device shows a stable set for that day
// and reloading never reshuffles it. Progress is tracked from gameplay events
// and each quest pays its coin reward once.

export const QUEST_POOL = [
  { id: 'stick10',  metric: 'knives',   goal: 10, reward: 25,  text: (n) => `칼 ${n}개 꽂기` },
  { id: 'stick25',  metric: 'knives',   goal: 25, reward: 50,  text: (n) => `칼 ${n}개 꽂기` },
  { id: 'stick50',  metric: 'knives',   goal: 50, reward: 90,  text: (n) => `칼 ${n}개 꽂기` },
  { id: 'apple3',   metric: 'fruit',    goal: 3,  reward: 30,  text: (n) => `사과 ${n}개 가르기` },
  { id: 'apple8',   metric: 'fruit',    goal: 8,  reward: 60,  text: (n) => `사과 ${n}개 가르기` },
  { id: 'stage3',   metric: 'stage',    goal: 3,  reward: 30,  text: (n) => `스테이지 ${n} 도달` },
  { id: 'stage6',   metric: 'stage',    goal: 6,  reward: 55,  text: (n) => `스테이지 ${n} 도달` },
  { id: 'stage10',  metric: 'stage',    goal: 10, reward: 100, text: (n) => `스테이지 ${n} 도달` },
  { id: 'combo5',   metric: 'combo',    goal: 5,  reward: 35,  text: (n) => `${n}콤보 달성` },
  { id: 'combo10',  metric: 'combo',    goal: 10, reward: 70,  text: (n) => `${n}콤보 달성` },
  { id: 'boss1',    metric: 'boss',     goal: 1,  reward: 45,  text: (n) => `보스 ${n}회 처치` },
  { id: 'boss3',    metric: 'boss',     goal: 3,  reward: 110, text: (n) => `보스 ${n}회 처치` },
  { id: 'games3',   metric: 'games',    goal: 3,  reward: 20,  text: (n) => `${n}판 플레이` },
  { id: 'games8',   metric: 'games',    goal: 8,  reward: 45,  text: (n) => `${n}판 플레이` },
];

// Metrics that track the best single run rather than a running total.
const PEAK_METRICS = new Set(['stage', 'combo']);
export const isPeakMetric = (m) => PEAK_METRICS.has(m);

export const questById = (id) => QUEST_POOL.find((q) => q.id === id);

// Deterministic PRNG so a given day always yields the same three quests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Day key as YYYYMMDD in local time, with an optional test offset in days.
export function dayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Pick three distinct quests, spread across different metrics where possible
// so a day never asks for the same thing three times.
export function rollQuests(day) {
  const rnd = mulberry32(day);
  const pool = [...QUEST_POOL];
  // Fisher-Yates with the seeded generator
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = [];
  const usedMetrics = new Set();
  for (const q of pool) {
    if (picked.length === 3) break;
    if (usedMetrics.has(q.metric)) continue;
    picked.push(q.id);
    usedMetrics.add(q.metric);
  }
  // top up if the pool ran out of distinct metrics
  for (const q of pool) {
    if (picked.length === 3) break;
    if (!picked.includes(q.id)) picked.push(q.id);
  }
  return picked;
}

// Coin reward for the Nth consecutive login day; plateaus after a week.
export function dailyReward(streak) {
  const table = [20, 30, 45, 60, 80, 110, 150];
  return table[Math.min(streak - 1, table.length - 1)];
}
