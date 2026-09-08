# Royal Caribbean endpoint reference

Everything below was verified against the live APIs. Where a fact cost real
debugging time, the symptom is recorded next to it — Royal's failure modes are
misleading often enough that the symptom is the useful part.

## Auth

Two steps, and **not** the OAuth2 password grant.

```
POST https://www.royalcaribbean.com/auth/json/authenticate
     headers: x-openam-username, x-openam-password,
              accept-api-version: resource=2.0, protocol=1.0
     body:    none — sending one makes it fail
     →        { tokenId }

POST https://aws-prd.api.rccl.com/v1/oauth2-authorize/en/royal/web/v1/authorize
     headers: appkey
     body:    { client: "login-component", tokenId }
     →        { access_token, id_token, expires_in }
```

`id_token` carries `sub` (the account uuid every other API wants) and often
`vdsid`.

A password grant also exists at `/auth/oauth2/access_token` and returns a token
that some APIs accept. Do not use it: the claims differ only by `grant_type`, but
it is a different grant and there is no reason to prefer it.

`appkey` is `hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm` — Royal's own public web key.

## Auth header styles

The same token is presented **three different ways**. Guessing wrong returns 422
or a bare 404, never 401.

| Style | Headers | Used by |
| --- | --- | --- |
| guest | `access-token` + `appkey` | guestAccounts |
| commerce | `access-token` + `appkey` + `account-id` | product catalog, bookings |
| casino | `authorization: Bearer` + `x-account-id` (+ `x-loyalty-id`) | `/api/casino/**` |
| anonymous | none | itinerary API, cruise search |

The casino API validates its own schema and **names the header it is missing** in
the response body, which makes it the easiest of the four to debug.

## Account

```
GET aws-prd.api.rccl.com/en/royal/web/v3/guestAccounts/{accountId}     [guest]
```

Everything is under `payload`. Loyalty fields are flat with long names, not
nested per programme:

- `loyaltyInformation.clubRoyaleLoyaltyTier`, `...LoyaltyIndividualPoints`
- `loyaltyInformation.crownAndAnchorSocietyLoyaltyTier`, `...IndividualPoints`
- `loyaltyInformation.crownAndAnchorId` — the number the casino API keys on
- `consumerId` is top-level

An absent tier is the **string `"NONE"`**, not null.

## Casino loyalty

```
GET www.royalcaribbean.com/api/casino/v1/loyalty-data                  [casino]
```

Returns `casinoLoyaltyId` (distinct from the Crown & Anchor number), tier, points
and the annual evaluation window. Better than the guest-account loyalty block,
and it is what the offers page itself uses.

Note the path shape: **the version comes first**, `/api/casino/v1/<resource>`.

## Casino offers

```
GET www.royalcaribbean.com/api/casino/v2/offers/list                   [casino]
    ?page=1 &limit=100 &sortBy=offer.reserveByDate &sortDirection=asc
    headers: x-account-id, x-loyalty-id (Crown & Anchor number),
             x-environment-marker, x-environment-ship-code (both empty ashore)
```

**A GET with query parameters.** All four are required; omitting them returns a
`VALIDATION_ERROR` that lists the accepted `sortBy` values, which is the most
convenient documentation Royal publishes:

    sailDate · createdAt · offer.offerCode · offer.offerType ·
    offer.reserveByDate · offer.startDate · offer.sailByDate ·
    offer.tradeInValue · offer.campaign.campaignType

Response envelope: `{ firstName, lastName, email, loyaltyId, offers[],
totalOffers, totalPages, pageNumber }`. Each entry keeps the familiar
`campaignOffer` shape.

- Paginated — read `totalPages` and loop.
- **Free play is not a field.** It is in the perk *name* ("Bonus FP $75"); the
  perk codes on this version are opaque (`TBK6`), so a code-only `FP<n>` parse
  returns nothing.
- **One offer code arrives several times, once per redeemable grant.** Royal
  now issues the same offer repeatedly: a live payload repeated `26TOR603`
  three times, identical but for `playerOfferId`, and each is separately
  redeemable. `playerOfferId` is the identity of a row; the offer code is only
  how they group for display. Anything keyed on the code alone both undercounts
  what the player holds and cannot be upserted.
- **The offer code is `campaignCode` + a variant suffix** (`26BAF3` + `04`),
  exposed as `RcOffer.variant`. The suffix is a per-campaign marketing segment,
  **not the Club Royale loyalty tier** — one loyalty tier receives different
  suffixes across campaigns (a Prime account carried `02`, `03` and `04`), so
  the two are not 1:1. The list endpoint is player-scoped and ignores every
  filter, and no campaign, tier, catalogue or all-offers route exists (probed
  exhaustively), so a variant you do not hold cannot be fetched.
