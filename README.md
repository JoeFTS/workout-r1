# Forge — R1 Workout Tracker

Daily no-equipment training companion for the **Rabbit R1**, built as a hand-coded
Creation (web app via `rabbit-hmi-oss/creations-sdk`). Guided full-body bodyweight
circuits (push-ups, plank, squats, burpees) that auto-progress weekly, plus quick
run logging and sauna time (live timer or manual) — all synced to a Google Sheet,
offline-tolerant.

Design doc: [`docs/plans/2026-07-17-r1-workout-design.md`](docs/plans/2026-07-17-r1-workout-design.md).

## Layout

```
src/
  index.html     screen markup + webhook config
  style.css      240x282 instrument-panel aesthetic (charcoal + R1 orange)
  fonts.css      bundled Anton + IBM Plex Mono (offline-safe)
  app.mjs        UI controller (wires everything)
  engine.mjs     PURE engine: plan gen, progression, streaks  (node-testable)
  exercises.mjs  circuit roster + tunables (rest secs, rounds)
  storage.mjs    creationStorage.plain (localStorage fallback in browser)
  sync.mjs       offline-tolerant fetch() queue to the webhook
  hardware.mjs   scroll wheel / side button (arrow keys fallback)
apps-script/
  Code.gs        Google Apps Script backend (Sheet upsert by entry id)
test/
  engine.test.mjs  49 assertions on plan/progression/streak math  (npm test)
  fetch-test.html  day-one webhook reachability harness
```

## How it works

- **First launch → baseline test**: one max-effort set per exercise, dialed in
  with the wheel. Re-runnable any time from the menu.
- **Daily workout**: 3–5 rounds at ~55% of baseline per round, 90s rest timer
  between rounds. The plank runs as a countdown hold. Before confirming each
  exercise, nudge the number to what you *actually* did — progression uses
  actuals.
- **Progression (weekly)**: 3+ completed workouts in the trailing 7 days bumps
  targets +5% (min +1); every third bump adds a round (cap 5). One empty week
  holds; two steps back a notch.
- **Streak** = consecutive days with any logged activity (workout, run, or sauna).

## Controls

| Action | R1 | Browser dev |
|---|---|---|
| Adjust number | scroll wheel | ↑ / ↓ |
| Confirm / advance | tap button | click |
| Undo / back | side button click | Enter |
| Menu + history | long-press side button | M |
| Skip rest | tap anywhere | click |

## Build & deploy

### 1. Backend (Google)
1. Create a Google Sheet (the `Log` tab auto-creates on first write).
2. **Extensions → Apps Script**, paste `apps-script/Code.gs`.
3. **Deploy → New deployment → Web app** — *Execute as: Me*, *Who has access:
   Anyone*. Copy the `…/exec` URL.

### 2. App
1. Paste the `/exec` URL into `src/index.html` (`const WEBHOOK = '…'`).
2. Host `src/` on any static host (GitHub Pages / Netlify, free).
3. On the R1, install the Creation via QR using the creations-sdk flow,
   pointing at your hosted `index.html`.

### 3. Day-one tests
1. Open `test/fetch-test.html` on the R1's network, paste the `/exec` URL,
   **SEND SAMPLE ROW** → confirm HTTP 200 and a row in the Sheet.
2. Airplane-mode the device, log a sauna session (must keep working), reconnect,
   open menu → **RESYNC** → row appears.

## Dev

```
npm test          # engine math tests (no device needed)
npm run dev       # serve src/ locally
```

Open `src/index.html` via the dev server in a desktop browser — `storage.mjs`
and `hardware.mjs` fall back to `localStorage` + arrow keys so every flow works
without an R1. (Live sync needs the webhook set and a non-`file://` host.)
