import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/http.ts';
import { RcError } from '../src/errors.ts';

/**
 * `request()`'s body read (`res.text()`) sits inside the same retry budget as
 * a connect failure. A connection reset mid-body (undici `terminated`) is the
 * realistic production case this pins: it must be retried while attempts
 * remain, and only become a typed `RcError` once the budget is spent — never
 * escape as a bare `TypeError`.
 */

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function respondWithUnreadableBody(status = 200): Response {
  return new Response(new ReadableStream({
    start(controller) {
      queueMicrotask(() => controller.error(new TypeError('terminated')));
    },
  }), { status });
}

test('a body that fails to read is an RcError, not a bare TypeError, when retries are exhausted', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return respondWithUnreadableBody(); }) as typeof fetch;

  await assert.rejects(
    request('https://example.com/x', { retries: 0 }),
    (e: unknown) => {
      assert.ok(e instanceof RcError, `expected RcError, got ${(e as Error).constructor?.name}`);
      assert.match((e as Error).message, /terminated/);
      assert.equal((e as RcError).url, 'https://example.com/x');
      return true;
    },
  );
  assert.equal(calls, 1, 'retries: 0 must not retry the body read');
});

test('a body that fails to read is retried under retries: 1, then succeeds', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return respondWithUnreadableBody();
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const res = await request<{ ok: boolean }>('https://example.com/x', { retries: 1 });
  assert.equal(calls, 2, 'the body read must be retried, not just the connect');
  assert.deepEqual(res.data, { ok: true });
});

test('a non-JSON body that reads fine is kept as raw text, not an error', async () => {
  globalThis.fetch = (async () => new Response('<html>nope</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })) as typeof fetch;

  const res = await request('https://example.com/x');
  assert.equal(res.data, '<html>nope</html>');
});

test('an already-aborted signal stops retrying rather than burning the budget', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch;

  const ctl = new AbortController();
  ctl.abort();

  await assert.rejects(
    request('https://example.com/x', { retries: 3, signal: ctl.signal }),
    (e: unknown) => {
      assert.ok(e instanceof RcError);
      assert.match((e as Error).message, /aborted/i);
      return true;
    },
  );
  assert.equal(calls, 1, 'an aborted signal must stop before sleeping and retrying again');
});