- `sailings[]` is present in the list but **always empty**. A grant's sailings
  come from the details endpoint below.

### Offer details (sailings)

```
GET www.royalcaribbean.com/api/casino/v2/offers/details                [casino]
    ?offerCode= &playerOfferId= &limit=1 &page=1
    &sortBy=offer.reserveByDate &sortDirection=asc &digitalRedemption=true
```

**Note the plural — `/details`.** `/detail` is unrouted, and that one letter
hid this endpoint through a full day of enumeration; the path only surfaced by
reading the hub's authenticated offer-page chunk, where it is built as
`${base}/v2/offers/details`. The bearer header alone is sufficient — no cookie
session is needed, despite the hub *pages* being cookie-gated.

Same envelope as `list`, holding exactly one offer with `campaignOffer.sailings`
populated (490 rows on a wide offer) and offer-level fields the list omits:
`startDate`, `sailByDate`, `roomCount`, `bookingFeeAmount`,
`allowedNumberOfPerks`, `sailingInclusionMode`, `exclusionList`, `tags`.

Each sailing: `id` (`AL_MIA_2026-11-01`), `shipCode`/`shipName`,
`departurePort {code,name}`, `sailDate`, `totalNights`, `itineraryCode/Name/
Description`, `sailingType.name`, `groupId` (what the room-pricing API keys
on), `roomTypeList[{code,name}]` — the eligible categories, e.g. `BALCONY`,
`INTERIORGTY` — and `isGTY` / `isGOBO` / `isCOMP` / `isDOLLARSOFF` +
`DOLLARSOFF_AMT`. `perks` and `nextCruiseBonus` were null on every sailing seen.

Sailings can differ between grants of one offer code, so query per
`playerOfferId`, not per code.

### This endpoint has now moved twice

    1. POST /api/casino/casino-offers/v1   gone
    2. POST /api/casino/v2/offers/merged   gone
    3. GET  /api/casino/v2/offers/list     current

Each move was silent and each broke every client that read the resulting 404 as
"this player has no offers" — including this library, which reported zero for an
account holding thirteen.

**Tell the two apart by the body, not the status.** `/api/casino` proxies to an
internal gateway that answers an unrouted path with exactly:

```json
{"error":true,"code":"NOT_FOUND","message":"Not Found","requestId":"…"}
```

That body means the route moved, and `listOffers` throws `RcRouteGoneError` for
it. Any other 404 is an answer about the player and becomes `outcome: 'none'`.

### Finding the route again, when it moves

`GET /api/casino/health` returns `{status, hostname, version, redis}`, and every
real route answers with JSON while an unrouted one returns either the gateway
body above or the site's HTML 404. That makes the path space enumerable: probe
candidates and keep whatever is neither. `GET /api/casino/v1/rewards/eligibility`
is also worth reading first — `guestNotEligbleReason: "ActiveOffersPresent"`
proves an account *has* offers, which turns "is this broken?" into a fact.

The hub's own JavaScript names its bases. `https://www.royalcaribbean.com/club-royale/offers`
redirects to sign-in but still embeds the config in its flight payload:

```json
"endpoints":{"casinoApiExternal":"https://www.royalcaribbean.com/api/casino",
             "casinoApiInternal":"https://rcg-casino-guesthub-api-rcl-a.private.prd.ecom.rccl.io",
             "casinoOps":"https://www.royalcaribbean.com/api/casino",
             "digital":"https://api.rccl.com/en/royal/web"}
```

Route chunks for signed-in pages are not served anonymously, so the bundle shows
the shared calls (`/v1/loyalty-data`, `/v1/partners`, `/v1/guest-account/loyalty`)
but not the offers one.

## Room pricing

```
GET www.royalcaribbean.com/itinerary/api/v1/sailings              [anonymous]
    ?packageCode= &sailDate= &adults= &children=
    &countryCode=USA &currencyCode=USD &languageCode=en &officeCode=MIA
```

A real JSON API needing **no credentials**. There is never a reason to scrape the
room-selection web page, whose prices sit in a Next.js flight payload behind
Akamai.

Two traps:

- **Occupancy scopes the result.** Royal only returns cabins that sleep the party
  you ask for, so one request always omits categories. `sweepOccupancy` cycles
  guest counts and merges. Guest *count* is what matters, not the adult/child
  split — `4a+0c` and `2a+2c` return identical sets.
- **`pricing.amount` is the price; `invoice.cruiseFare` is not.** The latter is
  the pre-discount list fare and reads roughly 20% high.

Celebrity uses the same shape at `celebritycruises.com/itinerary/api/v1`.

## Product catalog

