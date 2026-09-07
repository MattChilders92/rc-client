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
POST www.royalcaribbean.com/api/casino/v2/offers/merged                [casino]
     headers: x-account-id, x-loyalty-id (Crown & Anchor number)
     body:    { sortBy: "offer.reserveByDate", sortDirection: "asc",
                limit: 100, approvedAgencyIds: ["109638","388809"],
                page, digitalRedemption: true }
```

One endpoint, two modes: adding `offerCode` and `playerOfferId` to the same body
returns that one offer with `sailings[]` populated.

- Paginated — read `totalPages` and loop.
- Agency ids select brand: `109638` Royal, `388809` believed Celebrity
  (unconfirmed against a Celebrity account).
- **Free play is not a field.** It is encoded in the perk code (`FP100`) or the
  perk name ("Bonus FP $100"). Largest perk wins.
- `404` and `422` mean the account has no offers. This library reports that as
  `outcome: 'none'` rather than an empty array, because the two are different.

Replaces `POST /api/casino/casino-offers/v1`, which now returns 404 for every
input including an empty loyalty id. Code still calling it silently receives
nothing.

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
