// app.mjs — UI controller. All rules live in engine.mjs; this file only
// routes hardware events, renders screens, and persists via storage/sync.

import { EXERCISES, byId, REST_SECONDS } from './exercises.mjs';
import {
  defaultProfile, hasBaseline, setBaselines, planWorkout, makeEntry,
  todayStatus, streak, weekHistory, totals,
  hasBody, setBody, latestWeight, bmi,
} from './engine.mjs';
import {
  loadProfile, saveProfile, loadLog, saveLog, loadQueue,
  getJSON, setJSON, storageMode,
} from './storage.mjs';
import { setWebhook, enqueue, drain, entryPayload } from './sync.mjs';
import { bindHardware } from './hardware.mjs';

const $ = (id) => document.getElementById(id);
const SCREENS = ['home', 'baseline', 'workout', 'rest', 'complete', 'sauna', 'run', 'menu', 'help', 'weight', 'logview'];
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- state ----------

let profile = defaultProfile();
let log = [];
let screen = 'home';

let bl = null;      // baseline test: { idx, values }
let wk = null;      // workout session: { plan, round, exIdx, actuals, dial, plank }
let rest = null;    // { remaining, timer }
let sauna = { mode: 'idle', seconds: 0, minutes: 20, timer: null };
let run = { minutes: 30, dist: 0, field: 'min' };
let helpMode = 'menu'; // 'menu' (opened from menu) | 'firstrun' (intro before baseline)
let wt = null;         // weigh-in: { step: 'height'|'weigh'|'target', heightIn, lbs, targetLbs }

const BL_DEFAULTS = { pushups: 20, plank: 60, squats: 30, burpees: 10 };

// ---------- audio ----------

let audioCtx = null;
function beep(freq = 880, ms = 90) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.06;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* no audio available */ }
}
const tripleBeep = () => { beep(880); setTimeout(() => beep(880), 150); setTimeout(() => beep(1320, 220), 300); };

// ---------- helpers ----------

function show(name) {
  screen = name;
  for (const s of SCREENS) $(s).style.display = s === name ? 'flex' : 'none';
}

function renderBattery(el, total, done, liveIdx = -1) {
  el.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const seg = document.createElement('div');
    seg.className = 'seg' + (i < done ? ' full' : i === liveIdx ? ' live' : '');
    el.appendChild(seg);
  }
}

async function saveSession() {
  await setJSON('session', wk && { ...wk, plank: null, date: todayISO() });
}

async function commitEntry(type, payload) {
  const entry = makeEntry(type, todayISO(), payload);
  log.push(entry);
  await saveLog(log);
  enqueue(entryPayload(entry)).then(renderSyncDot);
  return entry;
}

// ---------- home ----------

async function renderHome() {
  const today = todayISO();
  const st = todayStatus(log, today);
  const plan = hasBaseline(profile) ? planWorkout(profile, log, today) : null;

  renderBattery($('homeBattery'), plan ? plan.rounds : 3, st.workout ? (plan ? plan.rounds : 3) : 0);
  $('homeStatus').innerHTML = [
    ['WORKOUT', st.workout], ['RUN', st.run], ['SAUNA', st.sauna],
  ].map(([n, on]) => `<span class="${on ? 'on' : 'off'}">${n[0]}</span>`).join('');
  $('streakNum').textContent = streak(log, today);

  const session = await getJSON('session', null);
  const resumable = session && session.date === today && !st.workout;
  $('btnWorkout').textContent =
    !hasBaseline(profile) ? 'BASELINE TEST'
      : resumable ? 'RESUME WORKOUT'
        : st.workout ? 'WORKOUT DONE ✓' : 'START WORKOUT';
  $('btnWorkout').dataset.resume = resumable ? '1' : '';
  $('btnWorkout').classList.toggle('primary', !st.workout); // quiet once done
  renderSyncDot();
  show('home');
}

async function renderSyncDot() {
  const q = await loadQueue();
  $('syncDot').className = 'dot ' + (q.length ? 'pending' : 'ok');
  $('footNote').textContent = q.length ? `${q.length} queued · hold side = menu` : 'hold side = menu';
}

// ---------- baseline test ----------

function startBaseline() {
  bl = { idx: 0, values: { ...(profile.baselines || BL_DEFAULTS) } };
  renderBaseline();
  show('baseline');
}

