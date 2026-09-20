import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchCruises, fetchItineraryPorts } from '../src/domains/search.ts';
import { downloadPdf } from '../src/domains/certificates/pdf.ts';
import { RcError, RcRequestError, RcShapeError, RcUnavailableError } from '../src/errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a GraphQL error inside a 200 is an RcRequestError carrying the error list', async () => {
  const errors = [{ message: 'Cannot query field "nope"' }];
  globalThis.fetch = async () => jsonResponse({ errors });
  await assert.rejects(searchCruises(), (e: unknown) => {
    assert.ok(e instanceof RcRequestError, `expected RcRequestError, got ${(e as Error).constructor.name}`);
    assert.deepEqual((e as RcError).body, errors);
    assert.match((e as Error).message, /Cannot query field/);
    return true;
  });
});

test('fetchItineraryPorts follows the same contract', async () => {
  globalThis.fetch = async () => jsonResponse({ errors: [{ message: 'boom' }] });
  await assert.rejects(fetchItineraryPorts(), RcRequestError);
});

test('a 200 carrying an HTML challenge page throws instead of reporting zero results', async () => {
  globalThis.fetch = async () => new Response('<html>please enable JavaScript</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  await assert.rejects(searchCruises(), (e: unknown) => {
    assert.ok(e instanceof RcShapeError, `expected RcShapeError, got ${(e as Error).constructor?.name}`);
    return true;
  });
});

test('fetchItineraryPorts also throws on a non-JSON 200, rather than an empty page', async () => {
  globalThis.fetch = async () => new Response('<html>please enable JavaScript</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  await assert.rejects(fetchItineraryPorts(), RcShapeError);
});

test('downloadPdf turns a 404 into an RcError with status and url', async () => {
  globalThis.fetch = async () => new Response('gone', { status: 404 });
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcError);
    assert.equal((e as RcError).status, 404);
    assert.equal((e as RcError).url, 'https://example.com/x.pdf');
    return true;
  });
});

test('downloadPdf turns a 503 into an RcUnavailableError', async () => {
  globalThis.fetch = async () => new Response('', { status: 503, headers: { 'retry-after': '2' } });
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcUnavailableError);
    assert.equal((e as RcUnavailableError).retryAfterMs, 2000);
    return true;
  });
});
