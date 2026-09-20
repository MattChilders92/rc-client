# rc-client Celebrity Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caller picks a brand once and every call with a brand dimension follows, with a typed error instead of a 401 when host and loyalty number disagree.

**Architecture:** A new `src/brand.ts` holds `Brand = 'R' | 'C'` and `brandHost()`, replacing the old `'RC' | 'CEL'`. Search, rooms, offers and casino loyalty take a brand and derive their host from it. Sign-in, account, products and certificates stay brand-free, each verified to work for both brands unchanged. `RcClient` carries a brand and resolves the matching loyalty number from the account.

**Tech Stack:** Node native TypeScript, zero runtime dependencies, `node:test`.

## Global Constraints

- **Zero runtime dependencies.** No `node:` import anywhere under `src/` — it must run wherever `fetch` does. Tests and `scripts/` may use `node:`.
- Explicit `.ts` import extensions, `erasableSyntaxOnly` (no enums, no parameter properties), `verbatimModuleSyntax` (type-only imports say `type`).
- **`Brand` changing from `'RC' | 'CEL'` to `'R' | 'C'` is the one intended breaking change.** Everything else keeps its name and signature, and every new parameter is optional and last. The sole consumer, CruiseWatch, never imports `Brand` and never passes `brand` — verified — so nothing there should need editing. If you find it does, stop and report.
- `npm test` must end `fail 0` (72 now). `npx tsc --noEmit` must be clean.
- Three gates must keep passing and must not be weakened: `test/exports-documented.test.ts` (a JSDoc counts only when it ends on the line directly above the declaration), `test/fixtures-redacted.test.ts`, `test/packaging.test.ts` (slow; `RC_SKIP_PACKAGING=1 npm test` skips it while iterating, but run the full suite before your final commit).
- **Never print, log, or write a credential.** Where a task needs a live call, credentials come from CruiseWatch's vault exactly as Task 1 shows. Never print a password, an access token, or a full loyalty number.
- **Never edit a fixture by hand to make a test pass.** If the redaction gate flags something, report its path and shape, not its value.
- Do not publish, do not push.
- Commit messages end with exactly: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Branch `feat/celebrity` off `master`, already checked out at `02273da`.
- This repo's editor/LSP diagnostics are frequently stale and report phantom errors — trust `npx tsc --noEmit` and `npm test`, never squiggles.

## Verified facts this plan rests on

Measured live against the owner's account before planning. Do not re-derive; do not contradict without evidence.

