import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAccount, loyaltyIdFor, type RcAccount } from '../src/domains/account.ts';
import type { RcSession } from '../src/auth/index.ts';

/**
 * Task 5: the account's five loyalty programmes.
 *
 * `account-all-brands.json` (Task 1's live capture) carries Crown & Anchor,
 * Club Royale, Captain's Club, Blue Chip and Venetian Society all at once —
 * this is the trap the two-brand version of `fetchAccount` used to miss.
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

/** Serve an arbitrary `loyaltyInformation` object, wrapped like the real envelope. */
function stubLoyalty(loyalty: Record<string, unknown>) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 200, errors: [], payload: { loyaltyInformation: loyalty } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

test('Captain\'s Club maps tier, next tier and both point totals', async () => {
  stub('account-all-brands');
  const account = await fetchAccount(session);

  assert.equal(account.captainsClubTier, 'SELECT');
  assert.equal(account.captainsClubNextTier, 'ELITE');
  assert.equal(account.captainsClubPoints, 0);
  assert.equal(account.captainsClubRelationshipPoints, 0);
  assert.equal(account.captainsClubRemainingPoints, 300);
});

test('Blue Chip surfaces points only — no id or tier field exists on the account', async () => {
  stub('account-all-brands');
  const account = await fetchAccount(session);

  assert.equal(account.blueChipPoints, 0);
  assert.equal(account.blueChipRelationshipPoints, 0);
  assert.ok(!('blueChipId' in account), 'Royal exposes no Blue Chip id');
  assert.ok(!('blueChipTier' in account), 'Royal exposes no Blue Chip tier');
});

test('Venetian Society maps despite its inconsistent key names', async () => {
  stub('account-all-brands');
  const account = await fetchAccount(session);

  // venetianSocietyIndividualPoints / venetianSocietyRelationshipPoints lack
  // the `Loyalty` infix that every other programme's point keys carry, while
  // venetianSocietyLoyaltyTier keeps it. Both are read correctly here.
  assert.equal(account.venetianSocietyTier, '50 VS Days');
  assert.equal(account.venetianSocietyNextTier, '100 VS Days');
  assert.equal(account.venetianSocietyPoints, 0);
  assert.equal(account.venetianSocietyRelationshipPoints, 0);
  assert.ok(account.venetianSocietyId, 'Venetian Society id is present in the fixture');
});

test('a "NONE" tier or next-tier becomes null for the new fields too', async () => {
  stubLoyalty({
    captainsClubId: '123',
    captainsClubLoyaltyTier: 'NONE',
    captainsClubNextTier: 'NONE',
    captainsClubRemainingPoints: null,
    venetianSocietyId: '456',
    venetianSocietyLoyaltyTier: 'NONE',
    venetianSocietyNextTier: 'NONE',
  });
  const account = await fetchAccount(session);

  assert.equal(account.captainsClubTier, null);
  assert.equal(account.captainsClubNextTier, null);
  assert.equal(account.captainsClubRemainingPoints, null);
  assert.equal(account.venetianSocietyTier, null);
  assert.equal(account.venetianSocietyNextTier, null);
});

test('a missing programme yields zeroed points and null ids, never a throw', async () => {
  stubLoyalty({});
  const account = await fetchAccount(session);

  assert.equal(account.captainsClubId, null);
  assert.equal(account.venetianSocietyId, null);
  assert.equal(account.blueChipPoints, 0);
  assert.equal(account.blueChipRelationshipPoints, 0);
  assert.equal(account.venetianSocietyPoints, 0);
  assert.equal(account.captainsClubRemainingPoints, null);
});

test('loyaltyIdFor returns the Crown & Anchor number for R and Captain\'s Club for C', () => {
  const account: RcAccount = {
    accountId: 'a', consumerId: null, email: null, firstName: null, lastName: null,
    crownAndAnchorId: 'CA-1', crownAndAnchorTier: null, crownAndAnchorPoints: 0, crownAndAnchorRelationshipPoints: 0,
    clubRoyaleTier: null, clubRoyalePoints: 0, clubRoyaleRelationshipPoints: 0,
    captainsClubId: 'CC-1', captainsClubTier: null, captainsClubNextTier: null,
    captainsClubPoints: 0, captainsClubRelationshipPoints: 0, captainsClubRemainingPoints: null,
    blueChipPoints: 0, blueChipRelationshipPoints: 0,
    venetianSocietyId: null, venetianSocietyTier: null, venetianSocietyNextTier: null,
    venetianSocietyPoints: 0, venetianSocietyRelationshipPoints: 0,
    raw: null,
  };

  assert.equal(loyaltyIdFor(account, 'R'), 'CA-1');
  assert.equal(loyaltyIdFor(account, 'C'), 'CC-1');
});

test('loyaltyIdFor returns null rather than throwing when the account has no id for that brand', () => {
  const account: RcAccount = {
    accountId: 'a', consumerId: null, email: null, firstName: null, lastName: null,
    crownAndAnchorId: null, crownAndAnchorTier: null, crownAndAnchorPoints: 0, crownAndAnchorRelationshipPoints: 0,
    clubRoyaleTier: null, clubRoyalePoints: 0, clubRoyaleRelationshipPoints: 0,
    captainsClubId: null, captainsClubTier: null, captainsClubNextTier: null,
    captainsClubPoints: 0, captainsClubRelationshipPoints: 0, captainsClubRemainingPoints: null,
    blueChipPoints: 0, blueChipRelationshipPoints: 0,
    venetianSocietyId: null, venetianSocietyTier: null, venetianSocietyNextTier: null,
    venetianSocietyPoints: 0, venetianSocietyRelationshipPoints: 0,
    raw: null,
  };

  assert.equal(loyaltyIdFor(account, 'R'), null);
  assert.equal(loyaltyIdFor(account, 'C'), null);
});
