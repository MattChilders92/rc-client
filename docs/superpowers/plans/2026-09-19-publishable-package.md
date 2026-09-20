# rc-client Publishable Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `rc-client` into a package a stranger can `npm install` and use from plain Node with types: nothing secret or identifying in the tarball or history, every export documented, a compiled `dist/`, a typed-error contract with no exceptions, and one home for each shared helper.

**Architecture:** No behaviour changes except three plain `Error`s becoming `Rc*Error`s. A `src/config.ts` replaces module constants for app key, user agent, timeout and retries, threaded through `RcClient` → header builders → `request()`. A `src/coerce.ts` replaces seven local coercion helpers. `certificates.ts` becomes a directory. A `tsconfig.build.json` emits `dist/`; `package.json` points `exports` at it. Two committed gate tests keep fixtures redacted and exports documented.

**Tech Stack:** Node 24 native TypeScript (no build for dev; `tsc` for `dist/`), `node:test`, zero runtime dependencies.

## Global Constraints

- **rc-client is dependency-free.** No runtime dependency may be added. Dev dependencies stay `typescript` and `@types/node` only.
- **Universal fetch.** Source uses only `fetch` and standard web APIs — no `node:` imports in `src/` (scripts and tests may use them).
- **Node 24 native TypeScript in dev**: explicit `.ts` import extensions inside `src/`, `erasableSyntaxOnly` (no enums, no parameter properties), `verbatimModuleSyntax` (`type` imports must say `type`).
- **Every existing public name in `src/index.ts` keeps its name and signature**, except that some functions gain an *optional trailing* parameter. CruiseWatch (`C:\Users\colos\source\repos\CruiseWatch`) imports the bare `'rc-client'` specifier from 14 files and must stay green; it is verified in the last task.
- `npm test` must end `fail 0` after every task (30 tests now). `npx tsc --noEmit` must be clean.
- Never print, log, or commit a credential. `RC_USERNAME`/`RC_PASSWORD` are read only by `scripts/`. No task needs to sign in to Royal.
- Commit messages use a conventional prefix and end with exactly:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Work on branch `feat/publishable` off `master`. Do not push.
- This repo's editor/LSP diagnostics are frequently stale and report phantom errors — trust `node --check`, `npx tsc --noEmit` and `npm test`, not inline squiggles.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/research/mobile-app.md` (create) | The mobile-app research, moved out of the shipped docs |
| `docs/endpoints.md` (modify) | Sanitised: no private hostnames, no mobile section |
| `src/coerce.ts` (create) | `str`, `num`, `int`, `money` — the one home for JSON coercion |
| `src/config.ts` (create) | `RcConfig`, `DEFAULT_CONFIG`, `resolveConfig`, `RC_PUBLIC_APP_KEY`, `USER_AGENT` |
| `src/http.ts` (modify) | Reads timeout/retries from config; constants move to `config.ts` |
| `src/headers.ts` (modify) | Builders take `(session, config)` |
| `src/client.ts` (modify) | Second constructor arg `options`; `static itineraryPorts()`; JSDoc |
| `src/domains/*.ts` (modify) | Import from `coerce.ts`; optional trailing `config`; typed errors |
| `src/domains/certificates/{discover,pdf,parse,index}.ts` (create; delete `certificates.ts`) | The four jobs, separated |
| `src/index.ts` (modify) | Grouped, labelled public surface |
| `src/redaction.ts` (create) | `REDACT_KEYS` shared by the capture script and the fixture gate |
| `test/coerce.test.ts`, `test/errors-contract.test.ts`, `test/fixtures-redacted.test.ts`, `test/exports-documented.test.ts`, `test/packaging.test.ts` (create) | New gates |
| `tsconfig.build.json`, `LICENSE`, `CHANGELOG.md` (create); `package.json`, `.gitignore`, `README.md`, `docs/design.md` (modify) | Packaging and docs |

---

## Task 1: Sanitise the shipped docs

**Files:**
- Create: `docs/research/mobile-app.md`
- Modify: `docs/endpoints.md`

**Interfaces:** none. Docs only.

**Background:** `docs/endpoints.md` ships in the tarball. Two things in it are research, not consumer documentation: a JSON snippet at about line 180 naming Royal's **private** casino gateway host (`<private casino gateway host>`), and the whole `## The mobile app` section starting at about line 376 (APK signing-certificate hash, Akamai Bot Manager notes). Both leave the shipped file.

- [ ] **Step 1: Move the mobile-app section**

Cut everything from the line `## The mobile app (Royal Caribbean International, \`com.rccl.royalcaribbean\`)` to the end of `docs/endpoints.md` and write it to `docs/research/mobile-app.md`, prefixed with:

```markdown
# Research: the Royal Caribbean mobile app

Notes from mapping the phone app's gateway. This is background for maintainers,
not documentation of anything this library does, and it is **not** shipped in
the npm package. The library uses the web APIs only; see `../endpoints.md`.

```

Keep the moved text otherwise verbatim.

- [ ] **Step 2: Remove the private hostname from the JSON example**

In `docs/endpoints.md`, in the fenced `json` block under `### Finding the route again, when it moves`, delete the line containing `casinoApiInternal` and its private host, leaving:

```json
"endpoints":{"casinoApiExternal":"https://www.royalcaribbean.com/api/casino",
             "casinoOps":"https://www.royalcaribbean.com/api/casino",
             "digital":"https://api.rccl.com/en/royal/web"}
```

Then add one sentence after the block: `The same payload also names an internal host, which this library never calls.`

- [ ] **Step 3: Check nothing sensitive remains**

Run: `cd C:\Users\colos\source\repos\rc-client && grep -n -i -E "private\.|\.rccl\.io|sha-?256|signing|akamai|cyberfend|botman" docs/endpoints.md`
Expected: only lines that mention Akamai in passing as the reason not to scrape the *web* pages (there are two such sentences in the Room pricing and Offers sections; those are fine and stay). No private gateway hostname, no `sha-256`, no `signing`, no `cyberfend`, no `botman`.

Also check the README's pointer: `grep -n "mobile" README.md` — every reference to the mobile app in `README.md` is fixed in Task 9; do not edit the README here.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\colos\source\repos\rc-client
git add docs/research/mobile-app.md docs/endpoints.md
git commit -m "docs: move mobile-app research out of the shipped endpoint reference

