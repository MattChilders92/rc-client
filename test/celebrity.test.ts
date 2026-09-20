import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchCruises, fetchItineraryPorts } from '../src/domains/search.ts';
import { fetchRooms } from '../src/domains/rooms.ts';
import { fetchCasinoLoyalty } from '../src/domains/casino.ts';
import { listOffers, fetchOfferDetail } from '../src/domains/offers.ts';
import { RcClient } from '../src/client.ts';
import { RcAuthError, RcRequestError } from '../src/errors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

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

test('a sailing carries the package code room pricing needs', async () => {
  const seen = capture({
    data: { cruiseSearch: { results: { total: 1, cruises: [{
      masterSailing: { itinerary: { code: 'RF4BH330', ship: { code: 'RF' } } },
      sailings: [{ id: 'RF4BH328_2026-11-16', sailDate: '2026-11-16', itinerary: { code: 'RF4BH330' } }],
    }] } } },
  });
  const { cruises } = await searchCruises({ brand: 'C' });
  const sailing = cruises[0]!.sailings[0]!;
  assert.equal(sailing.sailingId, 'RF4BH328_2026-11-16');
  assert.equal(sailing.packageCode, 'RF4BH328', 'the bookable code, not the itinerary code');
  assert.equal(sailing.itineraryCode, 'RF4BH330');
  assert.notEqual(sailing.packageCode, sailing.itineraryCode);
  assert.ok(seen.length === 1);
});

test('a malformed or missing sailing id yields a null package code, never a guess', async () => {
  capture({
    data: { cruiseSearch: { results: { total: 1, cruises: [{
      masterSailing: { itinerary: { code: 'X' } },
      sailings: [{ id: 'no-underscore', sailDate: null }, { sailDate: null }],
    }] } } },
  });
  const { cruises } = await searchCruises();
  assert.equal(cruises[0]!.sailings[0]!.packageCode, null);
  assert.equal(cruises[0]!.sailings[1]!.packageCode, null);
});

test('the recorded Celebrity search fixture proves the package/itinerary trap is real', async () => {
  // Task 1's live capture: a sailing under the RF4BH330 master itinerary
  // actually books under package code RF4BH328 — room pricing 404s on the
  // former and 200s on the latter. This replays that exact recorded response
  // rather than inventing one, so the assertion is anchored to the proof.
  const fixture = load('celebrity-search');
  const seen = capture(fixture.body);
  const { cruises } = await searchCruises({ brand: 'C' });
  assert.ok(seen.length === 1);

  const mismatch = cruises
    .flatMap((c) => c.sailings.map((s) => ({ cruiseItineraryCode: c.itineraryCode, sailing: s })))
    .find(({ cruiseItineraryCode, sailing }) =>
      sailing.packageCode !== null && sailing.packageCode !== cruiseItineraryCode);

  assert.ok(mismatch, 'fixture must contain a sailing whose package code differs from its cruise itinerary code');
  assert.equal(mismatch!.cruiseItineraryCode, 'RF4BH330');
  assert.equal(mismatch!.sailing.packageCode, 'RF4BH328');
});

test('casino offers: listOffers hits the Celebrity host for brand C', async () => {
  const fixture = load('celebrity-offers-empty');
  const seen = capture(fixture.body);
  await listOffers(session, { loyaltyId: 'CC123', brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com\/api\/casino\/v2\/offers\/list/);
});

test('casino offers: fetchOfferDetail hits the Celebrity host for brand C', async () => {
  const seen = capture({ offers: [] });
  await fetchOfferDetail(session, { loyaltyId: 'CC123', offerCode: 'X', playerOfferId: 'Y', brand: 'C' });
  assert.match(seen[0]!.url, /celebritycruises\.com\/api\/casino\/v2\/offers\/details/);
});

test('casino offers: offers default to the Royal host when no brand is given', async () => {
  const seen = capture({ offers: [], totalOffers: 0, totalPages: 0 });
  await listOffers(session, { loyaltyId: 'CA123' });
  assert.match(seen[0]!.url, /royalcaribbean\.com\/api\/casino\/v2\/offers\/list/);
});

test('the recorded empty Celebrity offers envelope is outcome "ok" with zero offers, not "none"', async () => {
  // A 200 with an empty list is a real answer, unlike a 404 which means
  // "Royal answered 404 about this player" and maps to outcome: 'none'.
  const fixture = load('celebrity-offers-empty');
  capture(fixture.body);
  const result = await listOffers(session, { loyaltyId: 'CC123', brand: 'C' });
  assert.equal(result.outcome, 'ok');
  assert.equal(result.offers.length, 0);
  assert.equal(result.totalOffers, 0);
});

test('a 401 naming the loyalty id becomes RcRequestError naming the brand, not RcAuthError', async () => {
  capture({ message: 'Unauthorized - invalid loyalty id' }, 401);
  await assert.rejects(
    () => listOffers(session, { loyaltyId: 'CA123', brand: 'C' }),
    (err: unknown) => {
      assert.ok(err instanceof RcRequestError, `expected RcRequestError, got ${(err as Error)?.constructor?.name}`);
      assert.match((err as Error).message, /loyalty/i);
      assert.match((err as Error).message, /Celebrity|C\b/);
      return true;
    },
  );
});

test('a 401 that does not mention the loyalty id still becomes RcAuthError', async () => {
  capture({ message: 'Unauthorized' }, 401);
  await assert.rejects(
    () => listOffers(session, { loyaltyId: 'CA123', brand: 'R' }),
    (err: unknown) => {
      assert.ok(err instanceof RcAuthError, `expected RcAuthError, got ${(err as Error)?.constructor?.name}`);
      return true;
    },
  );
});

test('the same loyalty-id guard applies to fetchOfferDetail', async () => {
  capture({ message: 'Unauthorized - invalid loyalty id' }, 401);
  await assert.rejects(
    () => fetchOfferDetail(session, { loyaltyId: 'CA123', offerCode: 'X', playerOfferId: 'Y', brand: 'C' }),
    RcRequestError,
  );
});

test('RcClient with brand C and no Captain\'s Club number returns none/null without a request', async () => {
  const rc = new RcClient({ session }, { brand: 'C' });

  // Prime the cached account with no Captain's Club id.
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ payload: { loyaltyInformation: {} } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  await rc.account();

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not be called when there is no loyalty number for the brand');
  };

  const offers = await rc.offers();
  assert.equal(called, false);
  assert.equal(offers.outcome, 'none');
  assert.equal(offers.offers.length, 0);

  const detail = await rc.offerDetail('CODE', 'POID');
  assert.equal(called, false);
  assert.equal(detail, null);
});

test('a Celebrity client asks its own brand for casino loyalty', async () => {
  const seen = capture({ data: {} });
  const rc = new RcClient(
    { session: { accessToken: 'tok', accountId: 'acct', expiresAt: new Date(Date.now() + 60_000) } },
    { brand: 'C' },
  );
  await rc.casinoLoyalty();
  assert.match(seen[0]!.url, /celebritycruises\.com\/api\/casino\/v1\/loyalty-data/);
});
