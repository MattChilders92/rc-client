import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchCruises, fetchItineraryPorts } from '../src/domains/search.ts';
import { fetchRooms } from '../src/domains/rooms.ts';
import { fetchCasinoLoyalty } from '../src/domains/casino.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const session = { accessToken: 'tok', accountId: 'acct', expiresAt: new Date(Date.now() + 60_000) };

/** Capture the URL and headers of the next request, and answer with `body`. */
function capture(body: unknown, status = 200) {
  const seen: { url: string; headers: Headers }[] = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

const EMPTY_SEARCH = { data: { cruiseSearch: { results: { total: 0, cruises: [] } } } };

test('search goes to the brand\'s own site and says so in the header', async () => {
  let seen = capture(EMPTY_SEARCH);
  await searchCruises({ brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com\/graph/);
  assert.equal(seen[0]!.headers.get('brand'), 'C');

  seen = capture(EMPTY_SEARCH);
  await searchCruises({ brand: 'R' });
  assert.match(seen[0]!.url, /royalcaribbean\.com\/graph/);
  assert.equal(seen[0]!.headers.get('brand'), 'R');
});

test('search defaults to Royal, so an existing caller is unaffected', async () => {
  const seen = capture(EMPTY_SEARCH);
  await searchCruises();
  assert.match(seen[0]!.url, /royalcaribbean\.com/);
  assert.equal(seen[0]!.headers.get('brand'), 'R');
});

test('itinerary ports follow the same brand', async () => {
  const seen = capture(EMPTY_SEARCH);
  await fetchItineraryPorts({ brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com/);
  assert.equal(seen[0]!.headers.get('brand'), 'C');
});

test('room pricing goes to the brand\'s site', async () => {
  const seen = capture({ sailings: [] });
  await fetchRooms({ packageCode: 'RF4BH328', sailDate: '2026-11-16', brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com\/itinerary\/api\/v1\/sailings/);
});

test('casino loyalty goes to the brand\'s site', async () => {
  const seen = capture({ data: {} });
  // `brand` lives on the options object here, not as its own positional
  // argument — see the JSDoc on `fetchCasinoLoyalty` for why.
  await fetchCasinoLoyalty(session, { brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com\/api\/casino\/v1\/loyalty-data/);
});