The tarball ships docs/endpoints.md. Royal's private gateway hostname and the
mobile app's signing-certificate and bot-manager notes are research for
maintainers, not documentation of anything the library does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: One coercion module

**Files:**
- Create: `src/coerce.ts`
- Modify: `src/domains/account.ts`, `bookings.ts`, `casino.ts`, `offers.ts`, `rooms.ts`, `search.ts`, `products.ts`
- Test: `test/coerce.test.ts`

**Interfaces:**
- Produces: `str(v: unknown): string | null`, `num(v: unknown): number | null`, `int(v: unknown): number | null`, `money(v: unknown): number | null`.

**Background — the seven local helpers being replaced, and their exact semantics:**
- `account.ts:46 nn`, `bookings.ts:55 str`, `casino.ts:38 str`, `offers.ts:162 str`, `rooms.ts:58 str`, `search.ts:75 str`: coerce to a trimmed non-empty string, else `null`. Read each; some coerce numbers via `String(v)`, `search.ts:202 text` accepts only real strings. The shared `str` accepts strings and finite numbers (`String(n)`) and returns `null` for everything else and for empty/whitespace-only strings.
- `account.ts:40 num`, `casino.ts:33 num`: return a number, defaulting to `0` for non-numeric. `rooms.ts:53 num`: returns `null` for non-numeric. The shared `num` returns `null`; the two sites that want `0` write `num(v) ?? 0`.
- `offers.ts:165 int`: integer or `null`. Shared `int` = `Math.trunc` of a finite `num`, else `null`.
- `products.ts:42 money`: number > 0 else `null`. Shared `money` keeps that.
- `certificates.ts:259 money` has **different** semantics (strips `$`, allows 0). It is **not** replaced here; Task 4 renames it `dollarsFromCell` when it moves.

- [ ] **Step 1: Write the failing test**

Create `test/coerce.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { str, num, int, money } from '../src/coerce.ts';

test('str keeps non-empty strings and finite numbers, trimmed', () => {
  assert.equal(str(' LE '), 'LE');
  assert.equal(str(7), '7');
  assert.equal(str(''), null);
  assert.equal(str('   '), null);
  assert.equal(str(null), null);
  assert.equal(str(undefined), null);
  assert.equal(str(NaN), null);
  assert.equal(str({}), null);
  assert.equal(str(true), null);
});

test('num accepts numbers and numeric strings, else null', () => {
  assert.equal(num(3.5), 3.5);
  assert.equal(num('3.5'), 3.5);
  assert.equal(num('0'), 0);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(null), null);
  assert.equal(num(Infinity), null);
});

test('int truncates toward zero and rejects non-numbers', () => {
  assert.equal(int(7.9), 7);
  assert.equal(int('-2.5'), -2);
  assert.equal(int('x'), null);
  assert.equal(int(undefined), null);
});

test('money is a positive amount or null — a zero price is not a price', () => {
  assert.equal(money(1234.5), 1234.5);
  assert.equal(money('1234.5'), 1234.5);
  assert.equal(money(0), null);
  assert.equal(money(-1), null);
  assert.equal(money(null), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:\Users\colos\source\repos\rc-client && npm test 2>&1 | grep -aE "Cannot find|not ok" | head -3`
Expected: `Cannot find module '../src/coerce.ts'`.

- [ ] **Step 3: Create `src/coerce.ts`**

```typescript
/**
 * Coercion at the JSON boundary.
 *
 * Royal's payloads carry numbers as strings, strings as numbers, and absent
 * fields as `null`, `""` or a missing key, with no consistency between
 * endpoints. Every domain module used to carry its own copy of these helpers
 * under its own name; this is the one home, so the semantics cannot drift.
 */

/** A trimmed, non-empty string. Finite numbers are accepted and stringified. */
export function str(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A finite number, from a number or a numeric string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** An integer, truncated toward zero. */
export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/** A positive amount. Zero is "no price", not a price of nothing. */
export function money(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}
```

- [ ] **Step 4: Replace the local helpers**

In each domain file, delete the local helper and import the shared one. Keep every call site's behaviour identical:
- `account.ts`: delete `num` and `nn`; `import { num, str } from '../coerce.ts';` rename each `nn(` to `str(`; each former `num(x)` that relied on a `0` default becomes `num(x) ?? 0`.
- `casino.ts`: delete `num` and `str`; import both; apply the `?? 0` rule.
- `bookings.ts`, `offers.ts`, `rooms.ts`: delete `str` (and `num`/`int` where present); import.
- `search.ts`: delete both `str` (line ~75) and `text` (line ~202); import `str`; rename `text(` to `str(`. Note `text` accepted only strings while `str` also accepts numbers — for GraphQL string fields that is a widening with no observable effect.
- `products.ts`: delete `money`; import `money`.

Run `git grep -n "^const \(str\|nn\|num\|int\|text\|money\)\b" src/domains` and confirm only `certificates.ts:259 money` remains.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → expect `fail 0`, total up by 4.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.

- [ ] **Step 6: Commit**

```bash
git add src/coerce.ts src/domains test/coerce.test.ts
git commit -m "refactor: one coercion module instead of seven local copies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Split `certificates.ts` into a directory

**Files:**
- Create: `src/domains/certificates/discover.ts`, `pdf.ts`, `parse.ts`, `index.ts`
- Delete: `src/domains/certificates.ts`
- Modify: `src/index.ts` (import path only), `test/certificates.test.ts` (import path only)

**Interfaces:** every currently exported name is re-exported unchanged from `src/domains/certificates/index.ts`. Consumers see no change.

**Background:** the file does four jobs: constants + campaign discovery (HEAD probing), PDF download, campaign-page parsing, tier-page geometry parsing. The section map (line numbers approximate):
- 26–128: `INSTANT_PDF_BASE`, `INSTANT_SUFFIXES`, `InstantSuffix`, `DEFAULT_TIERS`, `TRADE_IN_BY_TIER`, `tierTradeInValue`, `campaignCode`, `campaignPdfUrl`, `tierPdfUrl`, `splitOfferCode`, `CandidateCampaign`, `candidateCampaigns`, `discoverInstantCampaigns` → **`discover.ts`**
- 130–137: `downloadPdf` → **`pdf.ts`**
- 139–361: `TextCell`, `TextLine`, `PageLines`, `InstantTier`, `parseCampaignPage`, `InstantSailing`, `TierParse`, `MONTHS`, `normalizeSailDate`, `instantSailingKey`, `roomTypeOf`, `money`, `HEADER_KEYS`, `headerKey`, `center`, `parseTierPages` → **`parse.ts`**

- [ ] **Step 1: Create the three modules by moving code verbatim**

Each new file keeps the moved code byte-for-byte, plus the imports it needs (`request`, `USER_AGENT` etc. from `../../http.ts` — note the extra `../`). Give each a short module JSDoc saying what it holds. In `parse.ts`, rename the local `money` to `dollarsFromCell` (it strips `$` and allows zero, unlike `coerce.ts`'s `money`) and update its call sites.

- [ ] **Step 2: Create `src/domains/certificates/index.ts`**

```typescript
/**
 * Instant Reward certificates: the public PDFs Royal publishes per campaign.
 *
 * Three steps, three modules: discover which campaign PDFs exist, download one,
 * parse its pages. Parsing takes positioned text the caller extracted — this
 * library carries no PDF dependency.
 */
