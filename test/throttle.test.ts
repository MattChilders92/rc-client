import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/http.ts';
import { RcUnavailableError } from '../src/errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Answer `status` every time, recording the gap between attempts. */
function throttling(status: number, headers: Record<string, string> = {}) {
  const at: number[] = [];
  globalThis.fetch = async () => {
    at.push(Date.now());
    return new Response('{}', { status, headers });
  };
  return at;
}

test('a 429 with no Retry-After waits seconds, not milliseconds', async () => {
  // The whole point: answering "slow down" with two more requests inside a
  // second is how a client earns an IP ban.
  const at = throttling(429);
  const started = Date.now();
  await assert.rejects(request('https://example.com/x', { retries: 1, timeoutMs: 1000 }), RcUnavailableError);
  assert.equal(at.length, 2, 'one retry');
  const gap = at[1]! - at[0]!;
  assert.ok(gap >= 10_000, `waited ${gap}ms, expected at least 10s`);
  assert.ok(Date.now() - started < 30_000, 'but not absurdly long');
});

test('Royal saying when to come back always wins over the floor', async () => {
  const at = throttling(429, { 'retry-after': '1' });
  await assert.rejects(request('https://example.com/x', { retries: 1, timeoutMs: 1000 }), RcUnavailableError);
  const gap = at[1]! - at[0]!;
  assert.ok(gap >= 900 && gap < 5_000, `honoured Retry-After, waited ${gap}ms`);
});

test('a 503 still backs off briefly — a server hiccup is not a rate limit', async () => {
  const at = throttling(503);
  await assert.rejects(request('https://example.com/x', { retries: 1, timeoutMs: 1000 }), RcUnavailableError);
  assert.ok(at[1]! - at[0]! < 3_000, 'sub-second-ish, as before');
});

test('retries: 0 means a 429 is never answered with a second request', async () => {
  const at = throttling(429);
  await assert.rejects(request('https://example.com/x', { retries: 0, timeoutMs: 1000 }), RcUnavailableError);
  assert.equal(at.length, 1);
});

test('a 403 is never retried, so a block is not hammered', async () => {
  const at = throttling(403);
  await assert.rejects(request('https://example.com/x', { retries: 3, timeoutMs: 1000 }));
  assert.equal(at.length, 1, 'one attempt only');
});
