# rc-client

A documented client for Royal Caribbean's web APIs: auth, account, casino offers
and their sailings, room pricing, onboard products, bookings, and cruise search.

Zero runtime dependencies. Uses only `fetch` and standard web APIs, so the same
source runs unchanged on Node, Deno (Supabase Edge Functions), Bun and workers.

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

## Why this exists

Royal's APIs are undocumented, inconsistent, and change without notice. Three
codebases here each grew their own copy of the same calls, drifted apart, and
independently broke. Two concrete costs:

- The casino offers endpoint moved. Older code still calls the dead route, which
  answers `404` — and because it also treats `404` as "no offers", it silently
  reported zero offers instead of failing.
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

`src/headers.ts` is the only place this is encoded.

## Ambiguous 404s

Royal returns `404` both for "this account has no such data" and for "this route
no longer exists". Conflating them is what hid a moved endpoint for months.

So `request()` throws `RcRouteGoneError` on a 404 by default. An endpoint where a
404 legitimately means "none" must opt in explicitly via `allowStatus: [404]`,
and reports it in the result:

```ts
const { offers, outcome } = await rc.offers();
// outcome: 'ok'   — Royal returned a list
// outcome: 'none' — Royal answered 404/422: no offers on this account
// throws RcRouteGoneError — the route moved again
```

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

## Status

Verified live: auth, account, casino loyalty, cruise search, bookings, room
pricing (31 categories via occupancy sweep), products.

`offers` is implemented against the current endpoint and returns
`outcome: 'none'` for the account tested, which has no active offers. The mapping
has not yet been exercised against a payload containing real offers.
