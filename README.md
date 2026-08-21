# 칼칼칼 (KalKalKal) — knife game

A playable clone of the knife-throwing game at
<https://gfactory.ai/games/knifegame>, rebuilt as a dependency-free HTML5
canvas game.

## Run

```sh
python3 -m http.server 8099
# open http://127.0.0.1:8099/
```

Tap / click anywhere to throw a knife. Space or Enter works too.

## How it plays

- A wooden log spins in front of you; tap to throw a knife straight up.
- The knife sticks where it lands and scores a point.
- Hit a knife that is already stuck and the run ends.
- Clearing a stage's four knives advances to the next stage, which spawns a
  new log pattern with its own rotation choreography.

## Fidelity to the original

Mechanics and tuning were taken from the original PlayCanvas build's
unminified scripts (`gameManager.js`, `treeController.js`, `knife.js`) and its
scene/config JSON, not guessed:

- 14 stages, `requireKnife: 3` each → 4 knives thrown per stage. Stages past
  the last clamp to the final entry, as the original does.
- 15 log patterns (`Tree_e_1` … `Tree_h_3_1`) with their exact rotation
  sequences (`speed`, `isReverse`, `duration`) and pre-stuck knife angles,
  ported verbatim in `js/patterns.js`.
- Rotation speed lerps toward each phase's target over `lerpCount = 2.3s`.
- A knife sticks at the log's own current facing angle, matching the
  original's `atan2` impact calculation.
- 1s result delay before the game-over panel; 1s log respawn delay between
  stages.

Art and sound (`assets/`) are the original game's files.

## Layout

```
index.html          canvas shell + fonts
js/game.js          engine: state machine, physics, collision, rendering
js/patterns.js      stage table + per-pattern rotation data (from the original)
js/main.js          asset loading, input wiring, window.__game test surface
script/qa/knife-qa.mjs   Playwright QA covering the three core behaviours
```

## QA

```sh
python3 -m http.server 8099 &
node script/qa/knife-qa.mjs --url http://127.0.0.1:8099/
```

Covers: a knife sticking and scoring, hitting a stuck knife ending the run,
and stage progression resetting the knife count with a new rotation profile.
Requires `playwright` to be installed.