| Fact | Detail |
| --- | --- |
| Celebrity search | `celebritycruises.com/graph`, header `brand: C`, works anonymously |
| Celebrity rooms | `celebritycruises.com/itinerary/api/v1` — the URL already in `rooms.ts` — works |
| Celebrity offers | Celebrity host + **Captain's Club** number → 200, `0 offers` for this account |
| Wrong number for the host | **401 `Unauthorized - invalid loyalty id`**, both directions |
| Royal offers | unchanged, 9 offers |
| Products for a Celebrity ship | unchanged, 39 products, 0 failed categories |
| Sign-in and account | brand-agnostic; the Royal path returns every brand's loyalty |
| Blue Chip fields | `celebrityBlueChipLoyaltyIndividualPoints`, `...RelationshipPoints` — **points only, no id, no tier** |
| Venetian Society (Silversea) | `venetianSocietyId`, `venetianSocietyLoyaltyTier`, `venetianSocietyNextTier`, `venetianSocietyIndividualPoints`, `venetianSocietyRelationshipPoints`, `venetianSocietyRemainingPoints` |
| Captain's Club extras | `captainsClubNextTier`, `captainsClubRemainingPoints`, `captainsClubTrackerPercentage`, `captainsClubLoyaltyIndividualPoints`, `captainsClubLoyaltyRelationshipPoints` |
| Package-code trap | search gives itinerary `RF4BH330`; its sailing id is `RF4BH328_2026-11-16`; pricing 404s on the itinerary code, 200s on the package code |

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/brand.ts` (create) | `Brand`, `BRANDS`, `BRAND_NAMES`, `brandHost()` |
| `src/domains/rooms.ts` (modify) | Use the shared `Brand`; drop the local type and `BASE` map |
| `src/domains/search.ts` (modify) | Brand-aware host and `brand` header; `packageCode` on sailings |
| `src/domains/offers.ts` (modify) | Brand-aware host; 401 translated |
| `src/domains/casino.ts` (modify) | Brand-aware host |
| `src/domains/bookings.ts` (modify) | Import the shared `Brand` instead of its own literal union |
| `src/domains/account.ts` (modify) | Captain's Club, Blue Chip, Venetian Society; `loyaltyIdFor` |
| `src/client.ts` (modify) | `brand` option; resolve the loyalty number; pass brand down |
| `src/index.ts` (modify) | Export the brand module |
| `test/brand.test.ts`, `test/celebrity.test.ts` (create) | Unit coverage |
| `scripts/capture-celebrity.ts` (create, temporary) | Capture and redact the new fixtures |
| `README.md`, `CHANGELOG.md`, `docs/endpoints.md`, `docs/design.md` (modify) | Document it |

---

## Task 1: Capture the Celebrity fixtures

Do this first: later tasks assert against these, and capturing needs a live session that only this task performs.

**Files:**
- Create then delete: `scripts/capture-celebrity.ts`
- Create: `test/fixtures/celebrity-search.json`, `celebrity-rooms.json`, `celebrity-offers-empty.json`, `account-all-brands.json`

**Interfaces:** none. Data only.

**Background:** fixtures are committed, so everything identifying is scrubbed on the way in. `scripts/redaction.ts` exports `REDACT_KEYS`, and `scripts/capture.ts` already implements the scrubbing — **read it and reuse its `redact()` and surrogate logic rather than writing new scrubbing.** The committed gate `test/fixtures-redacted.test.ts` will fail the build if anything slips.

- [ ] **Step 1: Write the capture script**

Model it on `scripts/capture.ts`. Credentials come from CruiseWatch's vault, never from a prompt and never printed:

```ts
// scripts/capture-celebrity.ts — run once, then deleted.
// Credentials are read from CruiseWatch's Supabase vault and never printed.
const CW = 'C:/Users/colos/source/repos/CruiseWatch';
const { loadEnv } = await import(`${CW}/src/config.ts`);
const { Rest } = await import(`${CW}/src/store/rest.ts`);
const env = loadEnv();
const rest = new Rest(env.supabaseUrl, env.serviceKey);
const [acct] = await rest.get('rc_account?select=username,secret_id&limit=1');
const password = await rest.readSecret(acct.secret_id);
const session = await signIn({ username: acct.username, password });
```

Capture four payloads, writing each **through the same redaction** `scripts/capture.ts` applies:

1. `celebrity-search.json` — the anonymous Celebrity cruise search. Use the query already in `src/domains/search.ts`, against `celebritycruises.com/graph` with the `brand: C` header, `count: 5`. **It must include `sailings { id sailDate itinerary { code } }`**, because a later task asserts the package-code trap on it. Verify before saving that at least one cruise has a sailing id whose prefix differs from its master itinerary code; if none does, widen to `count: 40` and pick a page that has one. If you still cannot find one, **stop and report** — the trap may not reproduce and Task 4 needs to know.
2. `celebrity-rooms.json` — Celebrity room pricing. Take a real package code from the search capture's `sailings[].id` prefix with its matching date. Trim to at most 4 cabins to keep the file small.
3. `celebrity-offers-empty.json` — `GET /api/casino/v2/offers/list` on the **Celebrity** host with the **Captain's Club** number, the same query `src/domains/offers.ts` builds. This is expected to be an empty list; that is the point.
4. `account-all-brands.json` — the guest-account payload, which carries all five programmes. Redaction will replace the ids; keep the tiers and point totals, which is what tests assert on.

- [ ] **Step 2: Run it, then verify the gate**

Run: `cd C:\Users\colos\source\repos\rc-client && node --disable-warning=ExperimentalWarning scripts/capture-celebrity.ts`

Then: `RC_SKIP_PACKAGING=1 npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"` — `fail 0`. The redaction gate runs over every fixture including your four new ones.

