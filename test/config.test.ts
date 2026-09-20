import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULT_CONFIG } from '../src/config.ts';
import { RcClient } from '../src/client.ts';
import { downloadPdf } from '../src/domains/certificates/pdf.ts';
import { RcError } from '../src/errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('an explicit undefined never clobbers a default', () => {
  // What `{ appKey: process.env.RC_APP_KEY }` produces when the variable is unset.
  const c = resolveConfig({ appKey: undefined, userAgent: undefined, timeoutMs: undefined, retries: undefined });
  assert.deepEqual(c, { ...DEFAULT_CONFIG });
});

test('resolveConfig returns a fresh object, so two clients never share one', () => {
  const a = resolveConfig();
  const b = resolveConfig();
  assert.notEqual(a, b);
  a.retries = 9;
  assert.equal(b.retries, DEFAULT_CONFIG.retries);
});

test('a zero is a real value, not an absent one', () => {
  assert.equal(resolveConfig({ retries: 0 }).retries, 0);
});

test('the static search takes its own config, since it cannot see an instance', async () => {
  let ua: string | null = null;
  globalThis.fetch = async (_url, init) => {
    ua = new Headers(init?.headers).get('user-agent');
    return new Response(JSON.stringify({ data: { cruiseSearch: { results: { total: 0, cruises: [] } } } }), { status: 200 });
  };
  await RcClient.search({}, { userAgent: 'rc-test/2' });
  assert.equal(ua, 'rc-test/2');
});

test('a PDF download that cannot connect is an RcError, not a bare TypeError', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcError);
    assert.equal((e as RcError).url, 'https://example.com/x.pdf');
    assert.match((e as Error).message, /fetch failed/);
    return true;
  });
});

test('a PDF download whose body fails to read is an RcError, not a bare TypeError', async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { queueMicrotask(() => controller.error(new TypeError('terminated'))); },
  }), { status: 200 });
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcError);
    assert.match((e as Error).message, /terminated/);
    assert.equal((e as RcError).url, 'https://example.com/x.pdf');
    return true;
  });
});

test('a PDF download is given the configured timeout', async () => {
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => { signal = init?.signal; return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
  const bytes = await downloadPdf('https://example.com/x.pdf', resolveConfig({ timeoutMs: 1234 }));
  assert.ok(signal instanceof AbortSignal, 'an abort signal was passed');
  assert.deepEqual([...bytes], [1, 2, 3]);
});