export {
  INSTANT_PDF_BASE, INSTANT_SUFFIXES, DEFAULT_TIERS, campaignCode, campaignPdfUrl, tierPdfUrl,
  splitOfferCode, candidateCampaigns, discoverInstantCampaigns, tierTradeInValue,
  type InstantSuffix, type CandidateCampaign,
} from './discover.ts';
export { downloadPdf } from './pdf.ts';
export {
  parseCampaignPage, parseTierPages, normalizeSailDate, instantSailingKey, roomTypeOf,
  type InstantTier, type InstantSailing, type TierParse, type TextCell, type TextLine, type PageLines,
} from './parse.ts';
```

- [ ] **Step 3: Repoint the two importers**

In `src/index.ts` change `from './domains/certificates.ts'` to `from './domains/certificates/index.ts'`. In `test/certificates.test.ts` change its import path the same way. Delete `src/domains/certificates.ts`.

- [ ] **Step 4: Verify**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `fail 0`, same total.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.
Run: `git grep -n "certificates.ts" -- src test scripts` → only the new `certificates/index.ts` path.

- [ ] **Step 5: Commit**

```bash
git add -A src/domains/certificates src/domains/certificates.ts src/index.ts test/certificates.test.ts
git commit -m "refactor: split certificates into discover, pdf and parse modules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Typed errors everywhere

**Files:**
- Modify: `src/domains/search.ts`, `src/domains/certificates/pdf.ts`
- Test: `test/errors-contract.test.ts`

**Interfaces:** unchanged signatures; the thrown classes change from `Error` to `RcRequestError` / `RcError` / `RcUnavailableError`.

- [ ] **Step 1: Write the failing test**

Create `test/errors-contract.test.ts`. It stubs `globalThis.fetch` so no network is touched:

```typescript
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchCruises, fetchItineraryPorts } from '../src/domains/search.ts';
import { downloadPdf } from '../src/domains/certificates/pdf.ts';
import { RcError, RcRequestError, RcUnavailableError } from '../src/errors.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a GraphQL error inside a 200 is an RcRequestError carrying the error list', async () => {
  const errors = [{ message: 'Cannot query field "nope"' }];
  globalThis.fetch = async () => jsonResponse({ errors });
  await assert.rejects(searchCruises(), (e: unknown) => {
    assert.ok(e instanceof RcRequestError, `expected RcRequestError, got ${(e as Error).constructor.name}`);
    assert.deepEqual((e as RcError).body, errors);
    assert.match((e as Error).message, /Cannot query field/);
    return true;
  });
});

test('fetchItineraryPorts follows the same contract', async () => {
  globalThis.fetch = async () => jsonResponse({ errors: [{ message: 'boom' }] });
  await assert.rejects(fetchItineraryPorts(), RcRequestError);
});

test('downloadPdf turns a 404 into an RcError with status and url', async () => {
  globalThis.fetch = async () => new Response('gone', { status: 404 });
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcError);
    assert.equal((e as RcError).status, 404);
    assert.equal((e as RcError).url, 'https://example.com/x.pdf');
    return true;
  });
});

test('downloadPdf turns a 503 into an RcUnavailableError', async () => {
  globalThis.fetch = async () => new Response('', { status: 503, headers: { 'retry-after': '2' } });
  await assert.rejects(downloadPdf('https://example.com/x.pdf'), (e: unknown) => {
    assert.ok(e instanceof RcUnavailableError);
    assert.equal((e as RcUnavailableError).retryAfterMs, 2000);
    return true;
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test 2>&1 | grep -aE "not ok|^ℹ fail"` → the first three fail (plain `Error` thrown).

- [ ] **Step 3: Fix `search.ts`**

At both throw sites (about lines 123 and 257), replace `throw new Error(...)` with:

```typescript
    throw new RcRequestError(
      `Cruise search rejected by GraphQL: ${first?.message ?? 'unknown GraphQL error'}`,
      { status: res.status, url: GRAPH_URL, body: res.data.errors },
    );
```

using whatever the file's URL constant is actually called, and add `RcRequestError` to the import from `../errors.ts`. Both sites get the same shape; the ports one says `Cruise search (ports) rejected by GraphQL`.

- [ ] **Step 4: Fix `pdf.ts`**

Replace `if (!r.ok) throw new Error(...)` with:

```typescript
  if (!r.ok) {
    if (r.status === 429 || r.status === 503) {
      const raw = r.headers.get('retry-after');
      const secs = raw === null ? NaN : Number(raw);
      throw new RcUnavailableError(`PDF temporarily unavailable (${r.status})`, {
        status: r.status, url, retryAfterMs: Number.isFinite(secs) ? secs * 1000 : null,
      });
    }
    throw new RcError(`HTTP ${r.status} fetching PDF`, { status: r.status, url });
  }
```

Import `RcError, RcUnavailableError` from `../../errors.ts`.

- [ ] **Step 5: Verify**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `fail 0`, total up by 4.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.
Run: `git grep -n "new Error(" src` → no matches.

- [ ] **Step 6: Commit**