function renderBaseline() {
  const ex = EXERCISES[bl.idx];
  $('blName').textContent = ex.name;
  $('blNum').textContent = bl.values[ex.id];
  $('blUnit').textContent = ex.unit === 'seconds' ? 'SECONDS HELD' : 'REPS';
  $('blConfirm').textContent = bl.idx === EXERCISES.length - 1 ? 'FINISH TEST' : 'CONFIRM';
}

async function confirmBaseline() {
  if (bl.idx < EXERCISES.length - 1) {
    bl.idx++;
    renderBaseline();
    return;
  }
  profile = setBaselines(profile, bl.values, todayISO());
  await saveProfile(profile);
  bl = null;
  renderHome();
}

// ---------- workout ----------

function startWorkout(session = null) {
  const plan = planWorkout(profile, log, todayISO());
  wk = session
    ? { ...session, plan: session.plan, plank: null }
    : { plan, round: 0, exIdx: 0, actuals: [], dial: 0, plank: null };
  wk.dial = wk.plan.targets[EXERCISES[wk.exIdx].id];
  renderWorkout();
  show('workout');
  saveSession();
}

function currentEx() { return EXERCISES[wk.exIdx]; }

function renderWorkout() {
  const ex = currentEx();
  renderBattery($('wkBattery'), wk.plan.rounds, wk.round, wk.round);
  $('wkRound').textContent = `ROUND ${wk.round + 1}/${wk.plan.rounds}`;
  $('wkName').textContent = ex.name;

  if (ex.unit === 'seconds') {
    if (wk.plank && wk.plank.running) {
      $('wkNum').textContent = wk.plank.remaining;
      $('wkUnit').textContent = 'HOLD';
      $('wkAction').textContent = 'STOP EARLY';
    } else {
      $('wkNum').textContent = wk.dial;
      $('wkUnit').textContent = 'SECONDS';
      $('wkAction').textContent = 'START HOLD';
    }
  } else {
    $('wkNum').textContent = wk.dial;
    $('wkUnit').textContent = `REPS · TARGET ${wk.plan.targets[ex.id]}`;
    $('wkAction').textContent = 'DONE';
  }
}

function workoutAction() {
  const ex = currentEx();
  if (ex.unit === 'seconds') {
    if (!wk.plank || !wk.plank.running) {
      // start the hold countdown
      wk.plank = { running: true, remaining: wk.dial, total: wk.dial };
      wk.plank.timer = setInterval(() => {
        wk.plank.remaining--;
        if (wk.plank.remaining <= 3 && wk.plank.remaining > 0) beep(660, 60);
        if (wk.plank.remaining <= 0) {
          stopPlank(wk.plank.total);
          tripleBeep();
        } else if (screen === 'workout') renderWorkout();
      }, 1000);
      renderWorkout();
    } else {
      stopPlank(wk.plank.total - wk.plank.remaining); // stopped early: log elapsed
    }
    return;
  }
  recordActual(wk.dial);
}

function stopPlank(secondsHeld) {
  clearInterval(wk.plank.timer);
  wk.plank = null;
  recordActual(secondsHeld);
}

function recordActual(value) {
  if (!wk.actuals[wk.round]) wk.actuals[wk.round] = {};
  wk.actuals[wk.round][currentEx().id] = value;
  advance();
}

function advance() {
  if (wk.exIdx < EXERCISES.length - 1) {
    wk.exIdx++;
    wk.dial = wk.plan.targets[currentEx().id];
    renderWorkout();
    saveSession();
    return;
  }
  // round complete
  if (wk.round < wk.plan.rounds - 1) {
    wk.round++;
    wk.exIdx = 0;
    wk.dial = wk.plan.targets[EXERCISES[0].id];
    saveSession();
    startRest();
  } else {
    finishWorkout();
  }
}

function undoWorkout() {
  if (wk.plank) { clearInterval(wk.plank.timer); wk.plank = null; renderWorkout(); return; }
  if (wk.exIdx > 0) {
    wk.exIdx--;
  } else if (wk.round > 0) {
    wk.round--;
    wk.exIdx = EXERCISES.length - 1;
  } else {
    saveSession();
    renderHome(); // back out of the workout; session persists for resume
    return;
  }
  const prev = wk.actuals[wk.round] && wk.actuals[wk.round][currentEx().id];
  wk.dial = prev != null ? prev : wk.plan.targets[currentEx().id];
  renderWorkout();
  saveSession();
}

