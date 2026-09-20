# rc-client — Celebrity Cruises support

**Date:** 2026-09-20
**Status:** approved for planning

## Problem

`rc-client` is a Royal Caribbean client with one vestigial nod to Celebrity: a
`Brand = 'RC' | 'CEL'` type that only room pricing reads. Everything else is
hardcoded to Royal — the search host and its `brand: 'R'` header, the casino
offers host, the loyalty number the offers API is given. Meanwhile bookings has
its own unrelated `brand?: 'R' | 'C'`. Three spellings of one concept, and no
path from "I have a Celebrity sailing" to a price or an offer.

## What was verified live, before designing

Against the owner's own account (Crown & Anchor EMERALD, Club Royale PRIME,
Captain's Club SELECT, Blue Chip 0 points):

| Fact | Evidence |
| --- | --- |
| Celebrity search works anonymously | `celebritycruises.com/graph` + `brand: C` → 656 sailings |
| Celebrity room pricing works at the URL already in `rooms.ts` | 200 with real cabins |
| Celebrity offers work on the Celebrity host with the Captain's Club number | 200, `0 offers` |
| Crown & Anchor number on the Celebrity host | **401 `Unauthorized - invalid loyalty id`** |
| Captain's Club number on the Royal host | **401** |
| Royal offers, unchanged | 9 offers |
| Product pricing for a Celebrity ship, unchanged | 39 products, 0 failed categories |
| Sign-in and account are brand-agnostic | one Royal-path call returns every brand's loyalty |

**The rule the library must encode:** the casino host and the loyalty number
must belong to the same brand. Crossing them is a 401, not an empty list.

**Rork's open question is moot.** Its unverified Celebrity agency id `388809`
belongs to the retired `POST /v2/offers/merged`. The current
`GET /v2/offers/list` carries no agency id; brand is host plus loyalty number.

**Two facts no existing code has.** Blue Chip is
`celebrityBlueChipLoyaltyIndividualPoints` / `...RelationshipPoints` — points
only, no id and no tier field, so a schema expecting an id cannot be filled. And
the account carries a third brand entirely: Venetian Society (Silversea), with
an id, tier, next tier and points.

**The code trap.** Celebrity's search returns a master itinerary code, but the
bookable package code is inside `sailings[].id` (`<packageCode>_<date>`) and can
differ: itinerary `RF4BH330` vs sailing `RF4BH328_2026-11-16`. Room pricing 404s
on the itinerary code and succeeds on the package code. For Royal the two
coincide, which is why this never surfaced.

## Goal

A caller picks a brand once and every call that has a brand dimension follows,
with a typed error rather than a 401 when a combination cannot work.

## Non-goals

- **A populated Celebrity offer payload.** This account has zero Blue Chip
  points, so Celebrity legitimately returns none. The empty path is verified;
  the populated mapping is not, and the docs must say so rather than imply it.
- Silversea. Venetian Society is surfaced on the account because it is in the
  payload we already fetch; no Silversea endpoint is added.
- Celebrity stateroom category codes (AquaClass, Concierge, The Retreat). The
  library returns Royal's category codes as given and does not interpret them
  for either brand.
- A ship-code table. The library has never carried one for Royal either.
- Changing the retired agency-id endpoint.

## 1. One `Brand`, spelled as the APIs spell it

`'R' | 'C'`, in a new `src/brand.ts`. This replaces `Brand = 'RC' | 'CEL'`,
which is a **breaking change** — hence `0.3.0`. It is safe in practice: the sole
consumer, CruiseWatch, never imports `Brand` and never passes `brand` to
`fetchRooms`; it only reads `brand` off a booking and writes the literal `'R'`
in its own scripts.

```ts
export type Brand = 'R' | 'C';
export const BRANDS: readonly Brand[] = ['R', 'C'];
export const BRAND_NAMES: Record<Brand, string> = {
  R: 'Royal Caribbean', C: 'Celebrity Cruises',
};
/** The consumer site a brand's anonymous and casino APIs are served from. */
export function brandHost(brand: Brand): string;   // www.royalcaribbean.com | www.celebritycruises.com
```