```bash
git add src/domains/search.ts src/domains/certificates/pdf.ts test/errors-contract.test.ts
git commit -m "fix: every failure is an Rc*Error, GraphQL and PDF included

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: Configuration instead of module constants

**Files:**
- Create: `src/config.ts`
- Modify: `src/http.ts`, `src/headers.ts`, `src/auth/index.ts`, `src/client.ts`, `src/domains/account.ts`, `bookings.ts`, `casino.ts`, `offers.ts`, `products.ts`, `rooms.ts`, `src/index.ts`, `scripts/capture.ts`, `scripts/smoke.ts` (imports of moved constants)
- Test: extend `test/fixtures.test.ts` with two cases (below)

**Interfaces:**
- Produces:
  ```typescript
  export interface RcConfig { appKey: string; userAgent: string; timeoutMs: number; retries: number }
  export const RC_PUBLIC_APP_KEY: string;   // was RC_APPKEY in http.ts
  export const USER_AGENT: string;          // was in http.ts
  export const DEFAULT_CONFIG: Readonly<RcConfig>;
  export function resolveConfig(partial?: Partial<RcConfig>): RcConfig;
  ```
- `RcClient` constructor becomes `(init: Credentials | { session: RcSession }, options?: Partial<RcConfig>)`.
- Header builders: `guestHeaders(session, config = DEFAULT_CONFIG)`, `commerceHeaders(session, config = DEFAULT_CONFIG)`, `casinoHeaders(session, opts = {}, config = DEFAULT_CONFIG)`, `anonymousHeaders(config = DEFAULT_CONFIG)`.
- `request(url, opts)`: `RequestOptions` gains `config?: RcConfig`; `timeoutMs`/`retries` default from `config ?? DEFAULT_CONFIG` when not given explicitly.
- `signIn(credentials, config = DEFAULT_CONFIG)`.
- Domain functions gain an optional trailing `config: RcConfig = DEFAULT_CONFIG` and pass it to their header builder and to `request` (`config` in `RequestOptions`): `fetchAccount(session, config?)`, `fetchCasinoLoyalty(session, config?)`, `listOffers(session, params, config?)`, `fetchOfferDetail(session, params, config?)`, `listBookings(session, opts?, config?)`, `fetchProducts(session, query, config?)`, `fetchCategory(session, …, config?)`, `fetchRooms(query, config?)`, `sweepOccupancy(query, occupancies?, config?)`. `searchCruises` and `fetchItineraryPorts` also gain it (user agent + timeout).
- `RoomQuery.officeCode?: string` (default `'MIA'`), `ProductQuery.regionCode?: string` (default `'ALCAN'`).
- **`RC_APPKEY` stays exported from `src/index.ts` as a deprecated alias** of `RC_PUBLIC_APP_KEY` so no consumer breaks: `/** @deprecated Use RC_PUBLIC_APP_KEY. */ export const RC_APPKEY = RC_PUBLIC_APP_KEY;` in `config.ts`.

- [ ] **Step 1: Create `src/config.ts`**

```typescript
/**
 * Everything a consumer might legitimately need to change, in one place.
 *
 * These were module constants. A pinned Chrome version in the user agent goes
 * stale; Royal could rotate its public app key; a serverless caller wants a
 * shorter timeout. Each is now a field on `RcConfig`, resolved once by
 * `RcClient` and threaded through every call, with today's values as defaults
 * so a caller who passes nothing gets exactly the previous behaviour.
 */

/**
 * Royal's **public** web app key — the value their own site sends from public
 * JavaScript on every request, and required for sign-in. It is a client
 * identifier, not a secret: it grants nothing on its own and is visible to
 * anyone who opens the site's network tab. Override it via `RcConfig.appKey`
 * if Royal rotates it before this library does.
 */
export const RC_PUBLIC_APP_KEY = 'hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm';

/** @deprecated Use `RC_PUBLIC_APP_KEY`. Kept so existing imports keep working. */
export const RC_APPKEY = RC_PUBLIC_APP_KEY;

/** A current desktop Chrome user agent; Royal's edge rejects obviously non-browser ones. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export interface RcConfig {
  /** Sent as `appkey` on guest, commerce and sign-in requests. */
  appKey: string;
  /** Sent on every request. */
  userAgent: string;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Retries for network failures and 429/5xx, on top of the first attempt. */
  retries: number;
}

export const DEFAULT_CONFIG: Readonly<RcConfig> = Object.freeze({
  appKey: RC_PUBLIC_APP_KEY,
  userAgent: USER_AGENT,
  timeoutMs: 45_000,
  retries: 2,
});

/** Fill in whatever the caller did not supply. */
export function resolveConfig(partial: Partial<RcConfig> = {}): RcConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
```

- [ ] **Step 2: Move the constants out of `http.ts` and thread config through `request`**

In `src/http.ts`: delete the `USER_AGENT` and `RC_APPKEY` declarations; `import { DEFAULT_CONFIG, type RcConfig } from './config.ts';` add `config?: RcConfig` to `RequestOptions` (with JSDoc: "Defaults for timeout, retries and user agent. Explicit `timeoutMs`/`retries` win."); in the destructure, resolve `const cfg = opts.config ?? DEFAULT_CONFIG;` and default `timeoutMs = cfg.timeoutMs`, `retries = cfg.retries`; use `cfg.userAgent` in the `'user-agent'` default header. Re-export nothing from `http.ts` that moved; `src/index.ts` will export the constants from `config.ts` in Step 6.

Also add JSDoc to `RcResponse` and its three fields (the survey found none):

```typescript
/** What `request()` returns for a status it did not throw on. */
export interface RcResponse<T> {
  /** The HTTP status, which may be one the caller allowed via `allowStatus`. */
  status: number;
  /** The body, JSON-parsed when it parsed, else the raw text. */
  data: T;
  /** Response headers, for `retry-after` and the like. */
  headers: Headers;
}
```

- [ ] **Step 3: Header builders take config**

In `src/headers.ts`: import `DEFAULT_CONFIG, type RcConfig` from `./config.ts` instead of `RC_APPKEY, USER_AGENT` from `./http.ts`. `BASE` becomes a function `base(config: RcConfig)` returning the object with `'user-agent': config.userAgent`. Each builder gains the trailing `config: RcConfig = DEFAULT_CONFIG` parameter per the Interfaces block and uses `config.appKey` where `RC_APPKEY` was.

- [ ] **Step 4: `signIn` and the domain functions take config**

`src/auth/index.ts`: `signIn(credentials, config: RcConfig = DEFAULT_CONFIG)`; use `config.appKey` and `config.userAgent`; pass `config` in both `request` calls' options.

Each domain function in the Interfaces list: add the trailing `config: RcConfig = DEFAULT_CONFIG` parameter, pass it to its header builder, and add `config` to every `request(...)` options object in that function. In `rooms.ts` add `officeCode?: string` to `RoomQuery` (JSDoc: "Royal's booking-office code; `MIA` is the US site.") and use `query.officeCode ?? 'MIA'`. In `products.ts` add `regionCode?: string` to `ProductQuery` (JSDoc: "Catalogue region; `ALCAN` is what the US site sends.") and use `query.regionCode ?? 'ALCAN'`.

Also fill the JSDoc gaps the survey found while you are in these files: every field of `RoomQuery`, `SearchParams` (`sortBy`, `limit`, `page`), and `ListBookingsOptions.brand`.

- [ ] **Step 5: `RcClient` holds a config**

In `src/client.ts`:

```typescript
  readonly #config: RcConfig;

  constructor(init: Credentials | { session: RcSession }, options: Partial<RcConfig> = {}) {
    this.#config = resolveConfig(options);
    …
  }
