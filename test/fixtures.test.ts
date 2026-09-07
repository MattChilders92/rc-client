import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAccount } from '../src/domains/account.ts';
import { fetchCasinoLoyalty } from '../src/domains/casino.ts';
import { listOffers, fetchOfferDetail, freePlayFrom } from '../src/domains/offers.ts';
import { fetchRooms, roomKey } from '../src/domains/rooms.ts';
import { fetchCategory } from '../src/domains/products.ts';
import { listBookings } from '../src/domains/bookings.ts';
import { RcRouteGoneError } from '../src/errors.ts';
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

test('offers are mapped out of the campaignOffer envelope', async () => {
  stub('offers');
  const result = await listOffers(session, { loyaltyId: '000000000' });

  assert.equal(result.outcome, 'ok');
  assert.equal(result.offers.length, 4);

  const offer = result.offers[0]!;
  assert.equal(offer.offerCode, '26BAF304');
  assert.equal(offer.campaignCode, '26BAF3');
  assert.equal(offer.campaignName, '2026 California Winners');
  assert.equal(offer.offerType?.code, 'COMP');
  // The variant is the offer code with the campaign code removed. It is a
  // per-campaign marketing label, not the Club Royale tier -- the two are not 1:1.
  assert.equal(offer.variant, '04');
  assert.equal(offer.bookBy, '2026-09-08');
  assert.ok(offer.description, 'description is what the dashboard actually shows');
});

test('free play comes from the perk name, since the code is opaque', async () => {
  stub('offers');
  const { offers } = await listOffers(session, { loyaltyId: '000000000' });

  // The live perk is { perkCode: 'TBB8', perkName: 'Bonus FP $100' }. Reading
  // the code alone — as an FP<n> pattern would — yields nothing.
  const withPerk = offers.find((o) => o.perks.length > 0);
  assert.ok(withPerk, 'the fixture must keep an offer that carries a perk');
  assert.equal(withPerk.freePlay, 100);
});

test('a repeated offer code is several redeemable grants, not one offer', async () => {
  stub('offers');
  const { offers } = await listOffers(session, { loyaltyId: '000000000' });

  // Royal issues the same offer repeatedly. Each copy is separately
  // redeemable and differs only by playerOfferId, so that is the identity of a
  // row -- keying on the offer code both undercounts what the player holds and
  // makes the rows impossible to upsert.
  const codes = offers.map((o) => o.offerCode);
  assert.ok(codes.length > new Set(codes).size, 'fixture must keep the repeat');

  const repeated = codes.find((c, i) => codes.indexOf(c) !== i);
  const grants = offers.filter((o) => o.offerCode === repeated);
  const ids = new Set(grants.map((g) => g.playerOfferId));
  assert.equal(ids.size, grants.length, 'each grant carries its own playerOfferId');
});

test('offer details returns the grant with its sailings populated', async () => {
  stub('offer-details');
  const detail = await fetchOfferDetail(session, {
    loyaltyId: '000000000', offerCode: '26BAF304', playerOfferId: '00000000-0000-0000-0000-000000000001',
  });
  assert.ok(detail, 'the route answered with the grant');
  assert.equal(detail.offerCode, '26BAF304');
  // The list endpoint never fills sailings; this one is the whole point.
  assert.ok(detail.sailings.length >= 3, 'sailings are populated');

  const s = detail.sailings[0]!;
  assert.equal(s.shipCode, 'QN');
  assert.equal(s.shipName, 'Quantum of the Seas');
  assert.equal(s.departurePort?.code, 'LAX');
  assert.equal(s.sailDate, '2026-09-14');
  assert.equal(s.totalNights, 3);
  assert.equal(s.groupId, 'QN03LAX-000000000');
  // Eligible room categories are the search surface a browser filters on.
  assert.deepEqual(s.roomTypes.map((r) => r.code), ['BALCONY', 'INTERIORGTY']);
  assert.equal(s.isGuarantee, true);
  assert.equal(s.isComplimentary, true);
  assert.equal(s.isBogo, false);
  assert.equal(s.dollarsOff, null);
});

test('offer details carries the fields only the detail exposes', async () => {
  stub('offer-details');
  const detail = await fetchOfferDetail(session, {
    loyaltyId: '000000000', offerCode: '26BAF304', playerOfferId: '00000000-0000-0000-0000-000000000001',
  });
  assert.ok(detail);
  // startDate / sailByDate / roomCount are absent from the list envelope.
  assert.ok('sailByDate' in detail && 'roomCount' in detail && 'tags' in detail);
  assert.ok(Array.isArray(detail.tags));
});

test('a moved route throws instead of reporting an empty account', async () => {
  stub('offers-route-gone');

  // The endpoint has now moved twice. Both times, clients that treated the
  // resulting 404 as "no offers" reported zero for accounts that had plenty —
  // this project included, for a week. The router's own NOT_FOUND body is the
  // tell, and it must never be mistaken for an answer about the player.
  await assert.rejects(
    () => listOffers(session, { loyaltyId: '000000000' }),
    RcRouteGoneError,
  );
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
