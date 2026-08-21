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
- The X in the top right quits mid-run, behind a confirm so a stray tap cannot
  end a good run. The game freezes while the dialog is open and your score is
  banked before you leave.
- Clearing a stage's four knives advances to the next stage, which spawns a
  new log pattern with its own rotation choreography.

### Progression systems

- **Combo** — consecutive hits raise a score multiplier (up to x5). The first
  hit of a streak is worth a plain point; the bonus builds from the second on.
  A failed throw resets it.
- **Apples** — fruit rides the rim from stage 2. Splitting one pays coins and
  bursts into juice, but it occupies an angle you now cannot reuse.
- **Boss stages** — every 5th stage is a boss with a health bar that soaks
  several hits and pays a large coin bounty. Bosses grow tougher over time.
- **Shop** — thirteen knives with distinct silhouettes (cleaver, kunai, katana,
  trident, scythe, spear, glowing ember/frost/venom/solar/void variants) unlock
  with coins and persist.
- **Daily quests** — three quests a day, drawn from a pool by a day-seeded PRNG
  so the set is stable across reloads and devices. Progress tracks live from
  gameplay; each pays its coin reward once and the set refreshes at midnight.
- **Login streak** — consecutive days escalate the bonus (20 → 150, plateauing
  after a week). Missing a day resets the streak to 1.
- **Save** — coins, unlocked and equipped skins, best score, stages cleared,
  fruit collected, quest progress and streak all persist in `localStorage`.

## Install / Play Store

The game ships as an installable PWA: `manifest.webmanifest` with maskable
icons, a precaching service worker (`sw.js`) for offline play, and portrait
`standalone` display. That makes it packageable for the Play Store as a
Trusted Web Activity without further code changes:

```sh
npx @bubblewrap/cli init --manifest https://genie-phantom.github.io/knifegame-clone/manifest.webmanifest
npx @bubblewrap/cli build      # produces a signed AAB for the Play Console
```

Publishing still needs a Play Console account, a signing key, and Digital
Asset Links (`.well-known/assetlinks.json`) to remove the URL bar.

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
index.html          canvas shell, PWA meta, SW registration
manifest.webmanifest / sw.js   installability + offline precache
js/game.js          engine: state machine, physics, collision, rendering
js/patterns.js      stage table + per-pattern rotation data (from the original)
js/skins.js         knife catalog; every non-default skin is drawn procedurally
js/quests.js        daily quest pool, day-seeded roll, streak reward table
js/save.js          localStorage meta-progression with legacy-save migration
js/main.js          asset loading, input wiring, window.__game test surface
script/qa/knife-qa.mjs      core mechanics QA
script/qa/content-qa.mjs    progression systems QA
script/qa/retention-qa.mjs  boss-stage bugfixes + quest/streak QA
script/qa/exit-qa.mjs       quit-to-title flow QA
```

## QA

```sh
python3 -m http.server 8099 &
node script/qa/knife-qa.mjs   --url http://127.0.0.1:8099/
node script/qa/content-qa.mjs --url http://127.0.0.1:8099/
```

`knife-qa` covers the core loop: a knife sticking and scoring, hitting a stuck
knife ending the run, and stage progression resetting the knife count with a
new rotation profile. `content-qa` covers the progression layer: fruit paying
coins, the combo multiplier scaling score, a boss surviving multiple hits, and
a shop purchase surviving a reload. `retention-qa` covers the boss-stage
bugfixes plus quest claiming, daily rollover and streak reset. Requires
`playwright`.
