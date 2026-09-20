# Research: the Royal Caribbean mobile app

Notes from mapping the phone app's gateway. This is background for maintainers,
not documentation of anything this library does, and it is **not** shipped in
the npm package. The library uses the web APIs only; see `../endpoints.md`.

## The mobile app (Royal Caribbean International, `com.rccl.royalcaribbean`)

Reverse-engineered from v1.80.0 (build 2582) on 2026-09-07, statically (jadx +
the Hermes RN bundle) and by running it in an emulator. The APK's signing
certificate names Royal Caribbean Cruises Ltd. as the organization —
Google-delivered via Aurora Store, so it is the genuine build. It is a
**hybrid**: a native Android host (package prefixes
`com.rcl.excalibur` / `com.rccl.excalibur`, ~168 Retrofit routes) that also
loads a React-Native bundle (Hermes) for the newer surfaces, casino included.

### Auth is not the website's OAuth2 grant

The web signs in with an OAuth2 password grant at
`royalcaribbean.com/auth/oauth2/access_token`. **The mobile app has its own
native login**: a JSON `POST` to `…/mobile/v3/guestAccounts/authentication/login`
(a live route — a bare POST returns `401` with an encrypted body, not an HTML
404). Older auth paths still present: `mobile/v3/guestAccounts/password/forgot`,
`…/password/securityQuestion`. It yields an access token + refresh token that
every API below carries.

The only place the OAuth2 grant survives is the **transcoding WebView** (a
Branding-Brand component that reuses the website for the cruise-booking funnel):
an injected `FetchInterceptor.js` hooks `window.fetch`, watches for
`…/auth/oauth2/access_token`, and posts the typed `username`/`password` back to
the native layer over a JS bridge. So on mobile the raw credentials are
captured by the app itself during the web-view booking flow — worth knowing,
not something to reproduce.

### The gateway and how a request is built

Base host is **`api.rccl.com`**, path shape **`/en/{brand}/mobile/v{n}/…`**
(`brand` = `royal`; staging is `stg1.api.rccl.com`, and `stg1.api.rccl.com/en/
royal/mobile/v0/cybertron/graphql` is the GraphQL URL a debug build leaks). The
appkey, endpoint and graphql-url are **not hard-coded** — the app fetches them
at launch from a config service, keyed `env-info-appkey`, `env-info-endpoint`,
`env-info-graphql-url`, `env-info-environment`, `env-info-brand`. (A debug stub
left in the binary shows the *shape* with dummy values: appkey
`5pWJ…1arh`, accountId `1234-676799-000`, brand `royal`, platform `mobile` — do
not use these, the real ones come from env-info.)

Every REST/GraphQL request carries the same header set (from
`CybertronAuthorizationInterceptor`):

| Header | Value |
| --- | --- |
| `appKey` | from env-info (per brand+env) |
| `Authorization` | `bearer <accessToken>` |
| `Access-Token` | `<accessToken>` (sent *as well as* Authorization) |
| `Account-Id` | the guest account id |
| `brand` | `royal` |
| `platform` | `mobile` |
| `accept-language` / `language` | `en` |
| `x-request-id` | a per-request UUID |
| `App-Version`, `Operating-System`, `Operating-System-Version` | client build info |

On a `401` the interceptor calls `refreshToken()` once and retries. Note this is
a **different** auth convention from every host in this doc so far: mobile sends
`Authorization: bearer` *and* `Access-Token` *and* `appKey` together, whereas
the casino hub used `Authorization: Bearer` alone and guestAccounts used a bare
`access-token`.

### Akamai Bot Manager — the reason a raw client eventually gets blocked

The app bundles Akamai's mobile bot-detection SDK (`com.cyberfend.cyfsecurity` /
`com.akamai.botman.CYFMonitor`, native `libakamaibmp.so`). It collects device
sensor/motion data, builds an encrypted `sensor_data` blob, and the gateway can
demand it. This is why scripted access to `api.rccl.com` is fragile where the
credential-free itinerary API and the casino *web* hub are not: those web
surfaces don't require the mobile sensor header. **Do not try to forge it** —
it's the whole point of the SDK. If a route starts returning challenges, that's
Bot Manager, not a bug.

### What the mobile APIs cover that the web ones don't

The native side is ~80 Retrofit service interfaces / 168 routes — most of it is
**on-board / day-of-cruise** functionality the web casino/offer APIs never
exposed. Worth knowing exists:

- **Guest & loyalty:** `mobile/v1/guestAccounts/loyalty/info`,
  `…/loyalty/enrollment`, `mobile/v2/loyaltyPrograms/status`, `guestAccounts/
  loyalty/info-new`, `loyalty/cobrand/info`. (Club Royale + Crown & Anchor, same
  data as the web `guestAccounts` call.)
- **Bookings:** `profileBookings/enriched/{vdsId}`,
  `profileBookings/searchAddGetProfileBookings`, `…/{vdsId}/manualLink`,
  `cruiseBookings/summaries/{vdsId}`, `bookingsByProductType`. Same
  `enriched`-vs-plain split noted earlier for the web.
- **Casino (RN):** the mobile casino app calls **`/loyalty/casino/offers`** and
  `/loyalty/casino/offers/{…}/redeem` and `loyalty/casino/info` /
  `content-services/casino-hub` — a *different* path than the web hub's
  `/api/casino/v2/offers/list`, but the same offers domain (constants
  `CASINO_OFFERS`, `CASINO_BOOK_REQUEST`, `playerOffer`, `redeem`). The redeem
  route is a write — never probe it.
- **Commerce (GraphQL, "Cybertron"):** `…/mobile/v0/cybertron/graphql`, Apollo
  client, ~450 schema types — Cart / Order / Offering / Price / Guest /
  MarketingTargetedOffer / MarketingCruiseFavorites / SailingOwnershipStatus.
  This is the shore-excursion/drink/dining purchase engine.
- **On-board, no web equivalent:** muster/e-mustering, virtual queue (debark),
  digital stateroom key (`connectedStateroom/digitalKeys`), in-room TV remote
  (`connectedStateroom/tvRemote`), room automation, folios (`folios`,
  `payments/folio/{id}`), dining table status, boarding passes, health/check-in
  (`core/health/*`, `guestCheckin/photo`), weather (`weather/ships/{shipCode}/
  sailDate/{sailDate}`), on-board chat (XMPP over `chat.rccl.com` +
  `guest-chat/*` pricing/purchase), Twilio voice.

### Bottom line for CruiseWatch / rc-client

Nothing here beats what we already use for the offer/pricing job: the casino
*offer catalogue* the tracker needs is the same domain the web hub serves
(`/api/casino/v2/offers/list` + `/details`), and that path needs no Akamai
sensor header, so it stays the right door. The mobile app's extra value is
purely **on-board/day-of** data (folio, muster, virtual queue, digital key),
which is out of scope. If a future feature ever needs live in-cruise data, the
native login (`mobile/v3/guestAccounts/authentication/login`) + env-info config
+ the Bot-Manager sensor blob is the path — and the sensor requirement makes it
materially harder than everything rc-client does today. Recommendation:
**don't build on the mobile gateway** unless an on-board feature demands it.
