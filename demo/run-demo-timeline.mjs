#!/usr/bin/env node

const base = process.env.FLOWER_DEMO_API || 'http://127.0.0.1:8787';

async function req(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('[demo] using api', base);

  const blobId = 'demo_blob';
  await req('/api/blobs', { method: 'POST', body: JSON.stringify({ blobId, content: 'flower demo timeline payload' }) });
  console.log('[demo] seeded blob', blobId);

  const challenge = await req('/api/challenges', {
    method: 'POST',
    body: JSON.stringify({
      blobId,
      payoutSchedule: [15, 10, 5],
      reliabilityBonusMsats: 1000,
      commitLeadSeconds: 20,
      revealLeadSeconds: 40,
    }),
  });
  console.log('[demo] challenge', challenge.payload.challengeId);

  await req('/api/challenges/respond', {
    method: 'POST',
    body: JSON.stringify({ challengeId: challenge.payload.challengeId, providerRole: 'provider' }),
  });
  await req('/api/challenges/respond', {
    method: 'POST',
    body: JSON.stringify({ challengeId: challenge.payload.challengeId, providerRole: 'provider2' }),
  });
  console.log('[demo] both providers responded');

  await sleep(500);
  const state = await req('/api/state');
  const settled = state.challenges.find((c) => c.challenge.payload.challengeId === challenge.payload.challengeId);

  console.log('[demo] settlement status:', settled?.status);
  console.log('[demo] winners:', settled?.settlement?.payload?.winners || []);
  console.log('[demo] payoutReceipts:', settled?.settlement?.payload?.payoutReceipts || []);

  if (!settled?.settlement) {
    console.error('[demo] no settlement yet; rerun after a few seconds');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[demo] failed', err);
  process.exit(1);
});
