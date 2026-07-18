// engine.test.mjs — run with `npm test`. Plain assertions, no framework.

import assert from 'node:assert/strict';
import {
  addDays, daysBetween, defaultProfile, hasBaseline, setBaselines,
  computeLevel, planWorkout, makeEntry, todayStatus, streak, weekHistory,
  summarize, totals,
} from '../src/engine.mjs';
import { EXERCISES, BASE_ROUNDS, MAX_ROUNDS } from '../src/exercises.mjs';

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { n++; assert.deepEqual(a, b, msg); };

// --- helpers ---
const BASE = '2026-07-01';
const profile = setBaselines(defaultProfile(), {
  pushups: 25, plank: 60, squats: 40, burpees: 12,
}, BASE);

// a completed-workout entry on a date
const w = (date) => makeEntry('workout', date, {
  rounds: [{ pushups: 14, plank: 33, squats: 22, burpees: 7 }],
});
// k workouts spread within week wIdx (0-based) after BASE
const week = (wIdx, k) =>
  Array.from({ length: k }, (_, i) => w(addDays(BASE, wIdx * 7 + i * 2)));

// --- dates ---
eq(addDays('2026-07-01', 1), '2026-07-02', 'addDays +1');
eq(addDays('2026-07-01', -1), '2026-06-30', 'addDays -1');
eq(addDays('2026-12-31', 1), '2027-01-01', 'addDays year roll');
eq(daysBetween('2026-07-01', '2026-07-08'), 7, 'daysBetween');
eq(addDays('2026-11-01', 1), '2026-11-02', 'addDays across DST fall-back');

// --- profile ---
ok(!hasBaseline(defaultProfile()), 'no baseline initially');
ok(hasBaseline(profile), 'baseline set');
ok(!hasBaseline(setBaselines(defaultProfile(), { pushups: 10 }, BASE)),
  'partial baseline is not complete');

// --- plan: level 0 ---
{
  const p = planWorkout(profile, [], BASE);
  eq(p.rounds, BASE_ROUNDS, 'starts at 3 rounds');
  eq(p.level, 0, 'level 0 with empty log');
  eq(p.targets.pushups, 14, '55% of 25 pushups -> 14');
  eq(p.targets.plank, 33, '55% of 60s plank -> 33s');
  eq(p.targets.squats, 22, '55% of 40 squats -> 22');
  eq(p.targets.burpees, 7, '55% of 12 burpees -> 7');
}

// --- plan: floors ---
{
  const weak = setBaselines(defaultProfile(), {
    pushups: 1, plank: 12, squats: 1, burpees: 1,
  }, BASE);
  const p = planWorkout(weak, [], BASE);
  eq(p.targets.pushups, 1, 'rep floor 1');
  eq(p.targets.plank, 10, 'plank floor 10s');
}

// --- level: ramp / hold / step-back ---
const day = (k) => addDays(BASE, k);
eq(computeLevel([], BASE, day(6)), 0, 'no full week yet -> 0');
eq(computeLevel(week(0, 3), BASE, day(7)), 1, '3 workouts in week -> +1');
eq(computeLevel(week(0, 2), BASE, day(7)), 0, '2 workouts -> hold');
eq(computeLevel(week(0, 3), BASE, day(13)), 1, 'mid-week 2 keeps level 1');
eq(computeLevel([...week(0, 3), ...week(1, 4)], BASE, day(14)), 2,
  'two good weeks -> 2');
eq(computeLevel(week(0, 3), BASE, day(14)), 1,
  'one missed week after a bump -> hold at 1');
eq(computeLevel(week(0, 3), BASE, day(21)), 0,
  'two consecutive empty weeks -> step back to 0');
eq(computeLevel([], BASE, day(28)), 0, 'level never goes below 0');
{
  // 3 good weeks then 2 empty: 3 -> 2
  const log = [...week(0, 3), ...week(1, 3), ...week(2, 3)];
  eq(computeLevel(log, BASE, day(35)), 2, 'step back once after 2 empty weeks');
}

// --- plan: bumps ---
{
  // level 1 = one rep bump: 14 -> max(15, round(14.7)) = 15
  const p = planWorkout(profile, week(0, 3), day(7));
  eq(p.level, 1, 'level 1');
  eq(p.targets.pushups, 15, 'pushups bumped to 15');
  eq(p.targets.burpees, 8, 'burpees +1 (min-bump beats 5%)');
  eq(p.rounds, 3, 'still 3 rounds at level 1');
}
{
  // level 3 = 1 round bump + 2 rep bumps
  const log = [...week(0, 3), ...week(1, 3), ...week(2, 3)];
  const p = planWorkout(profile, log, day(21));
  eq(p.level, 3, 'level 3');
  eq(p.rounds, 4, '4 rounds at level 3');
  eq(p.targets.pushups, 16, 'two rep bumps: 14->15->16');
}
{
  // rounds cap at MAX_ROUNDS even at silly levels
  const log = Array.from({ length: 12 }, (_, i) => week(i, 3)).flat();
  const p = planWorkout(profile, log, day(12 * 7));
  eq(p.rounds, MAX_ROUNDS, 'rounds capped at 5');
  ok(p.targets.pushups > 16, 'reps keep climbing past round cap');
}

// --- status / streaks ---
{
  const log = [
    w('2026-07-10'),
    makeEntry('run', '2026-07-11', { minutes: 30 }),
    makeEntry('sauna', '2026-07-12', { minutes: 20, source: 'timer' }),
  ];
  eq(todayStatus(log, '2026-07-10'),
    { workout: true, run: false, sauna: false }, 'todayStatus workout day');
  eq(streak(log, '2026-07-12'), 3, '3-day streak, today logged');
  eq(streak(log, '2026-07-13'), 3, 'empty today does not break streak yet');
  eq(streak(log, '2026-07-14'), 0, 'gap of a full day kills streak');
  eq(streak([], '2026-07-14'), 0, 'empty log -> 0');
  const wh = weekHistory(log, '2026-07-12');
  eq(wh.length, 7, 'weekHistory 7 days');
  eq(wh[6], { date: '2026-07-12', workout: false, run: false, sauna: true },
    'weekHistory newest last');
}

// --- summarize / totals ---
{
  const e = makeEntry('workout', BASE, {
    rounds: [
      { pushups: 14, plank: 33, squats: 22, burpees: 7 },
      { pushups: 12, plank: 30, squats: 22, burpees: 6 },
    ],
  });
  ok(summarize(e).startsWith('2 rounds:'), 'workout summary counts rounds');
  ok(summarize(e).includes('plank [33s,30s]'), 'plank shown in seconds');
  eq(totals(e), { reps: 83, runMin: 0, saunaMin: 0 },
    'workout totals sum rep exercises only');

  const r = makeEntry('run', BASE, { minutes: 32, distance: 31 });
  eq(summarize(r), '32 min, 3.1 mi', 'run summary with distance');
  eq(totals(r).runMin, 32, 'run totals');

  const s = makeEntry('sauna', BASE, { minutes: 18, source: 'manual' });
  eq(summarize(s), '18 min (manual)', 'sauna summary');
  eq(totals(s).saunaMin, 18, 'sauna totals');
}

// --- entry ids unique-ish ---
{
  const a = makeEntry('run', BASE, { minutes: 1 });
  const b = makeEntry('run', BASE, { minutes: 1 });
  ok(a.id !== b.id, 'entry ids differ');
}

console.log(`ok — ${n} assertions passed`);
