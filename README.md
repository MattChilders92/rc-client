# rc-client

A documented client for Royal Caribbean's web APIs: auth, account, casino offers
and their sailings, room pricing, onboard products, bookings, and cruise search.

Zero runtime dependencies. Uses only `fetch` and standard web APIs, so the same
source runs unchanged on Node, Deno (Supabase Edge Functions), Bun and workers.

## Install

```bash
npm install rc-client
```

Needs Node 20.3+, or any runtime with `fetch` and `AbortSignal.any` — the same
web APIs the library itself is built on. The package ships compiled JavaScript
with type declarations; there is no build step for consumers.

```ts
import { RcClient } from 'rc-client';

const rc = new RcClient({ username, password });

const account = await rc.account();
const { offers, outcome } = await rc.offers();
const rooms = await rc.allRooms({ packageCode: 'LE08D147', sailDate: '2026-11-14' });
const { products } = await rc.products({ shipCode: 'LE', startDate: '2026-11-14', endDate: '2026-11-28' });

// Search needs no account at all.
const { cruises } = await RcClient.search({ limit: 25 });
```

The client signs in on demand, reuses the token until it expires, and picks the
right auth headers per API. Callers never touch tokens.

`rc-client` takes a Royal Caribbean username and password at runtime, holds
them in memory only, and sends them only to Royal's own sign-in endpoint
(`https://www.royalcaribbean.com/auth/json/authenticate`, followed by Royal's
own OAuth2 token exchange). It never logs or persists them — there is no
logging in the library at all, and nothing is written to disk.

## Configuration

```ts
const rc = new RcClient(
  { username, password },
  { timeoutMs: 15_000, retries: 0, userAgent: 'my-app/1.0' },
);
```

The second argument is a `Partial<RcConfig>`; anything left out falls back to
the default. That includes an explicit `undefined` —
`{ appKey: process.env.RC_APP_KEY }` is safe to pass even when the variable is
unset, because each field is resolved individually rather than merged with a
spread.

| Field | Default | |
| --- | --- | --- |
| `appKey` | `RC_PUBLIC_APP_KEY` | Sent as `appkey` on guest, commerce and sign-in requests. |
| `userAgent` | a current desktop Chrome UA | Sent on every request; Royal's edge rejects obviously non-browser ones. |
| `timeoutMs` | `45_000` | Per-attempt timeout. |
| `retries` | `2` | Extra attempts after the first, for network failures and 429/5xx. |

`RC_PUBLIC_APP_KEY` is Royal's own **public** web app key — the value their own
site sends from public JavaScript on every request, and required for sign-in.
It is a client identifier, not a secret: it grants nothing on its own and is
visible to anyone who opens the site's network tab. Override it via
`RcConfig.appKey` if Royal rotates it before this library does. `RC_APPKEY` is
a deprecated alias for the same constant, kept so existing imports keep
working.

