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
- `sailings[]` is present but **always empty**, and no separate sailings route
  exists on this version — `/v2/offers/detail`, `/v2/offers/{code}`,
  `/v2/offers/{id}/sailings`, `/v2/campaigns` and an `includeSailings` /
  `expand` parameter were all tried and none is routed.

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
