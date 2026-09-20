# Design notes

Why this library is shaped the way it is. The endpoint facts live in
[endpoints.md](endpoints.md); this is the reasoning.

## One package, not three copies

Three codebases each grew their own RC calls and drifted. The offers endpoint
moved and only one of them noticed. A single versioned package is the only thing
that stops that recurring, so consumers depend on it rather than copying it.

## Universal fetch, zero dependencies

The live code maintained near-duplicate Node and Deno implementations of the same
calls. Restricting the library to `fetch` and standard web APIs collapses those
into one source that runs on Node, Deno, Bun and workers unchanged. No build
step, no runtime dependency to audit.

## Header profiles are the core abstraction

Royal presents the same token three different ways depending on the API, and a
mismatch fails as `422` or a bare `404` — never `401`. This is the single most
expensive thing to get wrong and the least discoverable, so it is a first-class
module (`headers.ts`) rather than inline literals at each call site.

## Ambiguous 404s must not be silently absorbed

Royal returns `404` for both "no data for this account" and "this route is gone".
Treating them alike is exactly how a dead offers endpoint reported zero offers
for months without anyone noticing.

`request()` therefore throws `RcRouteGoneError` on 404 by default. Endpoints
where "none" is a legitimate answer opt in via `allowStatus: [404]` and surface
it in the result (`outcome: 'ok' | 'none'`), forcing the distinction to be made
deliberately at each call site.

## Occupancy sweeping belongs in the library

A room-pricing request only returns cabins that sleep the party asked for, so a
single call always omits categories — silently. Measured on one sailing: one
occupancy returns 15 categories, sweeping several returns 31. Callers should not
have to know this, so `allRooms()` does it.

## Raw payloads are kept

Every mapped object keeps `raw`. Royal adds fields without notice, and keeping
the original means a consumer can reach a new field immediately rather than
waiting for a library release and a backfill.

## Fixtures over mocks

Tests replay responses actually captured from the live API. Hand-written mocks
encode what we believe the API returns, which is precisely the belief that keeps
turning out to be wrong. `npm run capture` re-records; PII is scrubbed on the way
in because fixtures are committed.

## Return shapes

A function returns a bare array when the call cannot partially fail
(`fetchRooms`, `listBookings`), and a wrapper object when it carries an
outcome or a partial-failure count (`OffersResult.outcome`,
`ProductsResult.failed`, `SearchResult.total`).

A `null` in any `number | null` field means Royal sent no value for it — it
is never `0`. `RcRoom.allIn`/`perPerson`/`taxes`/`roomsLeft` and an offer's
`totalNights`/`roomCount`/`allowedNumberOfPerks`/`tradeInValue` are all
typed this way for exactly that reason: the coercion helpers in `coerce.ts`
return `null` for an absent or unparseable value rather than the `0` a bare
`Number(v)` would produce, because a cabin with no stated price is not a
cabin that costs nothing.

## Brand is a host decision

Royal Caribbean and Celebrity Cruises are the same company running the same
web stack twice, on two consumer sites. Their cruise search, itinerary,
room-pricing and casino APIs are each served from the brand's own host —
`www.royalcaribbean.com` or `www.celebritycruises.com` — with identical paths
and shapes. So `brand.ts` models brand as a **host** lookup (`brandHost()`),
not a path segment or a query parameter: it is the one axis every
brand-specific call actually varies on, and every call site composes its URL
from it the same way, rather than each domain inventing its own
Royal-or-Celebrity branch.

Sign-in, the guest account and the product catalogue take no brand at all,
deliberately. All three are reached through Royal's host regardless of which
brand a caller cares about, and were verified live to work unchanged for a
Celebrity account and a Celebrity ship — there is no second sign-in flow, no
per-brand account endpoint, and no per-brand product catalogue to model.
Giving them a `brand` parameter would invite a caller to pass one expecting
it to do something, when the correct behaviour is to ignore it.

The one place brand and identity intersect is the loyalty number: Crown &
Anchor and Captain's Club are different numbers on the same account, and each
only means something to its own brand's host. Crossing them is indistinguishable
from an expired session by status code alone (both are 401), which is why the
guard in `offers.ts` reads the body rather than trusting the status — the
same "don't trust the status" principle as the 404 handling above, applied to
a different code.

## Configuration, not constants

`RcConfig` exists because the values callers most need to change — the app
key, the user agent, per-request timeout and retry count — used to be module
constants, which meant changing any of them meant forking the library. The
public app key ships as the default because without it there is no sign-in:
Royal's own web client sends it on every request, and a caller who supplies
nothing still needs to reach the sign-in endpoint.

## Typed errors, no exceptions

Every thrown value is an `Rc*Error` — never a bare `Error`, a string, or
Royal's own response body. A test pins the two places that used to differ
(a GraphQL rejection and a failed PDF download) so both stay typed rather than
drifting back to an ad hoc throw.

## Verified and not

- `offers` is verified against a live payload of 13 real offers, including
  free-play perks, trade-in values and a repeated offer code, for Royal. See
  [README.md](../README.md).
- Search, itinerary ports, room pricing, casino loyalty and casino offers all
  take a `brand` and are verified against Celebrity's host. Celebrity's
  signed-in casino paths were verified against an account with Captain's Club
  but zero Blue Chip points, so the empty-offers path is proven but a
  populated Celebrity offer payload is not — see
  [README.md](../README.md#brands).
- There is no Celebrity (or Silversea) agency id anywhere in this code.
  Sign-in, the guest account and product pricing stay Royal-hosted and
  brand-free by design — see "Brand is a host decision" above — and were
  verified to return correct, brand-agnostic results for a Celebrity account.