```

Pass `this.#config` as the trailing argument to every domain call and to `signIn`. Add:

```typescript
  /**
   * The itineraries in Royal's public catalogue with their day-by-day ports.
   * Static, like `search`: the same credential-free GraphQL.
   */
  static itineraryPorts(opts?: { count?: number; skip?: number }): Promise<{ itineraries: RcItineraryPorts[]; total: number }> {
    return fetchItineraryPorts(opts);
  }
```

and JSDoc for `casinoLoyalty()` ("Club Royale loyalty tier and points, or `null` when the account has no casino profile."), `bookings()` ("Current and past reservations on the account."), `products()` ("Onboard product catalogue and prices for a ship and date window.").

Update the class JSDoc example to show options:

```ts
 * const rc = new RcClient({ username, password }, { timeoutMs: 15_000 });
```

- [ ] **Step 6: Exports and scripts**

`src/index.ts`: change the `http.ts` export line to `export { request, type RcResponse, type RequestOptions } from './http.ts';` and add `export { RC_PUBLIC_APP_KEY, RC_APPKEY, USER_AGENT, DEFAULT_CONFIG, resolveConfig, type RcConfig } from './config.ts';`. (Task 6 regroups the whole file; here just keep it compiling.)

`scripts/capture.ts` and `scripts/smoke.ts`: fix any import of `RC_APPKEY`/`USER_AGENT` from `../src/http.ts` to `../src/config.ts`.

- [ ] **Step 7: Tests for the new seam**

Append to `test/fixtures.test.ts` (which already stubs fetch — read how it does so and reuse its helper):

```typescript
test('RcClient options reach the request: a custom user agent is sent', async () => {
  let seen: string | null = null;
  globalThis.fetch = async (_url, init) => {
    seen = new Headers(init?.headers).get('user-agent');
    return new Response(JSON.stringify({ tokenId: 'x' }), { status: 200 });
  };
  const { signIn } = await import('../src/auth/index.ts');
  const { resolveConfig } = await import('../src/config.ts');
  await signIn({ username: 'u', password: 'p' }, resolveConfig({ userAgent: 'rc-test/1' })).catch(() => {});
  assert.equal(seen, 'rc-test/1');
});

test('resolveConfig fills every field and never mutates the defaults', async () => {
  const { resolveConfig, DEFAULT_CONFIG } = await import('../src/config.ts');
  const c = resolveConfig({ retries: 0 });
  assert.equal(c.retries, 0);
  assert.equal(c.appKey, DEFAULT_CONFIG.appKey);
  assert.equal(DEFAULT_CONFIG.retries, 2);
  assert.throws(() => { (DEFAULT_CONFIG as { retries: number }).retries = 9; });
});
```

Adapt the fetch-stubbing to match the file's existing `beforeEach`/`afterEach` pattern rather than duplicating it.

- [ ] **Step 8: Verify**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `fail 0`, total up by 2.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.
Run: `git grep -n "RC_APPKEY\|USER_AGENT" src scripts` → only `config.ts` defines them; every other reference imports from `config.ts`.

- [ ] **Step 9: Commit**

```bash
git add src scripts test/fixtures.test.ts
git commit -m "feat: RcConfig — app key, user agent, timeout and retries are options

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: A deliberate public surface, and a gate that keeps it documented

**Files:**
- Modify: `src/index.ts`, `src/errors.ts`, `src/domains/offers.ts` (JSDoc only)
- Test: `test/exports-documented.test.ts`

**Interfaces:** every name exported today is still exported. Added: `roomTypeOf` (from certificates). Nothing removed.

- [ ] **Step 1: Write the gate test first**

Create `test/exports-documented.test.ts`. It is a regex-level check, deliberately simple:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** `export { a, b as c, type T } from './x.ts'` → [{ name, from }] */
function exportsOf(indexSource: string): { name: string; from: string }[] {
  const out: { name: string; from: string }[] = [];
  const re = /export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g;
  for (const m of indexSource.matchAll(re)) {
    for (const raw of m[1]!.split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0]!.trim();
      if (name) out.push({ name, from: m[2]! });
    }
  }
  return out;
}

/** Follow one level of re-export (a barrel like certificates/index.ts). */
function resolveDeclaration(name: string, from: string): { file: string; source: string } | null {
  const file = path.normalize(from);
  const source = read(file);
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${name}\\b`, 'm');
  if (decl.test(source)) return { file, source };
  for (const e of exportsOf(source)) {
    if (e.name === name) return resolveDeclaration(name, path.join(path.dirname(file), e.from));
  }
  return null;
}

