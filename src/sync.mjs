// sync.mjs — opportunistic, offline-tolerant push to the Apps Script webhook.
// Ported from pitch-tracker-r1. Never blocks the UI; failed payloads land in
// syncQueue and drain on the next successful POST. POSTs as text/plain to
// skip the CORS preflight (Apps Script trick).

import { loadQueue, saveQueue } from './storage.mjs';
import { summarize, totals } from './engine.mjs';

export let WEBHOOK_URL = '';
export function setWebhook(url) { WEBHOOK_URL = url; }

async function post(payload) {
  if (!WEBHOOK_URL) return false;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // dodge CORS preflight
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // offline / network error -> stays queued
  }
}

// Enqueue a payload and immediately attempt a drain.
export async function enqueue(payload) {
  const q = await loadQueue();
  q.push(payload);
  await saveQueue(q);
  return drain();
}

// Drain in order; stop at first failure (keeps order, retries later).
export async function drain() {
  let q = await loadQueue();
  let sent = 0;
  while (q.length) {
    const ok = await post(q[0]);
    if (!ok) break;
    q.shift();
    sent++;
    await saveQueue(q);
  }
  return { sent, remaining: q.length };
}

// One row per log entry; the Sheet upserts by entry id so retries are safe.
export function entryPayload(entry) {
  return {
    action: 'log',
    id: entry.id,
    date: entry.date,
    type: entry.type,
    details: summarize(entry),
    ...totals(entry),
  };
}
