import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPromo, parseCatalogueCruise } from '../src/domains/catalogue.ts';

/** Shaped like a live cruiseSearch cruise; field names per the search-fields spike. */
const cruise = {
  masterSailing: { itinerary: {
    code: 'HM07GAL', name: '7 Night Western Caribbean', totalNights: 7,
    departurePort: { code: 'GAL', name: 'Galveston, Texas' },
    destination: { code: 'CARIB', name: 'Caribbean' },
    ship: { code: 'HM', name: 'Harmony of the Seas' },
    days: [
      { number: 1, ports: [{ port: { code: 'GAL', name: 'Galveston, Texas' } }] },
      { number: 2, ports: [{ port: { code: 'CRU', name: 'Cruising' } }] },
      { number: 3, ports: [{ port: { code: 'CZM', name: 'Cozumel, Mexico' } }] },
    ],
  } },
  sailings: [
    { id: 'HM07GAL-2027-03-14', sailDate: '2027-03-14', bookingLink: '/booking?x=1', itinerary: { code: 'HM07GAL' },
      taxesAndFees: { value: 142.5 }, taxesAndFeesIncluded: true,
      stateroomClassPricing: [
        { price: { value: 599, currency: { code: 'USD' } }, stateroomClass: { id: 'INTERIOR' } },
        { price: { value: 749, currency: { code: 'USD' } }, stateroomClass: { id: 'OUTSIDE' } },
        { price: { value: 1197, currency: { code: 'USD' } }, stateroomClass: { id: 'BALCONY' } },
        { price: null, stateroomClass: { id: 'DELUXE' } },
      ],
      bestPromotion: { code: 'sep-fs-5-fall-frenzy', description: '', title: 'Fall Frenzy Sale' } },
    { id: 'HM07GAL-2027-03-21', sailDate: '2027-03-21', itinerary: { code: 'HM07GAL' }, stateroomClassPricing: [], bestPromotion: null },
    { id: 'no-date', sailDate: null, stateroomClassPricing: [] },
  ],
};

test('a cruise parses into ports, destination and its dated sailings', () => {
  const c = parseCatalogueCruise(cruise)!;
  assert.equal(c.ports.itineraryCode, 'HM07GAL');
  assert.equal(c.ports.shipCode, 'HM');
  assert.equal(c.shipName, 'Harmony of the Seas');
  assert.deepEqual(c.destination, { code: 'CARIB', name: 'Caribbean' });
  assert.equal(c.sailings.length, 2, 'a sailing with no date cannot be keyed, so it is dropped');
  assert.equal(c.sailings[0]!.sailDate, '2027-03-14');
  assert.equal(c.sailings[0]!.taxesAndFees, 142.5);
  assert.equal(c.sailings[0]!.taxesIncluded, true);
  assert.equal(c.sailings[1]!.taxesIncluded, null, 'absent is unknown, not false');
});

test("Royal's class ids map onto the four room classes, and an unpriced class is absent rather than zero", () => {
  const s = parseCatalogueCruise(cruise)!.sailings[0]!;
  assert.deepEqual(s.prices, [
    { roomClass: 'INTERIOR', perPerson: 599, currency: 'USD' },
    { roomClass: 'OCEANVIEW', perPerson: 749, currency: 'USD' },
    { roomClass: 'BALCONY', perPerson: 1197, currency: 'USD' },
  ]);
});

test("Royal exposes one 'best' promotion per sailing: its title is the label, and no promotion is an empty list", () => {
  const [first, second] = parseCatalogueCruise(cruise)!.sailings;
  assert.deepEqual(first!.promos, [{ code: 'sep-fs-5-fall-frenzy', label: 'Fall Frenzy Sale', kind: 'other', endsOn: null }]);
  assert.deepEqual(second!.promos, []);
});

test('a cruise with no itinerary code is unusable and parses to null', () => {
  assert.equal(parseCatalogueCruise({ masterSailing: { itinerary: {} }, sailings: [] }), null);
});

test('promo labels classify by what they advertise', () => {
  assert.equal(classifyPromo('Kids Sail Free'), 'kids_free');
  assert.equal(classifyPromo('60% off second guest'), 'pct_off_2nd');
  assert.equal(classifyPromo('2nd Guest 50% Off'), 'pct_off_2nd');
  assert.equal(classifyPromo('Up to $150 Onboard Credit'), 'obc');
  assert.equal(classifyPromo('$200 off your cruise'), 'dollars_off');
  assert.equal(classifyPromo('Summer Event'), 'other');
});

test('the captured live page parses: every cruise has sailings and at least one has a price', () => {
  const page = JSON.parse(fs.readFileSync(new URL('./fixtures/catalogue-page.json', import.meta.url), 'utf8'));
  const cruises = (page.cruises as unknown[]).map(parseCatalogueCruise).filter((c) => c !== null);
  assert.ok(cruises.length > 0);
  assert.ok(cruises.every((c) => c!.sailings.length > 0));
  assert.ok(cruises.some((c) => c!.sailings.some((s) => s.prices.length > 0)), 'no price parsed from live data');
});