```
POST aws-prd.api.rccl.com/en/royal/web/commerce-api/catalog/v2
     /{shipCode}/categories/{category}/products                    [commerce]
     ?startDate=YYYYMMDD &endDate=YYYYMMDD &currentPage= &pageSize=
     &currencyIso=USD &regionCode=ALCAN
     body: { textSearch: null, sortKey: "rRank-asc", filterFacets: null }
```

Categories: `beverage`, `shorex`, `internet`, `dining`.

- Dates are **compact** here (`20261114`) and ISO everywhere else.
- Anonymous requests get `401 COMMONS-0001 "The API key header is required"`
  even with the appkey — a signed-in account is required.
- Price fields are `lowestAdultPrice` (what you pay) and `msrpAdultPrice` (list).
  There is no `price.value`.

## Bookings

Two endpoints, and they are **not** interchangeable:

```
GET aws-prd.api.rccl.com/v1/profileBookings/{accountId}?brand=R          [commerce]
GET aws-prd.api.rccl.com/v1/profileBookings/enriched/{accountId}?brand=R [commerce]
```

Also send `req-app-id: Royal.Web.CustomerJourney`, `req-app-vers: 1.0.7` and
`vds-id: {accountId}` — the bookings service expects the customer-journey app
identity.

The list is `payload.profileBookings`, not `payload.bookings`.

**`enriched` can return an empty array for an account that demonstrably has
bookings.** Verified live: a real upcoming reservation appears under the plain
path and is absent from `enriched`, with `status: 200, errors: []` in both cases.
Every existing implementation calls only `enriched`, so any of them would report
that account as having no bookings at all.

Use the plain path to learn *which* bookings exist, and treat enrichment as
best-effort detail on top.

The link record's own sailing fields are placeholders — a genuine 2026 booking
comes back as ship `NC` sailing `20390707` for 1 night — so `shipCode`,
`sailDate` and `numberOfNights` must not be trusted unless enrichment supplied
them. Dates here are `YYYYMMDD`, not ISO.

No per-booking detail endpoint was found: `/v1/bookings/{id}`,
`/v1/guestBookings/{id}`, `/en/royal/web/v{1,3}/bookings/{id}` and
`/v1/profileBookings/{accountId}/{bookingId}` are all absent. The commerce
`calendar/v1/{shipCode}/orderHistory/{orderEntryId}` endpoint exists but needs an
`orderEntryId` that nothing else returns.

## Cruise search

```
POST www.royalcaribbean.com/graph                                  [anonymous]
     operationName: cruiseSearch_Cruises
```

GraphQL, no credentials. Requires the brand/country/currency/office headers the
site sends, plus an `x-session-id` uuid (any valid one works).

GraphQL reports failures **inside a 200** in an `errors[]` array, so the status
code alone never tells you it worked.

## The rest of the casino hub API

The hub's bundles reference exactly fourteen casino routes. Beyond the four this
library implements, here is what the others are, verified against the code that
calls them and — for the reads — against live responses. **The writes are listed
so nobody probes them by accident**: several create real state on the account.

| Route | Method | Kind | What it does |
| --- | --- | --- | --- |
| `/v1/loyalty-data` | GET | read | Casino profile, tier, points, window. Implemented. |
| `/v2/offers/list` | GET | read | Offers. Implemented. |
| `/v2/offers/details` | GET | read | One grant with sailings. Implemented. |
| `/v1/rewards/eligibility` | GET | read | Rewards Match eligibility. Live: `guestEligibleForRewardsMatch:false, guestNotEligbleReason:"ActiveOffersPresent"` — you become eligible only when you hold **no** active offers. |
| `/v1/partners` | GET | read | The Rewards Match registry: **40 land-based casinos** (Rampart Rewards, …) with `validationRules`, `partnershipType`, `tiers`, `abbreviationCode`. No account context. |
| `/v1/partners/player` | GET | read | Partner programmes linked to this player (empty for the account tested). |
| `/v1/partners/player` | POST | **write** | Link a partner programme. |
| `/v1/partners/player/remove` | POST | **write** | Unlink one. |
| `/v1/rewards/upload-url` | GET→S3 PUT | **write** | Presigned upload for a competitor statement (Rewards Match). |
| `/v1/rewards/generate-offer` | POST | **write** | Generates a Rewards Match offer. |
| `/v1/booking-request` | POST | **write** | **Redeems an offer on a sailing.** GET is unrouted. |
| `/v1/booking-request/cancel` | POST | **write** | Cancels a redemption (`{bookingRequestId, offerCode}`). |
| `/v1/guest-account/loyalty` | PUT | **write** | Updates the guest's loyalty numbers. |
| `/v1/guest-account/loyalty/enrollment` | POST | **write** | Enrols in Club Royale. |

Also present only as a react-query key (`loyalty-number/lookup`); its fetcher is
in an enrollment chunk not served outside that flow.

### Redemptions in progress are already in the list payload

