// engine.mjs — PURE workout engine. No DOM, no storage, no clock: every
// function is deterministic from (profile, log, date) so it's node-testable.
//
// The log is append-only entries {id, date:'YYYY-MM-DD', type, payload}:
//   workout: { rounds: [{pushups, plank, squats, burpees}, ...], planned }
//   run:     { minutes, distance? }          (distance in tenths shown as mi)
//   sauna:   { minutes, source: 'timer'|'manual' }
// Streaks, progression level, and weekly status are DERIVED by replaying the
// log — no duplicated state to drift.

import { EXERCISES, BASE_ROUNDS, MAX_ROUNDS } from './exercises.mjs';

// ---------- dates ----------

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00'); // noon dodges DST edges
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round(
    (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000
  );
}

// ---------- profile ----------

export function defaultProfile() {
  return { baselines: null, baselineDate: null };
}

export const hasBaseline = (p) =>
  !!(p && p.baselines && EXERCISES.every((e) => p.baselines[e.id] > 0));

// body: { heightIn, targetLbs } — set once via the weigh-in setup flow
export const hasBody = (p) => !!(p && p.body && p.body.heightIn > 0 && p.body.targetLbs > 0);
export function setBody(profile, body) {
  return { ...profile, body: { ...body } };
}

export function setBaselines(profile, baselines, date) {
  return { ...profile, baselines: { ...baselines }, baselineDate: date };
}

// ---------- progression level (replayed from the log) ----------
//
// Weeks are 7-day windows counted from the baseline date. Per full week:
//   >= 3 completed workouts -> level +1
//   1-2 workouts            -> hold
//   0 workouts, AND the previous week also had 0 -> level -1 (floor 0)

export function completedWorkoutDates(log) {
  return log.filter((e) => e.type === 'workout').map((e) => e.date);
}

export function computeLevel(log, baselineDate, today) {
  if (!baselineDate) return 0;
  const dates = completedWorkoutDates(log);
  const fullWeeks = Math.floor(daysBetween(baselineDate, today) / 7);
  let level = 0;
  let prevWeekCount = null;
  for (let w = 0; w < fullWeeks; w++) {
    const start = addDays(baselineDate, w * 7);
    const end = addDays(baselineDate, w * 7 + 6);
    const count = dates.filter((d) => d >= start && d <= end).length;
    if (count >= 3) level += 1;
    else if (count === 0 && prevWeekCount === 0) level = Math.max(0, level - 1);
    prevWeekCount = count;
  }
  return level;
}

// ---------- daily plan ----------
//
// Level splits into round-bumps (every 3rd) and rep-bumps (the rest).
// Each rep-bump raises a target by max(+1, +5%).

export function planWorkout(profile, log, today) {
  const level = computeLevel(log, profile.baselineDate, today);
  const roundBumps = Math.floor(level / 3);
  const repBumps = level - roundBumps;
  const rounds = Math.min(MAX_ROUNDS, BASE_ROUNDS + roundBumps);

  const targets = {};
  for (const ex of EXERCISES) {
    let t = Math.max(ex.floor, Math.round(profile.baselines[ex.id] * ex.pct));
    for (let i = 0; i < repBumps; i++) t = Math.max(t + 1, Math.round(t * 1.05));
    targets[ex.id] = t;
  }
  return { date: today, level, rounds, targets };
}

// ---------- logging helpers ----------

export function makeEntry(type, date, payload) {
  return {
    id: `${type}_${date}_${Math.random().toString(36).slice(2, 8)}`,
    date,
    type,
    payload,
  };
}

// ---------- derived status ----------

export function todayStatus(log, today) {
  const t = log.filter((e) => e.date === today);
  return {
    workout: t.some((e) => e.type === 'workout'),
    run: t.some((e) => e.type === 'run'),
    sauna: t.some((e) => e.type === 'sauna'),
  };
}

// Streak: consecutive days with TRAINING activity (workout/run/sauna — a
// weigh-in doesn't count), counting back from today. Today only counts once
// something is logged; an empty today doesn't break a streak that ran through
// yesterday.
const TRAINING = new Set(['workout', 'run', 'sauna']);
export function streak(log, today) {
  const days = new Set(log.filter((e) => TRAINING.has(e.type)).map((e) => e.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Longest-ever run of consecutive training days.
export function bestStreak(log) {
  const days = [...new Set(log.filter((e) => TRAINING.has(e.type)).map((e) => e.date))].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    cur = prev && daysBetween(prev, d) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

// 5-week activity grid ending on the current week (rows of Sun..Sat).
// Each cell: { date, level } — level 2 = workout day, 1 = run/sauna only,
// 0 = nothing, null = future day.
export function calendar(log, today, weeks = 5) {
  const byDay = new Map();
  for (const e of log) {
    if (!TRAINING.has(e.type)) continue;
    const lvl = e.type === 'workout' ? 2 : 1;
    byDay.set(e.date, Math.max(byDay.get(e.date) || 0, lvl));
  }
  const dow = new Date(today + 'T12:00:00').getDay();
  const start = addDays(today, -dow - (weeks - 1) * 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, level: date > today ? null : (byDay.get(date) || 0) };
  });
}

// Last 7 days (oldest first) with W/R/S markers for the history screen.
export function weekHistory(log, today) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, ...todayStatus(log, date) });
  }
  return out;
}

// ---------- body / weight ----------

// Most recent logged weight in lbs, or null.
export function latestWeight(log) {
  for (let i = log.length - 1; i >= 0; i--)
    if (log[i].type === 'weight') return log[i].payload.lbs;
  return null;
}

export function bmi(heightIn, lbs) {
  return Math.round((703 * lbs) / (heightIn * heightIn) * 10) / 10;
}

// ---------- sheet row summarization ----------

export function summarize(entry) {
  const p = entry.payload;
  if (entry.type === 'workout') {
    const parts = EXERCISES.map((ex) => {
      const per = p.rounds.map((r) => r[ex.id] ?? 0);
      const unit = ex.unit === 'seconds' ? 's' : '';
      return `${ex.name.toLowerCase()} [${per.map((n) => n + unit).join(',')}]`;
    });
    return `${p.rounds.length} rounds: ${parts.join('  ')}`;
  }
  if (entry.type === 'run') {
    return p.distance
      ? `${p.minutes} min, ${(p.distance / 10).toFixed(1)} mi`
      : `${p.minutes} min`;
  }
  if (entry.type === 'sauna') return `${p.minutes} min (${p.source})`;
  if (entry.type === 'weight') return `${p.lbs} lb`;
  return '';
}

export function totals(entry) {
  const p = entry.payload;
  const zero = { reps: 0, runMin: 0, saunaMin: 0, weightLbs: 0 };
  if (entry.type === 'workout') {
    let reps = 0;
    for (const r of p.rounds)
      for (const ex of EXERCISES)
        if (ex.unit === 'reps') reps += r[ex.id] ?? 0;
    return { ...zero, reps };
  }
  if (entry.type === 'run') return { ...zero, runMin: p.minutes };
  if (entry.type === 'sauna') return { ...zero, saunaMin: p.minutes };
  if (entry.type === 'weight') return { ...zero, weightLbs: p.lbs };
  return zero;
}
