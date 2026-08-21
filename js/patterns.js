// Stage patterns extracted verbatim from the original PlayCanvas build
// (config.json template assets Tree_e_1 .. Tree_h_3_1).
//
// sequences: rotation phases. speed = deg/sec, isReverse flips direction,
//            duration = seconds before advancing to the next phase (wraps).
// initialKnives: Y angles (degrees) of knives already stuck in the log at spawn.
//            The original stores PlayCanvas eulers; [180, y, 180] is a flipped
//            knife whose effective Y rotation is (180 - y).

const flip = (y) => 180 - y;

export const PATTERNS = {
  Tree_e_1: {
    sequences: [{ speed: 200, isReverse: false, duration: 1 }],
    initialKnives: [],
  },
  Tree_e_2: {
    sequences: [{ speed: 280, isReverse: false, duration: 1 }],
    initialKnives: [flip(15)],
  },
  Tree_e_3: {
    sequences: [
      { speed: 100, isReverse: false, duration: 2 },
      { speed: 250, isReverse: false, duration: 1 },
    ],
    initialKnives: [flip(15)],
  },
  Tree_n_1: {
    sequences: [
      { speed: 250, isReverse: false, duration: 1 },
      { speed: 30, isReverse: false, duration: 0.8 },
      { speed: 280, isReverse: true, duration: 1 },
      { speed: 50, isReverse: true, duration: 0.7 },
    ],
    initialKnives: [0, 75, -30],
  },
  Tree_n_1_1: {
    sequences: [
      { speed: 250, isReverse: false, duration: 1 },
      { speed: 30, isReverse: false, duration: 0.8 },
      { speed: 280, isReverse: true, duration: 1 },
      { speed: 50, isReverse: true, duration: 0.7 },
    ],
    initialKnives: [0, flip(45), flip(-60), 45],
  },
  Tree_n_2: {
    sequences: [
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 300, isReverse: true, duration: 2 },
      { speed: 20, isReverse: true, duration: 0.75 },
      { speed: 300, isReverse: false, duration: 1.8 },
    ],
    initialKnives: [0, 75, -15, flip(60)],
  },
  Tree_n_2_1: {
    sequences: [
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 300, isReverse: true, duration: 2 },
      { speed: 20, isReverse: true, duration: 0.75 },
      { speed: 300, isReverse: false, duration: 1.8 },
    ],
    initialKnives: [0, 75, -75, flip(60)],
  },
  Tree_n_3: {
    sequences: [
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 280, isReverse: true, duration: 2 },
      { speed: 100, isReverse: true, duration: 0.75 },
      { speed: 220, isReverse: false, duration: 2.2 },
    ],
    initialKnives: [0, 75, flip(60)],
  },
  Tree_n_4: {
    sequences: [
      { speed: 250, isReverse: false, duration: 1.3 },
      { speed: 50, isReverse: false, duration: 0.3 },
      { speed: 320, isReverse: true, duration: 1.6 },
      { speed: 50, isReverse: true, duration: 0.5 },
    ],
    initialKnives: [0, 75, -30, flip(30)],
  },
  Tree_h_1: {
    sequences: [
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 400, isReverse: true, duration: 1.2 },
      { speed: 20, isReverse: true, duration: 0.4 },
      { speed: 380, isReverse: false, duration: 0.8 },
    ],
    initialKnives: [0, flip(0), -30, flip(60)],
  },
  Tree_h_1_1: {
    sequences: [
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 400, isReverse: true, duration: 1.2 },
      { speed: 20, isReverse: true, duration: 0.4 },
      { speed: 380, isReverse: false, duration: 0.8 },
    ],
    initialKnives: [0, flip(0), -30, flip(60), flip(-30)],
  },
  Tree_h_2: {
    sequences: [
      { speed: 200, isReverse: false, duration: 1 },
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 350, isReverse: true, duration: 1.2 },
      { speed: 20, isReverse: true, duration: 0.5 },
      { speed: 250, isReverse: false, duration: 1 },
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 300, isReverse: true, duration: 1.3 },
      { speed: 10, isReverse: true, duration: 1 },
    ],
    initialKnives: [0, flip(0), flip(-60), flip(60)],
  },
  Tree_h_2_1: {
    sequences: [
      { speed: 200, isReverse: false, duration: 0.8 },
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 400, isReverse: true, duration: 1.2 },
      { speed: 20, isReverse: true, duration: 0.5 },
      { speed: 250, isReverse: false, duration: 1 },
      { speed: 20, isReverse: false, duration: 1 },
      { speed: 380, isReverse: true, duration: 1.3 },
      { speed: 10, isReverse: true, duration: 1 },
    ],
    initialKnives: [0, flip(0), flip(-60), flip(60), 30, -60],
  },
  Tree_h_3: {
    sequences: [
      { speed: 250, isReverse: true, duration: 1.3 },
      { speed: 20, isReverse: true, duration: 0.5 },
      { speed: 150, isReverse: false, duration: 1 },
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 300, isReverse: true, duration: 1.2 },
      { speed: 10, isReverse: true, duration: 0.5 },
      { speed: 280, isReverse: false, duration: 1 },
      { speed: 10, isReverse: false, duration: 0.5 },
    ],
    initialKnives: [45, flip(30), 90, flip(-30), -45],
  },
  Tree_h_3_1: {
    sequences: [
      { speed: 250, isReverse: true, duration: 1.3 },
      { speed: 20, isReverse: true, duration: 0.5 },
      { speed: 150, isReverse: false, duration: 1 },
      { speed: 20, isReverse: false, duration: 0.5 },
      { speed: 300, isReverse: true, duration: 1.2 },
      { speed: 10, isReverse: true, duration: 0.5 },
      { speed: 280, isReverse: false, duration: 1.5 },
      { speed: 10, isReverse: false, duration: 0.5 },
    ],
    initialKnives: [45, 15, 90, flip(-30), -45, flip(45)],
  },
};

// gameConfig from the original: 14 stages, requireKnife 3 each (=> 4 knives thrown).
// Stages beyond the last clamp to the final entry, exactly like the original
// `stage > gameConfig.length - 1 ? gameConfig.length - 1 : stage`.
export const STAGES = [
  { requireKnife: 3, patterns: ['Tree_e_1'] },
  { requireKnife: 3, patterns: ['Tree_e_2'] },
  { requireKnife: 3, patterns: ['Tree_e_3'] },
  { requireKnife: 3, patterns: ['Tree_n_1'] },
  { requireKnife: 3, patterns: ['Tree_n_2'] },
  { requireKnife: 3, patterns: ['Tree_n_3'] },
  { requireKnife: 3, patterns: ['Tree_n_4'] },
  { requireKnife: 3, patterns: ['Tree_h_1'] },
  { requireKnife: 3, patterns: ['Tree_h_2'] },
  { requireKnife: 3, patterns: ['Tree_n_1_1', 'Tree_e_3'] },
  { requireKnife: 3, patterns: ['Tree_h_3'] },
  { requireKnife: 3, patterns: ['Tree_h_1', 'Tree_h_2', 'Tree_h_3'] },
  { requireKnife: 3, patterns: ['Tree_n_1', 'Tree_n_1_1', 'Tree_e_3'] },
  {
    requireKnife: 3,
    patterns: ['Tree_n_1_1', 'Tree_n_2_1', 'Tree_h_1_1', 'Tree_h_2_1', 'Tree_h_3_1'],
  },
];

export const stageConfig = (stage) => STAGES[Math.min(stage, STAGES.length - 1)];
