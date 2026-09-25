import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchVoyage, parseVoyage, voyageId } from '../src/domains/voyage.ts';
import { RcRouteGoneError } from '../src/errors.ts';
import type { RcSession } from '../src/auth/index.ts';

/**
 * Replays the recorded `voyage-enriched` fixture (`GET
 * /v3/ships/voyages/{voyage}/enriched`) through the mapper, plus focused unit
 * tests for the compact-date conversions and the header overrides this
 * endpoint specifically wants.
 *
 * Re-record with `npm run capture` when Royal changes something.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8'));

const session: RcSession = {
  accessToken: 'test-token',
  accountId: '00000000-0000-0000-0000-000000000000',
  vdsId: 'vds-test',
  expiresAt: new Date(Date.now() + 3600_000),
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Serve one fixture to whatever the code under test requests. */
function stub(name: string) {
  const fixture = load(name);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixture.body), {
      status: fixture._status ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

test('fetchVoyage maps the recorded voyage-enriched fixture end to end', async () => {
  stub('voyage-enriched');
  const voyage = await fetchVoyage(session, 'LE20261114');

  assert.equal(voyage.itineraryCode, '08D147');
  assert.equal(voyage.nights, 8);
  assert.equal(voyage.sailDate, '2026-11-14');
  assert.equal(voyage.sailingEndDate, '2026-11-22');
  assert.equal(voyage.itineraryName, '8 Nt Southern Caribbean & Perfect Day');
  assert.equal(voyage.shipCode, 'LE');
  assert.equal(voyage.shipName, 'LEGEND OF THE SEAS');
  assert.equal(voyage.brand, 'R');
  assert.equal(voyage.voyageId, 53027);
  assert.equal(voyage.regionCode, 'CARIB');
  assert.equal(voyage.voyageType, 'REGULAR');
  assert.equal(voyage.canceled, false);
  assert.equal(voyage.charter, false);
  assert.equal(voyage.departurePort, 'FLL');
  assert.equal(voyage.departurePortName, 'Fort Lauderdale, Florida');
  assert.equal(voyage.departurePortCountryCode, 'USA');
  assert.equal(voyage.arrivalPort, 'FLL');
  assert.equal(voyage.arrivalPortName, 'Fort Lauderdale, Florida');
  assert.equal(voyage.arrivalPortCountryCode, 'USA');
});

test('isSailingClosed is surfaced as a real boolean, distinct from "no data"', async () => {
  stub('voyage-enriched');
  const voyage = await fetchVoyage(session, 'LE20261114');
  assert.equal(voyage.isSailingClosed, true);
});

test('all nine ports map in order with their types, days and ISO timestamps', async () => {
  stub('voyage-enriched');
  const voyage = await fetchVoyage(session, 'LE20261114');

  assert.equal(voyage.ports.length, 9);
  assert.deepEqual(
    voyage.ports.map((p) => p.portCode),
    ['FLL', 'CRU', 'CRU', 'CUR', 'AUA', 'CRU', 'CRU', 'PCC', 'FLL'],
  );
  assert.deepEqual(
    voyage.ports.map((p) => p.portType),
    ['EMBARK', 'CRUISING', 'CRUISING', 'DOCKED', 'DOCKED', 'CRUISING', 'CRUISING', 'DOCKED', 'DEBARK'],
  );
  assert.deepEqual(voyage.ports.map((p) => p.day), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const first = voyage.ports[0]!;
  assert.equal(first.arrivalDateTime, '2026-11-14T00:00:00');
  assert.equal(first.departureDateTime, '2026-11-14T16:00:00');
  assert.equal(first.title, 'Fort Lauderdale, Florida');
});

test('parseVoyage converts compact sailing dates to ISO, and a malformed one to null', () => {
  const info = {
    itineraryCode: 'X1',
    sailDate: '20261114',
    sailingEndDate: 'not-a-date',
    itinerary: { portInfo: [] },
  };
  const voyage = parseVoyage(info)!;
  assert.equal(voyage.sailDate, '2026-11-14');
  assert.equal(voyage.sailingEndDate, null);
});

test('parseVoyage converts compact port timestamps to ISO, and a malformed one to null', () => {
  const info = {
    itineraryCode: 'X1',
    itinerary: {
      portInfo: [
        {
          portCode: 'AAA', portType: 'EMBARK', day: 1,
          arrivalDateTime: '20261114T000000', departureDateTime: 'garbage',
        },
      ],
    },
  };
  const voyage = parseVoyage(info)!;
  assert.equal(voyage.ports[0]!.arrivalDateTime, '2026-11-14T00:00:00');
  assert.equal(voyage.ports[0]!.departureDateTime, null);
});

test('parseVoyage returns null without an itinerary code, rather than a half-mapped voyage', () => {
  assert.equal(parseVoyage({}), null);
  assert.equal(parseVoyage(null), null);
  assert.equal(parseVoyage({ itineraryCode: '' }), null);
});

test('voyageId builds the compact ship+date id fetchVoyage takes', () => {
  assert.equal(voyageId('LE', '2026-11-14'), 'LE20261114');
});

test('fetchVoyage builds the voyage id from { shipCode, sailDate } and calls the enriched route', async () => {
  let seenUrl = '';
  globalThis.fetch = (async (url: unknown) => {
    seenUrl = String(url);
    const fixture = load('voyage-enriched');
    return new Response(JSON.stringify(fixture.body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  await fetchVoyage(session, { shipCode: 'LE', sailDate: '2026-11-14' });
  assert.match(seenUrl, /\/ships\/voyages\/LE20261114\/enriched$/);
});

test('fetchVoyage overrides req-app-id/req-app-vers and sends vds-id when the session has one', async () => {
  let seenHeaders: Headers | undefined;
  globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
    seenHeaders = new Headers(init?.headers);
    const fixture = load('voyage-enriched');
    return new Response(JSON.stringify(fixture.body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  await fetchVoyage(session, 'LE20261114');
  assert.equal(seenHeaders?.get('req-app-id'), 'Royal.Web.CustomerJourney');
  assert.equal(seenHeaders?.get('req-app-vers'), '1.5.1');
  assert.equal(seenHeaders?.get('vds-id'), 'vds-test');
});

test('fetchVoyage omits vds-id when the session carries none', async () => {
  let seenHeaders: Headers | undefined;
  globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
    seenHeaders = new Headers(init?.headers);
    const fixture = load('voyage-enriched');
    return new Response(JSON.stringify(fixture.body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const noVds: RcSession = { ...session, vdsId: undefined };
  await fetchVoyage(noVds, 'LE20261114');
  assert.equal(seenHeaders?.has('vds-id'), false);
});

test('a 404 for an unknown voyage surfaces as RcRouteGoneError, not an empty object', async () => {
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
  await assert.rejects(() => fetchVoyage(session, 'XX00000000'), RcRouteGoneError);
});
