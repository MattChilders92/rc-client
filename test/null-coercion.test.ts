import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchRooms } from '../src/domains/rooms.ts';
import { fetchOfferDetail } from '../src/domains/offers.ts';
import type { RcSession } from '../src/auth/index.ts';

/**
 * A null price or count from Royal must stay `null`, not become `0`.
 *
 * `src/coerce.ts`'s shared `num`/`int` return `null` for a `null` or `''`
 * input. The local helpers they replaced in `rooms.ts` and `offers.ts` used
 * bare `Number(v)`, which coerces both to `0` — so a cabin with no price, or
 * a sailing with no stated night count, used to be reported as costing or
 * lasting nothing. No fixture happened to carry a null in these fields, so
 * that silent behaviour change went unnoticed. These tests pin the corrected
 * behaviour directly against a payload that does carry one.
 */

const session: RcSession = {
  accessToken: 'x',
  accountId: 'y',
  expiresAt: new Date(Date.now() + 60_000),
};

const realFetch = globalThis.fetch;

function stubJson(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

afterEach(() => { globalThis.fetch = realFetch; });

test('a room with a null cabin total maps to allIn: null, not 0', async () => {
  stubJson({
    sailings: [
      {
        rooms: [
          {
            code: 'INTERIOR',
            categoryCode: 'ZI',
            subtypes: [
              {
                code: 'ZI',
                categoryCode: 'ZI',
                isGuarantee: true,
                pricing: { amount: 1649.99, total: null },
              },
              {
                code: 'V4',
                categoryCode: 'V4',
                isGuarantee: false,
                pricing: { amount: 1810.49, total: 3620.987 },
              },
            ],
          },
        ],
      },
    ],
  });

  const rooms = await fetchRooms({ packageCode: 'X', sailDate: '2026-11-14' });
  assert.equal(rooms.length, 2);

  const noPrice = rooms.find((r) => r.categoryCode === 'ZI');
  assert.ok(noPrice, 'the null-total subtype must still map');
  assert.equal(noPrice.allIn, null, 'a null cabin total must stay null, not become 0');

  // A sibling with a real price still maps to its number, rounded to cents.
  const priced = rooms.find((r) => r.categoryCode === 'V4');
  assert.ok(priced);
  assert.equal(priced.allIn, 3620.99);
});

test('an offer sailing with a null totalNights maps to null, not 0', async () => {
  stubJson({
    firstName: null,
    lastName: null,
    loyaltyId: null,
    offers: [
      {
        campaignCode: '26BAF3',
        campaignName: '2026 California Winners',
        playerOfferId: '00000000-0000-0000-0000-000000000001',
        status: 'active',
        campaignOffer: {
          offerCode: '26BAF304',
          tradeInValue: null,
          perkCodes: [],
          sailings: [
            {
              id: 'QN_LAX_2026-09-14',
              shipCode: 'QN',
              shipName: 'Quantum of the Seas',
              departurePort: { code: 'LAX', name: 'Los Angeles' },
              sailDate: '2026-09-14',
              totalNights: null,
              roomTypeList: [],
            },
          ],
        },
      },
    ],
  });

  const detail = await fetchOfferDetail(session, {
    loyaltyId: '000000000',
    offerCode: '26BAF304',
    playerOfferId: '00000000-0000-0000-0000-000000000001',
  });

  assert.ok(detail, 'the route answered with the grant');
  assert.equal(detail.tradeInValue, null, 'a null tradeInValue must stay null, not become 0');
  assert.equal(detail.sailings.length, 1);
  assert.equal(detail.sailings[0]!.totalNights, null, 'a null totalNights must stay null, not become 0');
});