function isDocumented(name: string, source: string): boolean {
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${name}\\b`, 'm');
  const at = source.search(decl);
  if (at < 0) return false;
  // The text immediately before the declaration, ignoring blank lines, must end a JSDoc block.
  const before = source.slice(0, at).replace(/\s+$/, '');
  return before.endsWith('*/') && /\/\*\*[\s\S]*\*\/$/.test(before.slice(-4000));
}

test('every public export has a JSDoc on its declaration', () => {
  const missing: string[] = [];
  for (const { name, from } of exportsOf(read('index.ts'))) {
    const found = resolveDeclaration(name, from);
    if (!found) { missing.push(`${name} (declaration not found from ${from})`); continue; }
    if (!isDocumented(name, found.source)) missing.push(`${name} in ${found.file}`);
  }
  assert.deepEqual(missing, [], `undocumented exports:\n  ${missing.join('\n  ')}`);
});
```

- [ ] **Step 2: Run it and read the list**

Run: `npm test 2>&1 | grep -aA40 "undocumented exports" | head -50`
Expected: a list. Every name on it gets a JSDoc in Step 3. If the test reports a false positive (a name that plainly is documented), fix the regex, not the code — and say so in your report.

- [ ] **Step 3: Regroup `src/index.ts` and document what the list names**

Rewrite `src/index.ts` as labelled groups. Every name currently exported stays; `roomTypeOf` is added to the certificates group:

```typescript
/**
 * rc-client — a documented client for Royal Caribbean's web APIs.
 *
 * Start with `RcClient`. Everything below it is also exported, for callers who
 * manage their own session or want one piece without the rest.
 *
 * @see docs/endpoints.md for every endpoint, its auth style, and its quirks.
 */

/* ── The client ──────────────────────────────────────────────────────────── */
export { RcClient } from './client.ts';
export { signIn, isExpired, type Credentials, type RcSession } from './auth/index.ts';
export { DEFAULT_CONFIG, resolveConfig, type RcConfig } from './config.ts';

/* ── Errors ──────────────────────────────────────────────────────────────── */
export {
  RcError, RcAuthError, RcRequestError, RcRouteGoneError, RcUnavailableError, RcShapeError,
} from './errors.ts';

/* ── Domain functions and types ──────────────────────────────────────────── */
export { fetchAccount, type RcAccount } from './domains/account.ts';
… (the existing domain export blocks, unchanged) …

/* ── Instant Reward certificates: public PDFs, no session ────────────────── */
export { … existing names …, roomTypeOf, … } from './domains/certificates/index.ts';

/* ── Transport, for callers who manage their own session ─────────────────── */
export { request, type RcResponse, type RequestOptions } from './http.ts';
export { anonymousHeaders, casinoHeaders, commerceHeaders, guestHeaders } from './headers.ts';
export { RC_PUBLIC_APP_KEY, RC_APPKEY, USER_AGENT } from './config.ts';
```

Then add JSDoc to every name the test listed. Known gaps from the survey: `RcError` class (`src/errors.ts`) — "Base of every failure this library throws. `status` and `url` are always set; `body` is Royal's own error envelope when there was one."; `mapOffer` and `SORT_FIELDS` in `offers.ts` if unlisted; `USER_AGENT` is documented in Task 5. Write a sentence that says what the thing is for, not its name.

- [ ] **Step 4: Verify**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `fail 0`, total up by 1.
Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/errors.ts src/domains test/exports-documented.test.ts
git commit -m "docs: every export documented, and a test that keeps it so

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: A gate that keeps fixtures redacted

**Files:**
- Create: `src/redaction.ts`
- Modify: `scripts/capture.ts` (import the set instead of declaring it)
- Test: `test/fixtures-redacted.test.ts`

**Interfaces:**
- Produces: `export const REDACT_KEYS: ReadonlySet<string>` — the lower-cased key names whose values the capture script replaces. `src/redaction.ts` has no imports and is not exported from `src/index.ts`.

- [ ] **Step 1: Move the set**

Create `src/redaction.ts` holding the `REDACT_KEYS` set verbatim from `scripts/capture.ts` (the block starting `const REDACT_KEYS = new Set([` — 'firstname' … 'playerofferid'), with this JSDoc:

```typescript
/**
 * Keys whose values never reach a committed fixture.
 *
 * Shared by the capture script, which replaces them on the way in, and the
 * fixture gate test, which fails if one ever slips through — the two cannot
 * disagree about what counts as identifying.
 */
export const REDACT_KEYS: ReadonlySet<string> = new Set([ … ]);
```

In `scripts/capture.ts` delete the local declaration and `import { REDACT_KEYS } from '../src/redaction.ts';`.

- [ ] **Step 2: Write the gate**

Create `test/fixtures-redacted.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDACT_KEYS } from '../src/redaction.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.local.json'));

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Values under redacted keys may be REDACTED, empty, null, or a zero-uuid. */
const isScrubbed = (v: unknown): boolean =>
  v === null || v === '' || v === 'REDACTED' ||
  (typeof v === 'string' && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v)) ||
  (typeof v === 'string' && v.endsWith('@example.com'));

function* walk(node: unknown, trail: string[] = []): Generator<{ key: string; value: unknown; trail: string[] }> {
  if (Array.isArray(node)) { for (const [i, v] of node.entries()) yield* walk(v, [...trail, String(i)]); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      yield { key: k, value: v, trail: [...trail, k] };
      yield* walk(v, [...trail, k]);
    }
  }
}

test('there is at least one fixture to check', () => { assert.ok(files.length > 0); });

for (const file of files) {
  test(`${file} carries nothing identifying`, () => {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    assert.doesNotMatch(text, JWT, 'a JWT-shaped token');
    for (const m of text.match(EMAIL) ?? []) assert.ok(m.endsWith('@example.com'), `email ${m}`);
    for (const m of text.match(UUID) ?? []) assert.match(m, /^0{8}-0{4}-0{4}-0{4}-0{12}$/, `uuid ${m}`);
    const leaks: string[] = [];
    for (const { key, value, trail } of walk(JSON.parse(text))) {
      if (REDACT_KEYS.has(key.toLowerCase()) && typeof value !== 'object' && !isScrubbed(value)) {
        leaks.push(`${trail.join('.')} = ${JSON.stringify(value)}`);
      }
    }
    assert.deepEqual(leaks, [], `unscrubbed values:\n  ${leaks.join('\n  ')}`);
  });
}
```

- [ ] **Step 3: Run it**

Run: `npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok|unscrubbed|uuid |email "` → expect `fail 0`. The fixtures are already scrubbed; if the gate finds something, **report it and stop** — do not edit a fixture to make the test pass without saying what was in it.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" || echo clean` → `clean`.

```bash
git add src/redaction.ts scripts/capture.ts test/fixtures-redacted.test.ts
git commit -m "test: a gate that fails if a fixture ever carries identifying data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: Packaging

**Files:**
- Create: `tsconfig.build.json`, `LICENSE`, `CHANGELOG.md`, `test/packaging.test.ts`
- Modify: `package.json`, `.gitignore`

**Interfaces:** `npm run build` emits `dist/`; `exports` points at it.

- [ ] **Step 1: `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*.ts"]
}
```

A probe confirmed with TS 5.9.3: the emitted `.js` rewrites `./x.ts` to `./x.js` and loads in plain Node; the `.d.ts` keep `.ts` specifiers and a NodeNext consumer with `skipLibCheck: false` still typechecks.

- [ ] **Step 2: `package.json`**

Replace the file with (keeping the existing `devDependencies` versions exactly as they are):

```json
{
  "name": "rc-client",
  "version": "1.0.0",
  "description": "Client for Royal Caribbean's web APIs: sign-in, account, casino offers and their sailings, room and product pricing, bookings, cruise search and Instant Reward certificates. Zero dependencies, runs anywhere fetch does.",
  "keywords": ["royal-caribbean", "cruise", "casino", "offers", "api-client", "fetch", "typescript"],
  "license": "MIT",
  "author": "Matt Childers",
  "repository": { "type": "git", "url": "git+https://github.com/MattChilders92/rc-client.git" },
  "homepage": "https://github.com/MattChilders92/rc-client#readme",
  "bugs": { "url": "https://github.com/MattChilders92/rc-client/issues" },
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20.3" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md", "docs/endpoints.md", "docs/design.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "node -e \"fs.rmSync('dist',{recursive:true,force:true})\"",
    "prepare": "npm run build",
    "typecheck": "tsc --noEmit",
    "test": "node --disable-warning=ExperimentalWarning --test test/*.test.ts",
    "prepublishOnly": "npm run typecheck && npm test && npm run clean && npm run build",
    "pack:check": "npm pack --dry-run",
    "capture": "node --disable-warning=ExperimentalWarning scripts/capture.ts"
  },
  "devDependencies": { … as today … }
}
```

`engines` is `>=20.3` because `AbortSignal.any` (used by `request()`) arrived in Node 20.3.

- [ ] **Step 3: `.gitignore`, `LICENSE`, `CHANGELOG.md`**

Add `dist/` to `.gitignore`.

`LICENSE`: the MIT text, `Copyright (c) 2026 Matt Childers`.

`CHANGELOG.md`:

```markdown
# Changelog