`bookings.ts` already uses `'R' | 'C'`; it switches to importing `Brand` and
stops declaring its own. No behaviour change there.

## 2. What is brand-aware, and what is not

| Call | Brand-aware | How |
| --- | --- | --- |
| `searchCruises`, `fetchItineraryPorts` | yes | host + `brand` header |
| `fetchRooms`, `sweepOccupancy` | yes | host (already, under the old spelling) |
| `listOffers`, `fetchOfferDetail` | yes | host + the brand's loyalty number |
| `fetchCasinoLoyalty` | yes | host + loyalty number |
| `listBookings` | yes | already, via its `brand` query parameter |
| `signIn`, `fetchAccount` | **no** | identity is federated; the Royal path returns every brand |
| `fetchProducts`, `fetchCategory` | **no** | verified working for a Celebrity ship unchanged |
| certificates | **no** | Royal's Club Royale PDFs only |

Every brand-aware standalone function takes `brand` on its existing query or
params object where it has one, otherwise as an optional trailing argument
before `config`, defaulting to `'R'`. Nothing changes for a caller who passes
nothing.

## 3. The loyalty number must match the brand

`RcAccount` gains the numbers the offers API needs, as a lookup:

```ts
/** The casino loyalty number each brand's offers API keys on. */
loyaltyIdFor(brand: Brand): string | null
```

backed by `crownAndAnchorId` for `R` and `captainsClubId` for `C`.

`RcClient` takes a brand (`new RcClient(init, { brand: 'C' })`, default `'R'`),
resolves the right number from the account, and uses the matching host. A caller
who passes a loyalty number explicitly gets it used as given.

**The guard.** When the account has no number for the requested brand,
`rc.offers()` returns `outcome: 'none'` rather than calling and being refused —
the existing shape for "nothing to ask about". When a caller passes a number
that belongs to a different brand, we cannot tell from the number alone, so the
401 is translated: `RcRequestError` whose message names the likely cause, rather
than the bare `RcAuthError` a 401 produces today.

## 4. The account payload

`RcAccount` gains three programmes beside the existing two, all optional and
null-safe, named as the payload names them:

- `captainsClub` — id, tier, next tier, individual and relationship points,
  remaining points, tracker percentage
- `blueChip` — individual and relationship points **only**; a comment records
  that Royal exposes no id or tier for it, so consumers cannot key on one
- `venetianSociety` — id, tier, next tier, points, remaining points

Existing fields keep their names and meanings.

## 5. The package-code trap

`RcSailingSummary` gains `packageCode: string | null`, parsed from the
`sailings[].id` prefix, with the id itself kept. The JSDoc states plainly that
this is what room pricing wants, that it can differ from the itinerary code, and
that Celebrity is where they diverge. Nothing is renamed.

## Testing

- Unit tests for `brandHost`, `loyaltyIdFor`, the package-code parse (including
  a Celebrity id whose prefix differs from the itinerary code), and the
  mismatch guard, all with stubbed `fetch` — no network, no credentials.
- New fixtures captured live and redacted through the existing gate:
  a Celebrity cruise search, Celebrity rooms, the Celebrity empty-offers
  envelope, and an account payload carrying all five programmes.
- The existing 72 tests and all three gates keep passing.
- CruiseWatch must stay green, verified against the built package.

## Judgment calls

1. **`'R' | 'C'` over `RC`/`CEL`** — chosen by the owner. It matches what the
   wire carries and collapses three spellings into one.
2. **`0.3.0`**, not `1.0.0`. Still pre-1.0, still correctable.
3. **Products and account stay brand-free** because they are verified to work
   for both. A `brand` parameter there would be decoration.
4. **The empty Celebrity offers response ships as a fixture.** It is the honest
   record of what this account returns and it pins the empty path.
