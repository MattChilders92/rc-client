# Changelog

## 1.0.0 — 2026-09-19

First publishable release.

- **Breaking:** the package ships compiled `dist/` with declarations. Consumers
  that resolved the raw `.ts` source through `exports` now get JavaScript.
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