## 1.0.0 — 2026-09-19

First publishable release.

- **Breaking:** the package ships compiled `dist/` with declarations. Consumers
  that resolved the raw `.ts` source through `exports` now get JavaScript.
- `RcClient` takes an options object: app key, user agent, timeout and retries
  (`RcConfig`). Standalone functions accept the same as an optional last argument.
- `RoomQuery.officeCode` and `ProductQuery.regionCode` are settable.
- Every failure is an `Rc*Error`: GraphQL rejections are `RcRequestError`, a
  failed PDF download is `RcError` or `RcUnavailableError`.
- `RcClient.itineraryPorts()` and `roomTypeOf` are exported.
- `RC_APPKEY` is deprecated in favour of `RC_PUBLIC_APP_KEY`; both work.
- The mobile-app research is no longer in the shipped docs.
```

- [ ] **Step 4: The packaging test**

Create `test/packaging.test.ts`. It builds, packs into a temp dir, installs the tarball into a throwaway consumer, and both typechecks and runs it — the same probe done by hand, made permanent. It shells out, so it is slower than the others (~20 s) and is guarded so `npm test` can skip it with `RC_SKIP_PACKAGING=1`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });

test('the packed tarball installs, typechecks and runs in a plain NodeNext consumer',
  { skip: process.env.RC_SKIP_PACKAGING ? 'RC_SKIP_PACKAGING set' : false }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-client-pack-'));
  try {
    run(npm, ['run', 'build'], ROOT);
    const packed = run(npm, ['pack', '--json', '--pack-destination', tmp], ROOT);
    const [{ filename, files }] = JSON.parse(packed) as [{ filename: string; files: { path: string }[] }];

    const shipped = files.map((f) => f.path);
    assert.ok(shipped.includes('dist/index.js') && shipped.includes('dist/index.d.ts'), 'dist is shipped');
    assert.ok(shipped.includes('LICENSE') && shipped.includes('README.md'), 'license and readme ship');
    assert.ok(!shipped.some((p) => p.startsWith('src/') || p.startsWith('test/') || p.startsWith('scripts/')), 'no source, tests or scripts');
    assert.ok(!shipped.some((p) => p.includes('research') || p.includes('superpowers')), 'no research or planning docs');

    const consumer = path.join(tmp, 'consumer');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'c', version: '0.0.0', type: 'module', private: true }));
    fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, target: 'ES2023', skipLibCheck: false, types: [] },
      include: ['main.ts'],
    }));
    fs.writeFileSync(path.join(consumer, 'main.ts'), [
      "import { RcClient, RcError, RC_PUBLIC_APP_KEY, type RcOffer } from 'rc-client';",
      "const c = new RcClient({ username: 'u', password: 'p' }, { retries: 0 });",
      "const e: RcError = new RcError('x', { url: 'u' });",
      "const o: RcOffer | null = null;",
      "console.log(typeof c.offers, e.url, o, RC_PUBLIC_APP_KEY.length);",
    ].join('\n'));
    run(npm, ['install', '--no-audit', '--no-fund', '--silent', path.join(tmp, filename)], consumer);
    // The consumer needs a compiler; borrow this repo's.
    fs.symlinkSync(path.join(ROOT, 'node_modules', 'typescript'), path.join(consumer, 'node_modules', 'typescript'), 'junction');
    run('node', [path.join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], consumer);
    const out = run('node', ['--experimental-strip-types', 'main.ts'], consumer);
    assert.match(out, /^function u null 32/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Verify**

Run: `cd C:\Users\colos\source\repos\rc-client && npm run build && ls dist | head && npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `dist/` populated, `fail 0`, total up by 1.
Run: `npm run pack:check 2>&1 | grep -E "^npm notice" | grep -v "Tarball" ` and paste the file list into your report. It must contain only `dist/**`, `README.md`, `LICENSE`, `CHANGELOG.md`, `docs/endpoints.md`, `docs/design.md`, `package.json`.
Run: `git status --short` → `dist/` must **not** appear (ignored).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.build.json package.json .gitignore LICENSE CHANGELOG.md test/packaging.test.ts
git commit -m "build: compiled dist, MIT license, publishable package.json

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: README and design notes