Confirm by eye that no fixture contains a loyalty number, a token, or an email outside `example.com`. If the gate passes but you see something identifying under a key the list does not cover, **add the key to `scripts/redaction.ts`, re-capture, and say so in your report** — do not hand-edit.

- [ ] **Step 3: Delete the script and commit**

```bash
cd C:\Users\colos\source\repos\rc-client
rm -f scripts/capture-celebrity.ts
git add test/fixtures scripts/redaction.ts
git commit -m "test(fixtures): record Celebrity search, rooms, empty offers and a five-programme account

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Report the four files' sizes, the package code and date used for rooms, whether the search capture contains a sailing whose package code differs from its itinerary code (quote both), and the offer count in the empty capture.

---

## Task 2: The brand module

**Files:**
- Create: `src/brand.ts`
- Modify: `src/domains/rooms.ts`, `src/domains/bookings.ts`, `src/index.ts`
- Test: `test/brand.test.ts`

**Interfaces:**
- Produces: `type Brand = 'R' | 'C'`; `const BRANDS: readonly Brand[]`; `const BRAND_NAMES: Record<Brand, string>`; `function brandHost(brand: Brand): string`.
- `rooms.ts` stops exporting its own `Brand` and imports this one. `RoomQuery.brand` becomes the new type.
- `bookings.ts`'s `ListBookingsOptions.brand` changes from the inline `'R' | 'C'` to the imported `Brand` — same values, so no behaviour change.

- [ ] **Step 1: Write the failing test**

Create `test/brand.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { brandHost, BRANDS, BRAND_NAMES, type Brand } from '../src/brand.ts';

test('each brand maps to its own consumer site', () => {
  assert.equal(brandHost('R'), 'www.royalcaribbean.com');
  assert.equal(brandHost('C'), 'www.celebritycruises.com');
});

test('every brand has a host and a name, and there are no others', () => {
  assert.deepEqual([...BRANDS], ['R', 'C']);
  for (const b of BRANDS) {
    assert.ok(brandHost(b).endsWith('.com'), `${b} has a host`);
    assert.ok(BRAND_NAMES[b].length > 0, `${b} has a name`);
  }
});

test('the host is bare — no scheme, no trailing slash — so callers compose it', () => {
  for (const b of BRANDS) {
    assert.doesNotMatch(brandHost(b), /^https?:|\/$/);
  }
});

