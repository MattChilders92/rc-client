# Changelog

## 0.3.0 — 2026-09-20

**Breaking:** `Brand` is now `'R' | 'C'` — was `'RC' | 'CEL'` — and moved from
`domains/rooms.ts` to its own `src/brand.ts`. It is still exported from the
package root, same as before.

Celebrity Cruises support:

- Brand selects a **host**, not a path: `www.royalcaribbean.com` or
  `www.celebritycruises.com`. Cruise search, itinerary ports, room pricing,
  casino loyalty and casino offers all take a `brand` and follow it.
- `RcClient` takes a `brand` option (default `'R'`); `offers()` and
  `offerDetail()` resolve that brand's own loyalty number from the account
  automatically — Crown & Anchor for Royal, Captain's Club for Celebrity.
- The host and the loyalty number must belong to the same brand. Crossing them
  used to surface as a 401 that read like an expired session; it now throws
  `RcRequestError` naming the brand instead.
- `RcSailingSummary.packageCode` — the code room pricing actually wants,
  parsed from the sailing id. A cruise's master `itineraryCode` and a dated
  sailing's own package code can differ for Celebrity; pricing 404s on the
  master code.
- The guest account now also carries Captain's Club, Blue Chip (Celebrity's
  casino programme — points only, no id or tier) and Venetian Society
  (Silversea, present in the same payload; this library adds no Silversea
  endpoint).

Sign-in, the guest account and product pricing needed no brand-specific code
at all — verified working unchanged for a Celebrity ship. Celebrity's
signed-in casino paths were verified against an account with Captain's Club
but zero Blue Chip points: the empty-offers path is proven and recorded as a
fixture, but a populated Celebrity offer payload is not verified.

## 0.2.0 — 2026-09-19

First publishable release. Pre-1.0: these are private, undocumented upstream
APIs that move without notice, so the version starts under 1.0 and will be
promoted once the surface has proven stable — it will never be demoted.

- The package now ships compiled `dist/` with declarations. There is no prior
  npm release to call this breaking against, but it does change what a
  `file:` or git dependency that previously resolved the raw `.ts` source
  through `exports` now receives: compiled JavaScript instead.
- `RcClient` takes an options object: app key, user agent, timeout and retries
  (`RcConfig`). Standalone functions accept the same as an optional last
  argument, and it is a `Partial<RcConfig>` — `fetchRooms(query, { timeoutMs })`
  does not require supplying every field, matching what `RcClient` already took.
- `RoomQuery.officeCode` and `ProductQuery.regionCode` are settable.
- Every failure is an `Rc*Error`: GraphQL rejections are `RcRequestError`, a
  failed PDF download is `RcError` or `RcUnavailableError`.
- `RcClient.itineraryPorts()` and `roomTypeOf` are exported.
- `RC_APPKEY` is deprecated in favour of `RC_PUBLIC_APP_KEY`; both work.
- The mobile-app research is no longer in the shipped docs.
- A `null` or empty price or count from Royal now maps to `null` rather than
  `0`. The old helpers used a bare `Number(v)`, and `Number(null)` is `0`, so
  a cabin with no price was reported as costing nothing. Affects `RcRoom.allIn`,
  `perPerson`, `taxes`, `roomsLeft`, and an offer's `totalNights`, `roomCount`,
  `allowedNumberOfPerks`, `tradeInValue`. All were already typed `number | null`.
- `RcClient.search()` and `RcClient.itineraryPorts()` take an optional
  `config`, because a static cannot see an instance's options.
- `downloadPdf` now has a timeout (the configured `timeoutMs`) and reports a
  connection failure as `RcError`; it had no timeout before.