**Files:**
- Modify: `README.md`, `docs/design.md`

- [ ] **Step 1: README**

Edit `README.md`:
1. After the title paragraph add an **Install** section: `npm install rc-client`, a note that it needs Node 20.3+ (or any runtime with `fetch` and `AbortSignal.any`), and that it ships compiled JavaScript with types.
2. Update the opening example to `new RcClient({ username, password })` unchanged, then add a **Configuration** section showing `new RcClient({ username, password }, { timeoutMs: 15_000, retries: 0, userAgent: '…' })`, listing the four `RcConfig` fields and the `officeCode`/`regionCode` query fields.
3. In "The three auth styles", delete the `mobile` table row and the paragraph after the table that describes the phone app; replace with one sentence: `Research on the phone app's separate gateway lives in the repo under docs/research/ and is not part of this package.`
4. Add a **Standalone functions** section: the domain functions and header builders are exported for callers managing their own session (one example with `signIn` + `guestHeaders` + `request`); the certificate tooling is a standalone module because it parses PDFs rather than calling an API (one example with `discoverInstantCampaigns` → `downloadPdf` → `parseTierPages`, noting the caller supplies positioned text from their own PDF extractor).
5. Replace the **Status** section with **Verified live** — the same list, without the narrative — and a line pointing at `CHANGELOG.md`.
6. Check every code sample against the real signatures in `src/`. `rc.allRooms({ packageCode, sailDate })`, `rc.products({ shipCode, startDate, endDate })`, `RcClient.search({ limit })` and `RcClient.itineraryPorts()` must match what `client.ts` declares.

- [ ] **Step 2: `docs/design.md`**

1. Replace the **Not done** section with **Verified and not**: offers *are* verified against a live payload of 13 real offers (the README already says so); there is no Celebrity agency id in the code; only room pricing has a `Brand` switch, every other endpoint is Royal-only — say that plainly.
2. Add **Return shapes**: "A function returns a bare array when the call cannot partially fail (`fetchRooms`, `listBookings`), and a wrapper object when it carries an outcome or a partial-failure count (`OffersResult.outcome`, `ProductsResult.failed`, `SearchResult.total`)."
3. Add **Configuration, not constants**: two sentences on why `RcConfig` exists and why the public app key ships (it is Royal's public client identifier; without it there is no sign-in).
4. Add **Typed errors, no exceptions**: one sentence that every thrown value is an `Rc*Error`, and a test pins the two places that used to differ.

- [ ] **Step 3: Verify the samples compile**

Create `scripts/_readme_check.ts` containing each README snippet as a typed function body (no network calls — just construct and reference), run `npx tsc --noEmit` (the file is inside `scripts/**`, which the base tsconfig includes), then delete it. Report any snippet that failed and what you changed.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/design.md
git commit -m "docs: install, configuration, standalone use; design notes made true

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: The consumer still works

**Files:** none in rc-client. Verification of `C:\Users\colos\source\repos\CruiseWatch` against the new package shape. **Do not modify CruiseWatch** unless a public name it imports has genuinely changed — in which case stop and report, because the Global Constraints forbid that.

- [ ] **Step 1: Give CruiseWatch the built package**

CruiseWatch links `rc-client` through a `file:../rc-client` symlink, so `exports` now resolves to `dist/index.js` there. Run: `cd C:\Users\colos\source\repos\rc-client && npm run build` and confirm `dist/index.js` exists.

- [ ] **Step 2: CruiseWatch's gates**

Run: `cd C:\Users\colos\source\repos\CruiseWatch && npx tsc --noEmit 2>&1 | grep "error TS" | head; echo "typecheck done"` → no `error TS` lines.
Run: `cd C:\Users\colos\source\repos\CruiseWatch && npm test 2>&1 | grep -aE "^ℹ (tests|pass|fail)|not ok"` → `fail 0` (129 tests at last count).

- [ ] **Step 3: Prove the runtime resolves `dist`**

Run: `cd C:\Users\colos\source\repos\CruiseWatch && node -e "import('rc-client').then(m => console.log(Object.keys(m).includes('RcClient'), Object.keys(m).includes('RC_APPKEY'), Object.keys(m).includes('fetchItineraryPorts')))" --input-type=module` → `true true true`.

- [ ] **Step 4: Report**

No commit. Report the three results verbatim. If `npm test` or the typecheck fails in CruiseWatch, report the exact failure and which rc-client name is involved — do not patch either repo.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 app key kept and renamed; fixture gate; scripts excluded | 5, 7, 8 |
| §2 mobile research moved; private host removed; tarball contents | 1, 8 |
| §3 `RcConfig`, client options, header/domain threading, `officeCode`/`regionCode` | 5 |
| §4 typed errors for GraphQL and PDF | 4 |
| §5 `coerce.ts`; certificates split; deliberate `index.ts`; `itineraryPorts()`; `roomTypeOf`; JSDoc gaps; documented-exports gate; return-shape rule written down | 2, 3, 5, 6, 9 |
| §6 build config, `package.json`, `LICENSE`, `CHANGELOG`, `dist/` ignored, engines | 8 |
| §7 README and design.md | 9 |
| §8 CruiseWatch stays green | 10 |
| Testing: existing 30 pass every task; five new gates | every task; 2, 4, 6, 7, 8 |

**Placeholder scan:** Task 6 Step 3 elides the unchanged domain export blocks with `…` because they are the existing file's content, which the implementer copies; the two blocks that change are written out. Task 8 Step 2 elides `devDependencies` for the same reason. No TBDs.

**Type consistency:** `RcConfig` fields (`appKey`, `userAgent`, `timeoutMs`, `retries`) are identical in Task 5's module, its `RequestOptions.config`, its test, the CHANGELOG and the README. `RC_PUBLIC_APP_KEY` is the name in `config.ts`, `index.ts`, the packaging test's consumer and the CHANGELOG; `RC_APPKEY` survives as an alias everywhere it is mentioned. `certificates/index.ts` re-exports exactly the names `src/index.ts` imported from the old file plus `roomTypeOf`. `REDACT_KEYS` is a `ReadonlySet<string>` in both its module and the gate. Task 4's `pdf.ts` path matches Task 3's split.