test('an unknown brand is rejected rather than silently treated as Royal', () => {
  assert.throws(() => brandHost('X' as Brand), /brand/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `RC_SKIP_PACKAGING=1 npm test 2>&1 | grep -aE "Cannot find|not ok" | head -3`
Expected: `Cannot find module '../src/brand.ts'`.

- [ ] **Step 3: Create `src/brand.ts`**

```typescript
/**
 * The two brands this library speaks to, spelled as their own APIs spell them.
 *
 * `R` and `C` are what the wire carries — the cruise-search `brand` header, the
 * bookings query parameter — so they are what the library uses, rather than a
 * third spelling that would need translating at every call site.
 *
 * Brand is a *host* decision, not a path one: each brand's anonymous and casino
 * APIs live on its own consumer site, while sign-in, the guest account and the
 * product catalogue are shared and are reached through Royal's host for both.
 */

/** `R` Royal Caribbean, `C` Celebrity Cruises. */
export type Brand = 'R' | 'C';

/** Every brand, for callers that need to iterate them. */
export const BRANDS: readonly Brand[] = ['R', 'C'];

/** Display names, for a caller building a label. */
export const BRAND_NAMES: Record<Brand, string> = {
  R: 'Royal Caribbean',
  C: 'Celebrity Cruises',
};

const HOSTS: Record<Brand, string> = {
  R: 'www.royalcaribbean.com',
  C: 'www.celebritycruises.com',
};

/**
 * The consumer site a brand's anonymous and casino APIs are served from, bare —
 * no scheme, no trailing slash — because callers compose it into paths.
 *
 * Throws rather than defaulting, so a bad brand surfaces here instead of as a
 * 404 from whichever site the default happened to be.
 */
export function brandHost(brand: Brand): string {
  const host = HOSTS[brand];
  if (!host) throw new TypeError(`Unknown brand: ${String(brand)}`);
  return host;
}
```

- [ ] **Step 4: Repoint `rooms.ts` and `bookings.ts`**

In `rooms.ts`: delete the local `export type Brand = 'RC' | 'CEL'` and the `BASE: Record<Brand, string>` map; `import { brandHost, type Brand } from '../brand.ts';` and build the base as `` `https://${brandHost(q.brand ?? 'R')}/itinerary/api/v1` ``. Update `RoomQuery.brand`'s JSDoc to say `R` or `C`, defaulting to `R`.

In `bookings.ts`: import `Brand` and use it for `ListBookingsOptions.brand`, deleting the inline union. Its default and query parameter are unchanged.

In `src/index.ts`: export `brandHost`, `BRANDS`, `BRAND_NAMES` and `type Brand` from `./brand.ts`, and **remove `type Brand` from the `rooms.ts` export line** so the name is exported exactly once. `src/client.ts` re-exports `Brand` at its foot — repoint that import too.

- [ ] **Step 5: Verify**

Run: `RC_SKIP_PACKAGING=1 npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"` → `fail 0`, total up by 4.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.
Run: `git grep -n "'RC'\|'CEL'" -- src` → nothing.

- [ ] **Step 6: Commit**

```bash
git add src/brand.ts src/domains/rooms.ts src/domains/bookings.ts src/index.ts src/client.ts test/brand.test.ts
git commit -m "feat!: one Brand type, spelled R and C as the APIs spell it

Replaces rooms.ts's RC/CEL, which only room pricing read, and bookings.ts's
separate inline union. Breaking for anyone importing Brand.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Brand-aware search, rooms and casino loyalty

**Files:**
- Modify: `src/domains/search.ts`, `src/domains/casino.ts`
- Test: `test/celebrity.test.ts` (create)

**Interfaces:**
- `SearchParams` gains `brand?: Brand` (default `'R'`). `fetchItineraryPorts`'s options object gains the same.
- `fetchCasinoLoyalty(session, brand?: Brand, config?)` — brand inserted **before** the existing trailing `config`, which is safe only because no caller passes `config` positionally today. **Verify that claim with `git grep -n "fetchCasinoLoyalty"` across `src/`, `scripts/`, `test/` and CruiseWatch before relying on it**; if any caller passes a second argument, put `brand` on an options object instead and say so in your report.
- `fetchRooms` / `sweepOccupancy` need no signature change — `RoomQuery.brand` already carries it.

**Background:** `search.ts` has a private `headers(config)` that hardcodes `brand: 'R'`, and a module-level `URL_` pointing at Royal's graph. Both become brand-derived. `casino.ts` has `URL_ = 'https://www.royalcaribbean.com/api/casino/v1/loyalty-data'`.

- [ ] **Step 1: Write the failing tests**

Create `test/celebrity.test.ts`. Stub `globalThis.fetch`, restore it in `afterEach`, and assert on the URL and headers the library *sends* — no network:

```typescript
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
  await fetchCasinoLoyalty(session, 'C');
  assert.match(seen[0]!.url, /celebritycruises\.com\/api\/casino\/v1\/loyalty-data/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `RC_SKIP_PACKAGING=1 npm test 2>&1 | grep -acE "not ok|✖"` — several failures, all about the Royal host being used.

- [ ] **Step 3: Implement**

`search.ts`: make `headers(config, brand)` take the brand and emit it; replace `URL_` with a function of the brand, `` `https://${brandHost(brand)}/graph` ``. Both `searchCruises` and `fetchItineraryPorts` read `brand` from their own options, defaulting to `'R'`, and pass it to both. Keep the `RcShapeError` guard for a non-object body and the `RcRequestError` for GraphQL errors; both now name the brand's URL.

`casino.ts`: same treatment for `URL_`.

Document `brand` on `SearchParams` and on `fetchItineraryPorts`'s options with a sentence that says it selects both the host and the header.

- [ ] **Step 4: Verify**

Run: `RC_SKIP_PACKAGING=1 npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"` → `fail 0`, total up by 5.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.

- [ ] **Step 5: Commit**

```bash
git add src/domains/search.ts src/domains/casino.ts test/celebrity.test.ts
git commit -m "feat: search, rooms and casino loyalty follow the brand

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The package-code trap

**Files:**
- Modify: `src/domains/search.ts`
- Test: extend `test/celebrity.test.ts`

**Interfaces:** `RcSailingSummary` gains `packageCode: string | null`. `sailingId` keeps its meaning and name.

**Background:** a sailing id is `<packageCode>_<YYYY-MM-DD>`. For Royal the package code equals the master itinerary code, so nobody noticed; for Celebrity it can differ — verified live: itinerary `RF4BH330`, sailing id `RF4BH328_2026-11-16`, and room pricing **404s on `RF4BH330` and 200s on `RF4BH328`**. Anyone going from a search result to a price needs the package code, and today the library only offers the itinerary code.

- [ ] **Step 1: Write the failing tests**

Append to `test/celebrity.test.ts`. Use the real recorded fixture from Task 1 so the assertion is anchored in a captured response, not an invention:

```typescript
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
```

Also add one test that reads `test/fixtures/celebrity-search.json` from Task 1 and asserts at least one sailing there has a `packageCode` differing from its `itineraryCode` — the recorded proof the trap is real. If Task 1 reported it could not find such a sailing, skip this test with a comment naming that.

- [ ] **Step 2: Run, watch fail, implement**

Parse the prefix before the **last** `_` only if what follows is a `YYYY-MM-DD`; otherwise `null`. A code containing an underscore would otherwise be truncated. Document the field:

```typescript
  /**
   * The code room pricing wants, parsed from the sailing id. Usually the same
   * as `itineraryCode`, but not always: Celebrity returns a master itinerary
   * code that can differ from the bookable package code, and pricing 404s on
   * the wrong one. Null when the id is absent or not in `<code>_<date>` form.
   */
  packageCode: string | null;
```

- [ ] **Step 3: Verify and commit**

`fail 0`, total up by 2 or 3; typecheck clean.

```bash
git add src/domains/search.ts test/celebrity.test.ts
git commit -m "fix: expose the package code room pricing needs

A sailing id is <packageCode>_<date>, and for Celebrity that code can differ
from the master itinerary code the search returns. Pricing 404s on the wrong
one, which is how this surfaced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The account's five loyalty programmes

**Files:**
- Modify: `src/domains/account.ts`
- Test: extend `test/celebrity.test.ts` (or a new `test/account-loyalty.test.ts`)

**Interfaces:** `RcAccount` gains, all optional and null-safe:

```ts
  captainsClubNextTier: string | null;
  captainsClubPoints: number;
  captainsClubRelationshipPoints: number;
  captainsClubRemainingPoints: number | null;

  /** Celebrity's casino programme. Royal exposes points only — no id, no tier. */
  blueChipPoints: number;
  blueChipRelationshipPoints: number;

  venetianSocietyId: string | null;
  venetianSocietyTier: string | null;
  venetianSocietyNextTier: string | null;
  venetianSocietyPoints: number;
  venetianSocietyRelationshipPoints: number;
```

plus `loyaltyIdFor(account: RcAccount, brand: Brand): string | null` exported from `account.ts` — `crownAndAnchorId` for `R`, `captainsClubId` for `C`.

`captainsClubId` and `captainsClubTier` already exist; keep them.

**Background — the exact payload keys**, measured live:
`captainsClubId`, `captainsClubLoyaltyTier`, `captainsClubLoyaltyIndividualPoints`, `captainsClubLoyaltyRelationshipPoints`, `captainsClubNextTier`, `captainsClubRemainingPoints`, `celebrityBlueChipLoyaltyIndividualPoints`, `celebrityBlueChipLoyaltyRelationshipPoints`, `venetianSocietyId`, `venetianSocietyLoyaltyTier`, `venetianSocietyNextTier`, `venetianSocietyIndividualPoints`, `venetianSocietyRelationshipPoints`, `venetianSocietyRemainingPoints`. They are flat under `payload.loyaltyInformation`, alongside the Crown & Anchor and Club Royale keys the file already reads. Note Venetian's points keys lack the `Loyalty` infix the others have — do not "correct" them.

Follow the file's existing conventions exactly: `nn()` for ids and tiers (it maps the literal `"NONE"` to null), `num(x) ?? 0` for point counts.

- [ ] **Step 1: Write failing tests**

Drive `fetchAccount` with a stubbed response built from `test/fixtures/account-all-brands.json` (Task 1). Assert: every programme's tier and points map; `loyaltyIdFor` returns the Crown & Anchor number for `R` and the Captain's Club number for `C`; an account missing a programme yields `null` for that brand rather than throwing; and a `"NONE"` tier becomes `null`.

- [ ] **Step 2: Implement, verify, commit**

`fail 0`; typecheck clean.

```bash
git add src/domains/account.ts test
git commit -m "feat: Captain's Club, Blue Chip and Venetian Society on the account

Blue Chip is points-only — Royal exposes no id or tier for it — so consumers
cannot key on one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Brand-aware offers, and a real error instead of a 401

**Files:**
- Modify: `src/domains/offers.ts`, `src/client.ts`
- Test: extend `test/celebrity.test.ts`

**Interfaces:**
- `ListOffersParams` and `OfferDetailParams` each gain `brand?: Brand` (default `'R'`).
- `RcClient` constructor options gain `brand?: Brand` (default `'R'`), alongside the existing `RcConfig` fields. Decide from the code whether brand belongs inside the same options object or as its own field, and say which in your report; the constructor is `(init, options?)` today and must stay two-argument.
- `RcClient.offers()` and `.offerDetail()` resolve the loyalty number via `loyaltyIdFor(account, brand)` when the caller does not pass one.

**Background:** `offers.ts` has `BASE = 'https://www.royalcaribbean.com/api/casino'` with `LIST` derived from it, used by the private `page()` and by `fetchOfferDetail`. Both become brand-derived.

**The guard, and why.** Verified live: the Celebrity host with a Crown & Anchor number returns **401 `Unauthorized - invalid loyalty id`**, and the Royal host with a Captain's Club number returns 401. Today `request()` turns a 401 into `RcAuthError`, which reads as "your session expired" and sends a caller to re-authenticate for a problem re-authenticating cannot fix.

- When `RcClient` has no loyalty number for the requested brand, `offers()` returns the existing `{ offers: [], outcome: 'none', ... }` without calling. `offerDetail()` returns `null`, as it already does for a missing id.
- When a call **is** made and comes back 401 **and** the body mentions the loyalty id, rethrow as `RcRequestError` whose message says the loyalty number does not belong to that brand's programme and names the brand. Match on the body, not the status alone — a genuinely expired token must still surface as `RcAuthError`. Read the recorded body text before choosing the match.

- [ ] **Step 1: Write failing tests**

Cover: a Celebrity `listOffers` hits the Celebrity host; `fetchOfferDetail` likewise; the empty Celebrity envelope from `test/fixtures/celebrity-offers-empty.json` yields `outcome: 'ok'` with zero offers, **not** `'none'` (it is a real answer); a 401 carrying the invalid-loyalty-id body becomes `RcRequestError` naming the brand; a 401 that does *not* mention the loyalty id still becomes `RcAuthError`; and an `RcClient` with `brand: 'C'` whose account has no Captain's Club number returns `outcome: 'none'` without any fetch happening (assert the stub was never called).

- [ ] **Step 2: Implement, verify, commit**

`fail 0`; typecheck clean; run the **full** `npm test` including the packaging test before committing.

```bash
git add src/domains/offers.ts src/client.ts test/celebrity.test.ts
git commit -m "feat: casino offers follow the brand, and a mismatched loyalty id says so

The host and the loyalty number must belong to the same brand; crossing them
is a 401 that reads like an expired session. It is now a typed error that
names the cause.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Documentation and version

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/endpoints.md`, `docs/design.md`, `package.json`

- [ ] **Step 1: `package.json`** → version `0.3.0`.

- [ ] **Step 2: `CHANGELOG.md`** — a `## 0.3.0 — 2026-09-20` entry above 0.2.0:
  - **Breaking:** `Brand` is now `'R' | 'C'`, was `'RC' | 'CEL'`, and moved to `src/brand.ts`. It is exported from the package root as before.
  - Celebrity support for search, itinerary ports, room pricing, casino loyalty and casino offers, selected by `brand`.
  - `RcClient` takes a `brand`; offers resolve the brand's own loyalty number.
  - A loyalty number that does not match the brand now raises a typed error instead of a 401 that reads as an expired session.
  - `RcSailingSummary.packageCode` — the code room pricing wants, which for Celebrity can differ from the itinerary code.
  - Captain's Club, Blue Chip and Venetian Society on the account.
  - Note plainly: sign-in, the guest account and product pricing are shared across brands and unchanged — verified working for a Celebrity ship.

- [ ] **Step 3: `README.md`** — a **Brands** section: the one-line example (`new RcClient(creds, { brand: 'C' })`), a table of what is brand-aware and what is shared, the host-and-loyalty-number rule stated as a rule, and one honest paragraph: Celebrity's signed-in paths were verified against an account with Captain's Club but **zero Blue Chip points**, so the empty-offers path is proven and a populated Celebrity offer payload is **not**. Update the auth-styles section only if brand changes it. Check every snippet against the real signatures.

- [ ] **Step 4: `docs/endpoints.md`** — a Celebrity subsection under the casino and search sections recording: the host rule, the 401 body for a crossed loyalty number, that the current `offers/list` carries **no** agency id (and that an agency id belonged to the retired `POST /v2/offers/merged`), the Blue Chip points-only shape, and the package-vs-itinerary code divergence with the real codes as the example. No private hostnames — this file ships.

- [ ] **Step 5: `docs/design.md`** — a short "Brand is a host decision" note explaining why brand selects a host rather than a path, and why sign-in, account and products are deliberately brand-free.

- [ ] **Step 6: Verify and commit**

Full `npm test` → `fail 0`. `npx tsc --noEmit` clean. `npm run build`. `npm pack --dry-run` file list unchanged from 0.2.0 apart from content.

```bash
git add README.md CHANGELOG.md docs package.json
git commit -m "docs: Celebrity support, and what about it is verified

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: The consumer still works

**Files:** none in rc-client. Verification only. **Do not modify CruiseWatch** unless something it imports genuinely broke — in which case stop and report, because the plan expects nothing there to change.

- [ ] **Step 1:** `cd C:\Users\colos\source\repos\rc-client && npm run build`
- [ ] **Step 2:** `cd C:\Users\colos\source\repos\CruiseWatch && npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- [ ] **Step 3:** `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)"` → `fail 0` (129 tests)
- [ ] **Step 4:** Confirm the package resolves to the build and the brand exports are reachable:
  `node --input-type=module -e "const m = await import('rc-client'); console.log(['brandHost','BRANDS','RcClient'].map(k => k + ':' + (k in m)).join(' '))"` → all `true`.
- [ ] **Step 5:** Report the four results verbatim. No commit.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 one `Brand`, `'R' \| 'C'`, `brandHost` | 2 |
| §2 what is brand-aware vs shared | 3, 6 (aware); 7 (documented as shared) |
| §3 loyalty number must match the brand; guard and typed error | 5 (`loyaltyIdFor`), 6 (guard) |
| §4 Captain's Club, Blue Chip points-only, Venetian Society | 5 |
| §5 package-code trap | 4 |
| Testing: unit with stubbed fetch, redacted fixtures, gates, CruiseWatch green | 1 (fixtures), 2-6 (unit), 7 (full suite), 8 (consumer) |
| Non-goal: populated Celebrity payload unverified, stated in docs | 7 |
| `0.3.0` | 7 |

**Placeholder scan:** none. Tasks 5 and 6 give interfaces and background rather than full code bodies, because each is a mechanical extension of an existing function whose conventions the implementer must read and match; both name the exact payload keys, the exact defaults and the exact tests required. Task 1's captures cannot be written as literals — they are recordings.

**Type consistency:** `Brand` is `'R' | 'C'` in Task 2's module, Task 3's params, Task 5's `loyaltyIdFor`, Task 6's options and the CHANGELOG. `brandHost` returns a bare host in its definition and at every composition site (`https://${brandHost(b)}/...`). `loyaltyIdFor(account, brand)` has the same argument order in Task 5 and its Task 6 caller. `packageCode: string | null` matches between Task 4's interface and its tests.
