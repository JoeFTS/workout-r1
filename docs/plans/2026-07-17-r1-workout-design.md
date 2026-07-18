# Forge — R1 Workout App Design

**Date:** 2026-07-17
**Platform:** Rabbit R1 Creation (`rabbit-hmi-oss/creations-sdk`), 240×282 portrait web app
**Repo:** `/Users/joe/workout-r1`
**Template:** Architecture mirrors `pitch-tracker-r1` (proven stack)

## Purpose

Daily no-equipment full-body training companion that complements running:

- **Guided daily bodyweight workout** — push-ups, plank, squats, burpees (no pull-up bar available; plank replaces pull-ups as the time-based core/posterior movement)
- **Run log** — quick manual entry (minutes, optional distance)
- **Sauna tracking** — live timer or manual minutes entry
- **Progress tracking** — streaks, history, weekly progression, all synced to a Google Sheet

## Architecture

Same module split as pitch-tracker-r1:

```
src/
  index.html     screen markup + webhook config
  style.css      240x282 portrait, instrument-panel aesthetic
  app.mjs        UI controller (wires everything)
  engine.mjs     PURE engine: plan generation, progression, streaks (node-testable)
  storage.mjs    creationStorage.plain (localStorage fallback in browser)
  sync.mjs       offline-tolerant fetch() queue to the webhook
  hardware.mjs   scroll wheel / side button (arrow keys fallback)
  exercises.mjs  exercise roster (name, unit reps|seconds, baseline %, floors)
apps-script/
  Code.gs        Google Apps Script backend (Sheet upsert by entry ID)
test/
  engine.test.mjs   unit tests (npm test)
  fetch-test.html   day-one webhook reachability harness
```

## Visual direction

The app should feel native to the Teenage Engineering-designed hardware — a
training *instrument* (stopwatch / rev counter), not a shrunken phone app.

- **Palette:** charcoal `#141414` bg; **R1 orange `#FF4F00`** single accent
  (actions, progress); warm off-white `#F2EFE9` numerals; steel gray `#5A5A5A`
  secondary labels; **ember red-orange tones reserved exclusively for the sauna
  screen** so heat looks different from work.
- **Typography:** giant condensed athletic numerals (Archivo Black/Anton,
  bundled locally — no network fonts) for the one number per screen; IBM Plex
  Mono all-caps tracked-out labels. At arm's length: one huge number, one word.
- **Signature element:** the **round battery** — chunky segments across the top,
  one per round of today's workout, filling orange as rounds complete. Present
  on Home (today's progress) and persistent during workouts.
- **Motion:** minimal — rep number ticks with the wheel, segment snaps on round
  completion, rest timer pulses in final 3s. Nothing ambient.

## Workout engine

- **Baseline test (first launch, re-runnable from menu):** one max-effort set
  per exercise (max plank hold in seconds), dialed in with the wheel.
- **Daily plan:** circuit of 3–5 rounds × 4 exercises at **~55% of baseline**
  per round (floors: min 1 rep / 10s plank). 90s auto-start rest timer between
  rounds, skippable.
- **Auto-ramp (weekly, completion-gated):** 3+ completed workouts in trailing
  7 days → +5% reps (min +1); every third bump adds a round (cap 5). One missed
  week holds flat; two missed weeks steps back one notch. Baseline re-test
  recalculates everything.
- **Honesty dial:** wheel adjusts actual reps done before confirming each
  exercise; progression uses *actuals*.
- Engine is pure/deterministic: `(baselines, history, date) → today's plan`.

## Screens & controls

1. **Home** — round battery, streak numerals, START WORKOUT / LOG RUN / SAUNA,
   sync status dot.
2. **Workout** — one exercise at a time: mono caps name, giant target number,
   wheel = actual reps, tap = confirm/advance, side button = undo.
3. **Rest** — 90s countdown, orange pulse last 3s, tap to skip.
4. **Sauna** — START → count-up timer in ember tones → STOP saves. Menu path
   for manual minutes entry.
5. **Run log** — wheel dials minutes; tap toggles to distance (tenths of mi);
   confirm.
6. **History/menu** — long-press side button: last 7 days (W/R/S markers),
   re-run baseline, resync.

Conventions (same as pitch tracker): wheel = adjust, tap = confirm,
side button = undo, long-press = menu. Keyboard fallback: ↑/↓/Enter/M.

## Data & sync

On-device stores (JSON in creationStorage):

- `profile` — per-exercise baselines, progression level, last test date
- `log` — append-only `{id, date, type: workout|run|sauna, payload}`
- `queue` — unsent entries (drained by sync.mjs)

Streaks / weekly counts / progression are **derived by replaying the log** — no
duplicated state (pitch-tracker replay philosophy).

**Google Sheet:** one Apps Script webhook, `Log` tab, one row per entry
(date, type, details string, total reps / run min / sauna min columns).
Upsert by entry ID — retries never duplicate.

## Testing

- `npm test` — engine unit tests: plan math (55%, floors), ramp/hold/step-back,
  streaks from synthetic logs, plank seconds handling.
- Browser dev harness (keyboard fallbacks) for UI walkthroughs.
- `fetch-test.html` webhook reachability check.

## Build order

1. Engine + tests
2. UI/screens
3. Storage/hardware
4. Apps Script + sync
5. Visual polish pass