function startRest() {
  rest = { remaining: REST_SECONDS };
  $('restNum').textContent = rest.remaining;
  $('restNum').classList.remove('pulse');
  show('rest');
  rest.timer = setInterval(() => {
    rest.remaining--;
    $('restNum').textContent = rest.remaining;
    if (rest.remaining === 3) $('restNum').classList.add('pulse');
    if (rest.remaining <= 3 && rest.remaining > 0) beep(660, 60);
    if (rest.remaining <= 0) endRest();
  }, 1000);
}

function endRest() {
  if (!rest) return;
  clearInterval(rest.timer);
  rest = null;
  tripleBeep();
  renderWorkout();
  show('workout');
}

async function finishWorkout() {
  const entry = await commitEntry('workout', {
    rounds: wk.actuals,
    planned: wk.plan.targets,
    level: wk.plan.level,
  });
  await setJSON('session', null);
  renderBattery($('doneBattery'), wk.plan.rounds, wk.plan.rounds);
  $('doneSummary').textContent = `${totals(entry).reps} REPS · ${wk.plan.rounds} ROUNDS`;
  wk = null;
  tripleBeep();
  show('complete');
}

// ---------- sauna ----------

function fmtClock(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function renderSauna() {
  if (sauna.mode === 'manual') {
    $('saNum').textContent = sauna.minutes;
    $('saUnit').textContent = 'MINUTES';
    $('saMain').textContent = 'SAVE';
    $('saManual').textContent = 'USE TIMER';
  } else {
    $('saNum').textContent = fmtClock(sauna.seconds);
    $('saUnit').textContent = 'MIN : SEC';
    $('saMain').textContent = sauna.mode === 'running' ? 'STOP & SAVE' : 'START';
    $('saManual').textContent = 'MANUAL ENTRY';
  }
}

async function saunaMain() {
  if (sauna.mode === 'manual') {
    await commitEntry('sauna', { minutes: sauna.minutes, source: 'manual' });
    resetSauna();
    renderHome();
  } else if (sauna.mode === 'idle') {
    sauna.mode = 'running';
    sauna.seconds = 0;
    sauna.timer = setInterval(() => {
      sauna.seconds++;
      if (screen === 'sauna') renderSauna();
    }, 1000);
    renderSauna();
  } else {
    const minutes = Math.max(1, Math.round(sauna.seconds / 60));
    await commitEntry('sauna', { minutes, source: 'timer' });
    resetSauna();
    renderHome();
  }
}

function resetSauna() {
  if (sauna.timer) clearInterval(sauna.timer);
  sauna = { mode: 'idle', seconds: 0, minutes: sauna.minutes, timer: null };
}

// ---------- run ----------

function renderRun() {
  $('runMin').textContent = run.minutes;
  $('runDist').textContent = (run.dist / 10).toFixed(1);
  $('fMin').classList.toggle('active', run.field === 'min');
  $('fDist').classList.toggle('active', run.field === 'dist');
}

// ---------- menu / history ----------

async function renderMenu() {
  const rows = weekHistory(log, todayISO());
  $('histList').innerHTML = rows.map((r) => {
    const dow = dowOf(r.date);
    return `<div class="histRow"><span class="d">${dow} ${r.date.slice(5)}</span>` +
      `<span class="m"><span class="${r.workout ? 'on' : ''}">W</span>` +
      `<span class="${r.run ? 'on' : ''}">R</span>` +
      `<span class="${r.sauna ? 'on' : ''}">S</span></span></div>`;
  }).join('');
  const q = await loadQueue();
  $('mQueue').textContent = q.length ? `(${q.length})` : '';
  show('menu');
}

// ---------- full log ----------

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dowOf = (iso) => DAYS[new Date(iso + 'T12:00:00').getDay()];

// Compact one-line detail for the tiny screen (summarize() is Sheet-length).
function logDetail(e) {
  const p = e.payload;
  if (e.type === 'workout') {
    const t = totals(e);
    const plank = p.rounds.reduce((s, r) => s + (r.plank || 0), 0);
    return `${t.reps} reps · ${p.rounds.length} rounds · plank ${plank}s`;
  }
  if (e.type === 'run')
    return p.distance ? `${p.minutes} min · ${(p.distance / 10).toFixed(1)} mi` : `${p.minutes} min`;
  if (e.type === 'sauna') return `${p.minutes} min`;
  if (e.type === 'weight') return `${p.lbs} lb`;
  return '';
}

function openLog() {
  const rows = [...log].reverse().slice(0, 60); // newest first, plenty for a scroll
  $('logList').innerHTML = rows.length
    ? rows.map((e) => {
      const md = e.date.slice(5).replace('-', '/');
      return `<div class="logEntry t-${e.type}">` +
        `<div class="logHead"><span class="what">${e.type.toUpperCase()}</span>` +
        `<span class="when">${dowOf(e.date)} ${md}</span></div>` +
        `<div class="logDetail">${logDetail(e)}</div></div>`;
    }).join('')
    : '<div class="logEmpty">NOTHING LOGGED YET</div>';
  $('logList').scrollTop = 0;
  show('logview');
}

// ---------- weigh in ----------

const fmtHeight = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;

function openWeight() {
  const last = latestWeight(log);
  wt = hasBody(profile)
    ? { step: 'weigh', ...profile.body, lbs: last || 180 }
    : { step: 'height', heightIn: 70, lbs: last || 180, targetLbs: 0 };
  renderWeight();
  show('weight');
}

function renderWeight() {
  const setup = !hasBody(profile);
  $('wtTop').textContent = setup ? 'BODY SETUP' : 'WEIGH IN';
  if (wt.step === 'height') {
    $('wtLabel').textContent = 'HEIGHT';
    $('wtNum').textContent = fmtHeight(wt.heightIn);
    $('wtUnit').textContent = 'FT / IN';
    $('wtConfirm').textContent = 'CONFIRM';
  } else if (wt.step === 'weigh') {
    $('wtLabel').textContent = 'WEIGHT';
    $('wtNum').textContent = wt.lbs;
    const parts = [`BMI ${bmi(wt.heightIn, wt.lbs)}`];
    if (wt.targetLbs > 0) {
      const togo = wt.lbs - wt.targetLbs;
      parts.unshift(`TARGET ${wt.targetLbs}`);
      parts.push(togo > 0 ? `${togo} TO GO` : 'AT TARGET ✓');
    }
    $('wtUnit').textContent = parts.join(' · ');
    $('wtConfirm').textContent = setup ? 'CONFIRM' : 'SAVE';
  } else { // target
    $('wtLabel').textContent = 'TARGET WEIGHT';
    $('wtNum').textContent = wt.targetLbs;
    $('wtUnit').textContent = `CURRENT ${wt.lbs} LB`;
    $('wtConfirm').textContent = 'FINISH SETUP';
  }
}

async function confirmWeight() {
  if (wt.step === 'height') {
    wt.step = 'weigh';
    renderWeight();
  } else if (wt.step === 'weigh' && !hasBody(profile)) {
    wt.targetLbs = wt.targetLbs || Math.max(1, wt.lbs - 10);
    wt.step = 'target';
    renderWeight();
  } else {
    if (!hasBody(profile)) {
      profile = setBody(profile, { heightIn: wt.heightIn, targetLbs: wt.targetLbs });
      await saveProfile(profile);
    }
    await commitEntry('weight', { lbs: wt.lbs });
    wt = null;
    renderHome();
  }
}

// ---------- help ----------

function openHelp(mode) {
  helpMode = mode;
  $('helpOk').textContent = mode === 'firstrun' ? 'START BASELINE TEST' : 'GOT IT';
  $('helpBody').scrollTop = 0;
  show('help');
}

function closeHelp() {
  if (helpMode === 'firstrun') startBaseline();
  else renderMenu();
}

// ---------- hardware routing ----------

function dial(delta) {
  const clamp0 = (v) => Math.max(0, v);
  if (screen === 'baseline') {
    const ex = EXERCISES[bl.idx];
    bl.values[ex.id] = Math.max(1, bl.values[ex.id] + delta * ex.step);
    renderBaseline();
  } else if (screen === 'workout' && !(wk.plank && wk.plank.running)) {
    wk.dial = clamp0(wk.dial + delta * currentEx().step);
    renderWorkout();
  } else if (screen === 'sauna' && sauna.mode === 'manual') {
    sauna.minutes = Math.max(1, sauna.minutes + delta);
    renderSauna();
  } else if (screen === 'run') {
    if (run.field === 'min') run.minutes = Math.max(1, run.minutes + delta);
    else run.dist = clamp0(run.dist + delta);
    renderRun();
  } else if (screen === 'help') {
    $('helpBody').scrollTop -= delta * 40; // wheel up scrolls up
  } else if (screen === 'logview') {
    $('logList').scrollTop -= delta * 40;
  } else if (screen === 'weight') {
    if (wt.step === 'height') wt.heightIn = Math.min(96, Math.max(48, wt.heightIn + delta));
    else if (wt.step === 'weigh') wt.lbs = Math.max(50, wt.lbs + delta);
    else wt.targetLbs = Math.max(50, wt.targetLbs + delta);
    renderWeight();
  }
}

function sideClick() {
  if (screen === 'workout') undoWorkout();
  else if (screen === 'baseline') {
    if (bl.idx > 0) { bl.idx--; renderBaseline(); }
    else if (hasBaseline(profile)) renderHome(); // can't skip first-ever test
  } else if (screen === 'sauna') {
    if (sauna.mode !== 'running') { resetSauna(); renderHome(); }
  } else if (screen === 'run' || screen === 'menu') renderHome();
  else if (screen === 'help') {
    if (helpMode === 'firstrun') renderHome();
    else renderMenu();
  } else if (screen === 'logview') renderMenu();
  else if (screen === 'weight') {
    if (wt.step === 'target') { wt.step = 'weigh'; renderWeight(); }
    else if (wt.step === 'weigh' && !hasBody(profile)) { wt.step = 'height'; renderWeight(); }
    else { wt = null; renderMenu(); }
  }
}

// ---------- boot ----------

export async function boot({ webhook }) {
  setWebhook(webhook);
  profile = (await loadProfile()) || defaultProfile();
  log = await loadLog();

  // taps
  $('btnWorkout').onclick = async () => {
    if (!hasBaseline(profile)) return openHelp('firstrun'); // intro before first test
    const st = todayStatus(log, todayISO());
    if (st.workout) return; // already done today
    if ($('btnWorkout').dataset.resume) {
      const session = await getJSON('session', null);
      if (session && session.date === todayISO()) return startWorkout(session);
    }
    startWorkout();
  };
  $('btnRun').onclick = () => { renderRun(); show('run'); };
  $('btnSauna').onclick = () => { renderSauna(); show('sauna'); };
  $('blConfirm').onclick = confirmBaseline;
  $('wkAction').onclick = workoutAction;
  $('rest').onclick = endRest;
  $('doneOk').onclick = renderHome;
  $('saMain').onclick = saunaMain;
  $('saManual').onclick = () => {
    if (sauna.mode === 'running') return;
    sauna.mode = sauna.mode === 'manual' ? 'idle' : 'manual';
    renderSauna();
  };
  $('fMin').onclick = () => { run.field = 'min'; renderRun(); };
  $('fDist').onclick = () => { run.field = 'dist'; renderRun(); };
  $('runSave').onclick = async () => {
    await commitEntry('run', {
      minutes: run.minutes,
      ...(run.dist > 0 ? { distance: run.dist } : {}),
    });
    renderHome();
  };
  $('mResync').onclick = async () => { await drain(); renderMenu(); renderSyncDot(); };
  $('mBaseline').onclick = startBaseline;
  $('histList').onclick = openLog;
  document.querySelector('.streakBlock').onclick = openLog;
  $('mWeigh').onclick = openWeight;
  $('wtConfirm').onclick = confirmWeight;
  $('mHelp').onclick = () => openHelp('menu');
  $('helpOk').onclick = closeHelp;
  $('mBack').onclick = renderHome;

  // wheel + buttons
  bindHardware({
    onScrollUp: () => dial(1),
    onScrollDown: () => dial(-1),
    onSideClick: sideClick,
    onLongPress: () => { if (screen === 'home' || screen === 'menu') renderMenu(); },
  });

  console.log(`forge boot: storage=${storageMode}`);
  drain().then(renderSyncDot);
  renderHome();
}