`RoomQuery.officeCode` (Royal's booking-office code, e.g. `MIA`) and
`ProductQuery.regionCode` (the catalogue region, e.g. `ALCAN`) are also
settable per call, for callers outside the US site's defaults.

## Why this exists

Royal's APIs are undocumented, inconsistent, and change without notice. Three
codebases here each grew their own copy of the same calls, drifted apart, and
independently broke. Two concrete costs:

- The casino offers endpoint has moved twice, most recently from a POST with a
  JSON body to a GET with query parameters. Every client that treated the
  resulting `404` as "no offers" reported zero for accounts that had plenty —
  this library included, until it learned to read the body rather than the
  status.
- Bookings have two endpoints, and the `enriched` one that every existing
  implementation calls returns an empty list for an account that does have
  bookings. The plain endpoint returns them.
- Room and product prices each have a headline field that is **not** the price.
  Reading `cruiseFare` instead of `pricing.amount` overstates a cabin by ~20%.

Everything learned is in **[docs/endpoints.md](docs/endpoints.md)**, next to the
symptom it produces.

## The three auth styles

The single most expensive thing to get wrong. The same token is presented three
different ways, and a mismatch returns `422` or a bare `404`, never `401`:

| Style | Headers | APIs |
| --- | --- | --- |
| guest | `access-token` + `appkey` | guestAccounts |
| commerce | `access-token` + `appkey` + `account-id` | catalog, bookings |
| casino | `authorization: Bearer` + `x-account-id` | `/api/casino/**` |
| anonymous | none | itinerary, cruise search |

`src/headers.ts` is the only place this is encoded. Research on the phone
app's separate gateway lives in the repo under `docs/research/` and is not
part of this package.

## Ambiguous 404s

Royal returns `404` both for "this account has no such data" and for "this route
no longer exists". Conflating them is what hid a moved endpoint for months.

So `request()` throws `RcRouteGoneError` on a 404 by default. An endpoint where a
404 legitimately means "none" must opt in explicitly via `allowStatus: [404]`,
and reports it in the result:

```ts
const { offers, outcome } = await rc.offers();
// outcome: 'ok'   — Royal returned a list, possibly empty
// outcome: 'none' — a 404 that was an answer about the player
// throws RcRouteGoneError — a 404 carrying the gateway's own NOT_FOUND body,
//                           which means the endpoint moved again
```

For the casino API the two are separable: its gateway answers an unrouted path
with `{"error":true,"code":"NOT_FOUND",…}`, and nothing else does.

## Occupancy

A single room-pricing request only returns cabins that sleep the party you ask
for, so it always omits categories. `allRooms()` sweeps several occupancies and
merges, keeping the first (lowest-occupancy) price for each cabin.

```ts
await rc.rooms({ packageCode, sailDate, adults: 2, children: 2 }); // one occupancy
await rc.allRooms({ packageCode, sailDate });                      // full coverage
```

## Errors

| Class | Meaning |
| --- | --- |
| `RcAuthError` | Credentials rejected. `permanent` marks the unretryable ones. |
| `RcRequestError` | 422 — nearly always the wrong auth header for that API. |
| `RcRouteGoneError` | 404 where data was expected. The endpoint probably moved. |
| `RcUnavailableError` | 429/503, retryable, carries `retryAfterMs`. |
| `RcShapeError` | Parsed, but missing what the caller needs. |

Retries are automatic for 429/500/502/503/504 with backoff and `Retry-After`.

## Standalone functions

Every domain function and header builder is also exported, for callers who
manage their own session rather than going through `RcClient`:

```ts
import { signIn, guestHeaders, request } from 'rc-client';

const session = await signIn({ username, password });
const { data } = await request('https://aws-prd.api.rccl.com/en/royal/web/v3/guestAccounts', {
  headers: guestHeaders(session),
});
```

The Instant Reward certificate tooling is a standalone module because it parses
PDFs rather than calling an API — there is no `RcClient` method for it, and it
needs no session at all:

```ts
import { discoverInstantCampaigns, downloadPdf, parseTierPages, type PageLines } from 'rc-client';

const campaigns = await discoverInstantCampaigns();
const bytes = await downloadPdf(campaigns[0]!.url);

// parseTierPages works on text positions, not PDF bytes directly: the caller
// extracts them with its own PDF library (this package carries no PDF
// dependency) and hands over one PageLines[] per tier PDF.
const pages: PageLines[] = /* extracted by the caller's PDF library */ [];
const { sailings } = parseTierPages(pages);
```

## Development

```bash
npm run typecheck
npm test                                        # replays recorded fixtures
RC_USERNAME=… RC_PASSWORD=… npm run capture      # re-record from the live API
RC_USERNAME=… RC_PASSWORD=… node scripts/smoke.ts
```

`npm run capture` writes redacted responses to `test/fixtures/`. Names, emails,
loyalty numbers and tokens are scrubbed on the way in, since fixtures are
committed. Tests replay them, so a change in Royal's response shape fails a test
with the real payload instead of reaching production.

## Verified live

Auth, account, casino loyalty, cruise search, bookings, room pricing (31
categories via occupancy sweep), products, and the public Instant Reward
certificate PDFs (discovery, download and position-based parsing).

`offers` — a live payload of 13 real offers, including free-play perks,
trade-in values and a repeated offer code. `RcOffer.sailings` is always empty
from the list; `offerDetail(code, playerOfferId)` returns the grant with its
sailings — ship, port, date, nights, itinerary and eligible room categories —
verified at 490 sailings on one offer.

See [docs/endpoints.md](docs/endpoints.md) for every endpoint and its quirks,
and [CHANGELOG.md](CHANGELOG.md) for what changed release to release.

## Caveats

These are undocumented private APIs, reverse-engineered from Royal's own web
client — not a published contract, and they change without notice. The casino
offers endpoint alone has already moved twice. This project is unaffiliated
with Royal Caribbean; use it against your own account.
