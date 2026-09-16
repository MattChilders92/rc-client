import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItineraryPorts } from '../src/domains/search.ts';

/** Transcribed from a live cruiseSearch response. */
const cruise = {
  masterSailing: {
    itinerary: {
      code: 'LA04CAT',
      name: 'Catalina & Ensenada Cruise',
      totalNights: 4,
      departurePort: { code: 'LAX', name: 'Los Angeles', countryCode: 'US' },
      ship: { code: 'NV', name: 'Navigator of the Seas' },
      days: [
        { number: 1, ports: [{ port: { code: 'LAX', name: 'Los Angeles' } }] },
        { number: 2, ports: [{ port: { code: 'CRU', name: 'Cruising' } }] },
        { number: 3, ports: [{ port: { code: 'CAT', name: 'Catalina Island' } }] },
        { number: 4, ports: [{ port: { code: 'ESE', name: 'Ensenada' } }] },
        { number: 5, ports: [{ port: { code: 'LAX', name: 'Los Angeles' } }] },
      ],
    },
  },
  sailings: [
    { sailDate: '2027-01-08', itinerary: { code: 'LA04CAT' } },
    { sailDate: '2027-01-15', itinerary: { code: 'LA04CAT' } },
  ],
};

test('an itinerary parses into its days, ports and sail dates', () => {
  const it = parseItineraryPorts(cruise)!;
  assert.equal(it.itineraryCode, 'LA04CAT');
  assert.equal(it.itineraryName, 'Catalina & Ensenada Cruise');
  assert.equal(it.nights, 4);
  assert.equal(it.shipCode, 'NV');
  assert.deepEqual(it.departurePort, { code: 'LAX', name: 'Los Angeles' });
  assert.deepEqual(it.sailDates, ['2027-01-08', '2027-01-15']);
});

test('the CRU sea-day sentinel is not a port', () => {
  const it = parseItineraryPorts(cruise)!;
  const codes = it.days.flatMap((d) => d.ports.map((p) => p.code));
  assert.ok(!codes.includes('CRU'), 'CRU must be dropped');
  assert.deepEqual(codes, ['LAX', 'CAT', 'ESE', 'LAX']);
});

test('a sea day survives as a day with no ports, so day numbering stays intact', () => {
  const it = parseItineraryPorts(cruise)!;
  assert.equal(it.days.length, 5);
  assert.deepEqual(it.days.map((d) => d.day), [1, 2, 3, 4, 5]);
  assert.deepEqual(it.days[1]!.ports, []);
});

test('a cruise with no itinerary code is skipped rather than half-parsed', () => {
  assert.equal(parseItineraryPorts({ masterSailing: { itinerary: { name: 'x' } } }), null);
  assert.equal(parseItineraryPorts({}), null);
  assert.equal(parseItineraryPorts(null), null);
});

test('missing or malformed days and sailings degrade to empty arrays', () => {
  const bare = parseItineraryPorts({ masterSailing: { itinerary: { code: 'X1' } } })!;
  assert.equal(bare.itineraryCode, 'X1');
  assert.deepEqual(bare.days, []);
  assert.deepEqual(bare.sailDates, []);
  assert.equal(bare.departurePort, null);
  assert.equal(bare.nights, null);
});

test('a day whose ports array holds a null port does not throw', () => {
  const odd = parseItineraryPorts({
    masterSailing: { itinerary: { code: 'X2', days: [{ number: 1, ports: [{ port: null }, { }] }] } },
  })!;
  assert.deepEqual(odd.days, [{ day: 1, ports: [] }]);
});