Each offer carries `bookingRequest: []`. The hub reads a non-empty array as a
redemption **in progress** (`errorType: "IN_PROGRESS"`, and it hides the
redeem button). So "is this grant being used right now" needs no extra call —
read the array. Shape unobserved: every grant seen was `[]`.

### An offer sailing's `itineraryCode` is the room-pricing `packageCode`

Verified live on four sailings: `rooms({ packageCode: sailing.itineraryCode,
sailDate })` returns the sailing's cabins and prices (11–16 categories each).
That makes **every offer sailing priceable** with the itinerary API this library
already wraps: the cash price of the room type an offer comps, and the upgrade
cost from it, per sailing. A sailing inside roughly a week of departure returns
zero rooms — it is closed to online booking, not a bad code.

### Deep link to a sailing's itinerary page

The hub builds it as
`https://www.royalcaribbean.com/itinerary/{nights}-night-{itinerary}-from-{port}-on-{ship}-{ITINERARYCODE}`
with lowercase-hyphen slugs, only the **first word** of the port, and the code
uppercased. `…/3-night-ensenada-cruise-from-los-on-quantum-of-the-seas-QN03X037`
resolves to the real page. Ships: `…/cruise-ships/{ship-slug}`.

## Instant Reward Certificates (public PDFs)

A second class of casino offer that appears in **no player API**. Royal
publishes them as PDFs under a predictable path, one campaign a month per
region, each linking to one PDF per tier. Because they are public, this is the
one offer class where the whole catalogue — every tier — is visible.

```
campaign  https://www.royalcaribbean.com/content/dam/royal/resources/pdf/casino/offers/{YY}{MM}{suffix}.pdf
tier      …/offers/{YY}{MM}{suffix}{tier}.pdf
```

- Suffixes seen: `A` North America 3–5 nights, `C` North America 6+, `D`
  Europe, `CHN` China; the old platform also carried `O`, `S`, `P`, which did
  not exist for Jul–Sep 2026. Tiers: `VIP1`, `VIP2`, `01`, `02`, `02A`, `03`,
  `03A`, `04` … `10`, with point thresholds printed on the campaign page
  (70,000 … 400).
- **Discovery is by asking.** `candidateCampaigns()` generates the codes for
  −1 … +2 months × every suffix (28 URLs); `discoverInstantCampaigns()` HEADs
  them in batches of seven. A missing month is normal. Verified live: Jul, Aug
  and Sep 2026 published, Oct not yet.
- **The campaign PDF** is one page: each offer code followed by "{n} Points",
  and a hyperlink annotation per tier PDF (every link appears twice). Codes
  are taken from link filenames, points from the text, with `DEFAULT_TIERS` as
  the fallback. Royal's links once carried a `CHNN` typo; it is normalised.
- **A tier PDF** is a table repeated across pages (24 pages for `2609A04`):
  `Offer Code · Ship · Departure Port · Sail Date · Itinerary · Stateroom Type ·
  Offer Type · Next Cruise Bonus · Next Cruise OBC`. The last column is new
  since the old platform's parser. Values look like `Spectrum Of The Seas®`,
  `September 1, 2026`, `Balcony - GTY`, `Cruise Fare For 2 Guests` (or `For 1
  Guest`: the second guest pays), `$250 FreePlay`, `$50`.
- **Layouts vary by tier.** Tier 10 merges the bonus label into the stateroom
  header (`Next Cruise Bonus Stateroom Type`) and has no FreePlay column;
  `2609D02A` labels the stateroom column just `Offer` and carries no offer-type
  column at all (its terms line says who pays). `HEADER_KEYS` maps every
  spelling seen so far.
- **Parse by position, not by tabs.** Every cell is its own text item, and
  Royal centres each cell under its header, so a cell belongs to the header
  whose centre is nearest its own (a ship name starts left of the `Ship`
  header; a left-edge rule shifts every column). The old parser split on tab
  characters and depended on the extractor's join behaviour. This library
  carries no PDF dependency: callers hand `parseTierPages()` the per-page
  lines of `{x, w, str}` cells (CruiseWatch does that with pdf.js).
- **Row identity** is `instantSailingKey()`: ship | date | stateroom | offer
  type. Stores should key on the same function so their conflict target can
  never drift from the parser's dedupe.

## The mobile app (Royal Caribbean International, `com.rccl.royalcaribbean`)

Reverse-engineered from v1.80.0 (build 2582) on 2026-09-07, statically (jadx +
the Hermes RN bundle) and by running it in an emulator. The APK is signed
`CN=Roberto Aleman Jr, O=Royal Caribbean Cruises Ltd.` (SHA-256
`bc490382…92e9aa`) — Google-delivered via Aurora Store, so it is the genuine
build. It is a **hybrid**: a native Android host (package prefixes
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
