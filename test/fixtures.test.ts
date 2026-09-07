import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAccount } from '../src/domains/account.ts';
import { fetchCasinoLoyalty } from '../src/domains/casino.ts';
import { listOffers, freePlayFrom } from '../src/domains/offers.ts';
import { fetchRooms, roomKey } from '../src/domains/rooms.ts';
import { fetchCategory } from '../src/domains/products.ts';
import { listBookings } from '../src/domains/bookings.ts';
import type { RcSession } from '../src/auth/index.ts';

/**
 * These replay real captured responses through the mappers.
 *
 * The point is not coverage for its own sake: Royal changes response shapes
 * without notice, and a mapper that quietly returns nulls looks identical to an
 * account with no data. A failure here names the field that moved.
 *
 * Re-record with `npm run capture` when Royal changes something.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const session: RcSession = {
  accessToken: 'test-token',
  accountId: '00000000-0000-0000-0000-000000000000',
  expiresAt: new Date(Date.now() + 3600_000),
};

const realFetch = globalThis.fetch;

/** Serve one fixture to whatever the code under test requests. */
function stub(name: string) {
  const fixture = load(name);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixture.body), {
      status: fixture._status ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

beforeEach(() => { /* each test stubs its own */ });
afterEach(() => { globalThis.fetch = realFetch; });

test('account maps loyalty out of the payload envelope', async () => {
  stub('account');
  const account = await fetchAccount(session);

  // The trap: everything real lives under `payload`, and the loyalty fields are
  // flat with long names rather than nested per programme.
  assert.equal(account.clubRoyaleTier, 'PRIME');
  assert.equal(account.clubRoyalePoints, 10151);
  assert.equal(account.crownAndAnchorTier, 'EMERALD');
  assert.ok(account.crownAndAnchorId, 'loyalty id is what the offers API keys on');
});

test('account treats the string "NONE" as no tier', async () => {
  stub('account');
  const account = await fetchAccount(session);
  for (const tier of [account.captainsClubTier, account.clubRoyaleTier]) {
    assert.notEqual(tier, 'NONE', 'NONE must normalise to null, not leak as a value');
  }
});

test('casino loyalty returns the casino profile id and evaluation window', async () => {
  stub('casino-loyalty');
  const loyalty = await fetchCasinoLoyalty(session);
  assert.ok(loyalty);
  assert.equal(loyalty.tier, 'Prime');
  assert.equal(loyalty.individualPoints, 10151);
  assert.ok(loyalty.periodStart && loyalty.periodEnd, 'annual window present');
});

test('offers reports a 404 as an outcome, never as an empty success', async () => {
  stub('offers');
  const result = await listOffers(session, { loyaltyId: '000000000' });

  // This is the whole reason the endpoint move went unnoticed elsewhere: an
  // empty array and a dead route must not look the same.
  assert.equal(result.outcome, 'none');
  assert.deepEqual(result.offers, []);
});

test('free play is parsed out of perk codes and names', () => {
  assert.equal(freePlayFrom([{ perkCode: 'FP100', perkName: null, type: null }]), 100);
  assert.equal(freePlayFrom([{ perkCode: 'X', perkName: 'Bonus FP $250', type: null }]), 250);
  // Largest wins — that is the figure Royal advertises.
  assert.equal(freePlayFrom([
    { perkCode: 'FP50', perkName: null, type: null },
    { perkCode: 'FP300', perkName: null, type: null },
  ]), 300);
  assert.equal(freePlayFrom([{ perkCode: 'DRINKS', perkName: 'Drink package', type: null }]), null);
});

test('rooms map through sailings[].rooms[].subtypes[]', async () => {
  stub('rooms');
  const rooms = await fetchRooms({ packageCode: 'X', sailDate: '2026-11-14' });

  assert.ok(rooms.length > 0, 'the response nests cabins three levels deep');
  for (const room of rooms) {
    assert.ok(room.categoryCode, 'every cabin needs an identity');
    assert.ok(room.type, 'group code maps to a cabin class');
  }
  assert.ok(rooms.some((r) => r.type === 'BALCONY'), 'BALCONY group recognised');
  assert.ok(rooms.some((r) => r.type === 'SUITE'), 'DELUXE maps to SUITE');
});

test('room prices keep per-person and cabin totals apart', async () => {
  stub('rooms');
  const rooms = await fetchRooms({ packageCode: 'X', sailDate: '2026-11-14', adults: 2 });
  const priced = rooms.filter((r) => r.allIn !== null && r.perPerson !== null);

  assert.ok(priced.length > 0);
  for (const room of priced) {
    // On this endpoint `amount` is per person and `total` is the cabin — the
    // reverse of the room-selection page, so mixing them is a factor-of-N bug.
    assert.ok(room.allIn! >= room.perPerson!, `${room.categoryCode}: total must not be below per-person`);
  }
});

test('roomKey distinguishes guarantee cabins and folds identical codes', () => {
  assert.equal(roomKey({ categoryCode: 'XQ', subtypeCode: 'XQ', guarantee: true }), 'XQ-GTY');
  assert.equal(roomKey({ categoryCode: 'XQ', subtypeCode: 'XQ', guarantee: false }), 'XQ');
  assert.equal(roomKey({ categoryCode: 'D3', subtypeCode: 'D1', guarantee: false }), 'D3:D1');
});

test('products read the real price field, not the list price', async () => {
  stub('products-beverage');
  const products = await fetchCategory(session, {
    shipCode: 'LE', startDate: '2026-11-14', endDate: '2026-11-28',
  }, 'beverage');

  assert.ok(products.length > 0);
  const deluxe = products.find((p) => /Deluxe Beverage/i.test(p.title ?? ''));
  assert.ok(deluxe, 'the drinks catalogue should contain the deluxe package');

  // lowestAdultPrice is what you pay; msrpAdultPrice is the struck-through one.
  assert.equal(deluxe.price, 91.99);
  assert.equal(deluxe.msrp, 115);
  assert.ok(deluxe.price! < deluxe.msrp!, 'price must be the discounted figure');
});

test('bookings come from the plain endpoint, which the enriched one can miss', async () => {
  // The link record is what actually lists a reservation; `enriched` returned an
  // empty array for this very account while the plain path returned the booking.
  stub('bookings');
  const bookings = await listBookings(session, { linksOnly: true });

  assert.ok(bookings.length > 0, 'the plain endpoint lists the reservation');
  const booking = bookings[0];
  assert.ok(booking.bookingId, 'a reservation number is the point of this call');
  assert.equal(booking.enriched, false);

  // The link's own ship and date are placeholders — a 2026 booking reports ship
  // "NC" sailing in 2039 — so they must never be surfaced as real.
  assert.equal(booking.shipCode, null);
  assert.equal(booking.sailDate, null);
});
