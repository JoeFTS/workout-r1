// storage.mjs — persistence over window.creationStorage.plain (R1 SDK).
// Falls back to localStorage in a normal browser (dev harness).
// Ported from pitch-tracker-r1; the SDK store is a Base64-JSON KV bucket.

const HAS_CREATION = typeof window !== 'undefined'
  && window.creationStorage && window.creationStorage.plain;

function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
function b64decode(s) { return decodeURIComponent(escape(atob(s))); }

async function rawGet(key) {
  if (HAS_CREATION) {
    const v = await window.creationStorage.plain.getItem(key);
    return v == null ? null : b64decode(v);
  }
  return localStorage.getItem(key);
}
async function rawSet(key, val) {
  if (HAS_CREATION) return window.creationStorage.plain.setItem(key, b64encode(val));
  localStorage.setItem(key, val);
}

export async function getJSON(key, fallback = null) {
  const raw = await rawGet(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
export async function setJSON(key, obj) { await rawSet(key, JSON.stringify(obj)); }

// --- typed helpers for our keys ---
export const K = { profile: 'profile', log: 'log', queue: 'syncQueue' };

export const loadProfile = () => getJSON(K.profile, null);
export const saveProfile = (p) => setJSON(K.profile, p);

export const loadLog = () => getJSON(K.log, []);
export const saveLog = (l) => setJSON(K.log, l);

export const loadQueue = () => getJSON(K.queue, []);
export const saveQueue = (q) => setJSON(K.queue, q);

export const storageMode = HAS_CREATION ? 'creationStorage' : 'localStorage(dev)';
