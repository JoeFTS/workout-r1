// exercises.mjs — the circuit roster. No equipment needed (plank replaces
// pull-ups: no bar available). unit 'seconds' exercises run as a countdown
// timer in the UI; 'reps' exercises are counted sets.
//
// pct    : share of baseline used as the per-round working target
// floor  : minimum working target (never plan below this)
// step   : scroll-wheel increment when dialing this exercise

export const EXERCISES = [
  { id: 'pushups', name: 'PUSH-UPS', unit: 'reps',    pct: 0.55, floor: 1,  step: 1 },
  { id: 'plank',   name: 'PLANK',    unit: 'seconds', pct: 0.55, floor: 10, step: 5 },
  { id: 'squats',  name: 'SQUATS',   unit: 'reps',    pct: 0.55, floor: 1,  step: 1 },
  { id: 'burpees', name: 'BURPEES',  unit: 'reps',    pct: 0.55, floor: 1,  step: 1 },
];

export const byId = (id) => EXERCISES.find((e) => e.id === id);

export const REST_SECONDS = 90;
export const BASE_ROUNDS = 3;
export const MAX_ROUNDS = 5;
