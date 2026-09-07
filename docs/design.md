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

## Not done

- `offers` is implemented against the current endpoint but has only been
  exercised against an account with no offers. The mapping of a populated
  payload — particularly `campaignType` strings and per-offer `sailings[]` — is
  unverified.
- The Celebrity agency id (`388809`) is inferred from Royal's own requests, not
  confirmed against a Celebrity account.
- Celebrity endpoints are reachable through the same shapes but untested.
