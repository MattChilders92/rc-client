# Changelog

## 0.5.0 — 2026-09-24

- `fetchVoyage` — voyage-scoped sailing detail, authenticated. Where
  `listBookings`' enrichment answers only for the signed-in account's own
  reservations, and can come back empty for an account that demonstrably has
  them, this answers for a sailing whoever booked it, including sailings absent
  from the public cruise search.

  It carries the field that makes an uncatalogued sailing usable: the itinerary
  code (`08D147` for a booking whose package code was `LE08D147`, i.e. ship code
  plus itinerary code), alongside nights, sail and return dates, the itinerary
  name, a nine-stop port list with `EMBARK` / `DOCKED` / `CRUISING` / `DEBARK`
  types, both ports with their names and country codes, and `isSailingClosed` —
  which tells "Royal is not selling this" apart from "we have not collected it".

  Royal returns compact `YYYYMMDD` dates and `YYYYMMDDTHHMMSS` timestamps here,
  unlike the ISO dates elsewhere in the API. They are converted once, so callers
  are not the tenth place to reimplement it.

- `voyageId(shipCode, sailDate)` builds the identifier the endpoint wants, and
  `RcClient.voyage()` reaches it from the client like its authenticated siblings.

## 0.4.0 — 2026-09-20

**Behaviour change:** a `429` with no `Retry-After` now waits at least ten
seconds with jitter before retrying, where it previously waited 500 ms and then
one second. These APIs are reported to rate-limit by IP and to ban repeat
offenders, so answering a "slow down" with two more requests inside a second is
how a client earns a block. `Retry-After` still wins when Royal sends one, a
5xx still backs off briefly, and a `403` is still never retried. Set
`retries: 0` if you would rather handle throttling entirely yourself.

Documented what is known about rate limits, separating the operator's
first-hand report of IP bans from what was actually measured and from sibling
collectors' self-imposed pacing — and listing what nobody has established: no
quota, no ban duration, no recovery procedure. See the README and
`docs/endpoints.md`.

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
- `fetchCatalogue` — the public cruise search in one wider pass: ports, every
  dated sailing, a lead price per room class, taxes and fees, and the best
  promotion. Brand-aware like the other search calls.
- Celebrity sells six room classes, not Royal's four: `CONCIERGE` and `AQUA`
  join `RcRoomClass`. Any class the mapper did not recognise used to be
  dropped silently, losing two priced classes on every Celebrity sailing.
- Every string-union type now ships its runtime list, so a caller can iterate
  or validate without retyping the members: `ROOM_CLASSES`,
  `ROOM_CLASS_NAMES`, `ROOM_CLASS_BRAND` (which classes are Celebrity-only)
  and `PROMO_KINDS`, alongside the existing `BRANDS`, `BRAND_NAMES`,
  `SORT_FIELDS`, `PRODUCT_CATEGORIES` and `COVERAGE_OCCUPANCIES`.
- `packageCode` on `RcSailingSummary` and `RcCatalogueSailing` — the code room
  pricing actually wants, parsed from the sailing id. A cruise's master
  `itineraryCode` and a dated sailing's own package code often differ, on
  **both** brands, and pricing 404s on the master code.
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
