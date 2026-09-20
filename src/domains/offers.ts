import type { RcSession } from '../auth/index.ts';
import { RcRouteGoneError } from '../errors.ts';
import { casinoHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { num, str } from '../coerce.ts';
import { DEFAULT_CONFIG, type RcConfig } from '../config.ts';

/**
 * Club Royale casino offers.
 *
 * `GET /api/casino/v2/offers/list`, paged, with the player identified entirely
 * by headers — `x-account-id`, `x-loyalty-id` and the Bearer token. The query
 * string carries only paging and sort.
 *
 * This is the third address for the same data:
 *
 *   1. `POST /api/casino/casino-offers/v1`   — gone
 *   2. `POST /api/casino/v2/offers/merged`   — gone (a body-carrying POST)
 *   3. `GET  /api/casino/v2/offers/list`     — current
 *
 * Each move was silent, and each broke every client that read the resulting 404
 * as "this player has no offers". See `outcome` for how this one refuses to
 * make that mistake again.
 *
 * @see docs/endpoints.md
 */

const BASE = 'https://www.royalcaribbean.com/api/casino';
const LIST = `${BASE}/v2/offers/list`;
/**
 * The same envelope as `list`, for one grant, with `sailings` populated and the
 * offer-level detail fields present. Note the plural: `/details`. `/detail` is
 * unrouted, and that single letter hid this endpoint for a full day of probing.
 */
const DETAILS = `${BASE}/v2/offers/details`;

/** Rejected input is answered with a schema error listing these, which is how we know them. */
export const SORT_FIELDS = [
  'sailDate', 'createdAt', 'offer.offerCode', 'offer.offerType', 'offer.reserveByDate',
  'offer.startDate', 'offer.sailByDate', 'offer.tradeInValue', 'offer.campaign.campaignType',
] as const;
/** One of `SORT_FIELDS` — the only values Royal's schema check will accept for `sortBy`. */
export type OfferSortField = (typeof SORT_FIELDS)[number];

const PAGE_LIMIT = 100;

/** One line item on an offer, e.g. free play or onboard credit. */
export interface RcPerk {
  /** Opaque internal code (`TBK6`), not the free-play amount. */
  perkCode: string;
  /** Where the value actually is — "Bonus FP $75". */
  perkName: string | null;
  type: string | null;
}

/** One sailing an offer can be redeemed on, from `GET /v2/offers/details`. */
export interface RcOfferSailing {
  /** Royal's own key, `AL_MIA_2026-11-01`: ship, departure port, sail date. */
  id: string | null;
  shipCode: string | null;
  shipName: string | null;
  departurePort: { code: string | null; name: string | null } | null;
  sailDate: string | null;
  totalNights: number | null;
  itineraryCode: string | null;
  itineraryName: string | null;
  itineraryDescription: string | null;
  /** Marketing name for the sailing, e.g. "7 Night Eastern Caribbean Perfect Day". */
  sailingType: string | null;
  /** The booking group id the itinerary/room-pricing API keys on. */
  groupId: string | null;
  /** Room categories this offer covers on this sailing, e.g. `BALCONY`, `INTERIORGTY`. */
  roomTypes: { code: string; name: string | null }[];
  isGuarantee: boolean;
  /** "GOBO": buy-one-get-one on a second guest. */
  isBogo: boolean;
  isComplimentary: boolean;
  isDollarsOff: boolean;
  dollarsOff: number | null;
  nextCruiseBonusPerkCode: string | null;
  nextCruiseBonus: unknown;
  perks: unknown;
  raw: unknown;
}

/**
 * The offer as `GET /v2/offers/details` returns it: everything the list carries,
 * plus the fields only the detail exposes, plus `sailings` populated.
 */
export interface RcOfferDetail extends RcOffer {
  startDate: string | null;
  sailByDate: string | null;
  bookingFeeAmount: number | null;
  roomCount: number | null;
  allowedNumberOfPerks: number | null;
  /** How `sailings` should be read against `exclusionList`, as Royal reports it. */
  sailingInclusionMode: string | null;
  exclusionList: unknown;
  descriptionList: string[];
  tags: string[];
  digitalRedemptionOnly: boolean;
}

/** One casino offer as `listOffers` returns it — `sailings` is always empty here; see `RcOfferDetail`. */
export interface RcOffer {
  offerCode: string;
  /**
   * Identifies one **redeemable grant**, not one offer. Royal issues the same
   * offer several times to a player — a live payload carried `26TOR603` three
   * times, identical in every other field — and each is separately redeemable.
   * This, not `offerCode`, is the identity of a row.
   */
  playerOfferId: string | null;
  campaignCode: string | null;
  campaignName: string | null;
  campaignType: string | null;
  /** The offer's own short name, distinct from the campaign's. */
  name: string | null;
  /** e.g. `{ code: 'COMP', name: 'Complimentary' }`. */
  offerType: { code: string | null; name: string | null } | null;
  /**
   * The campaign variant this grant is: the offer code with the campaign code
   * removed (`26BAF304` → `04`). **Not the Club Royale loyalty tier.** Royal
   * assigns variants per campaign from its own segmentation, so one loyalty tier
   * receives different variant numbers across campaigns and the two do not map
   * 1:1. Treat it as an opaque per-campaign label, not a rank.
   */
  variant: string | null;
  description: string | null;
  /** Parsed out of the perk names; Royal does not return it as a field. */
  freePlay: number | null;
  tradeInValue: number | null;
  bookBy: string | null;
  perks: RcPerk[];
  /**
   * Always empty from the list endpoint, which returns the key unfilled. Use
   * `fetchOfferDetail` / `RcClient.offerDetail` to get a grant's sailings.
   */
  sailings: RcOfferSailing[];
  status: string | null;
  /**
   * What Royal records against a grant once it is used. Shape unobserved: every
   * grant on the account tested is unredeemed and this is null throughout, so it
   * is passed through rather than interpreted.
   */
  redeemInfo: unknown;
  raw: unknown;
}

/** What `listOffers` returns: every offer on the account, plus enough to tell a genuinely empty account from a moved route. */
export interface OffersResult {
  offers: RcOffer[];
  /**
   * `ok` — Royal returned a list, which may legitimately be empty.
   * `none` — Royal answered 404 with a body that was not the router's, so the
   * route exists but holds nothing for this player.
   *
   * A 404 carrying the router's `NOT_FOUND` body is **not** reported here: it
   * throws `RcRouteGoneError`, because that is the endpoint moving again rather
   * than an empty account. Blurring the two hid the last two moves.
   */
  outcome: 'ok' | 'none';
  totalOffers: number;
  /** The name Royal has on the account — useful for confirming the right login. */
  player: { firstName: string | null; lastName: string | null; loyaltyId: string | null };
}

// Rounds to the nearest integer rather than truncating toward zero, unlike
// the shared `int` — these fields are already whole numbers from Royal, so
// this only matters for float noise, but the rounding is preserved exactly.
// What is *not* preserved: the local helper this replaced used bare
// `Number(v)`, which coerces a `null` or `''` input to `0`. Going through the
// shared `num` instead yields `null` for both. That's intended, not a
// regression — `totalNights`/`roomCount`/`allowedNumberOfPerks`/`tradeInValue`
// are all `number | null`, and a field Royal left absent is not a zero.
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

const day = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function readPerks(perkCodes: unknown): RcPerk[] {
  if (!Array.isArray(perkCodes)) return [];
  return perkCodes.map((entry) => {
    // Older payloads used bare strings here; current ones use objects.
    const p: any = typeof entry === 'string' ? { perkCode: entry } : (entry ?? {});
    return {
      perkCode: String(p.perkCode ?? ''),
      perkName: str(p.perkName),
      type: str(p.type),
    };
  });
}

/**
 * Free play is not a field. It is written into the perk name ("Bonus FP $75")
 * and historically into the code (`FP100`); codes on the current API are opaque
 * (`TBK6`), so the name is what carries it. Where an offer has several, the
 * largest wins — that is the figure Royal advertises.
 */
export function freePlayFrom(perks: RcPerk[]): number | null {
  let best: number | null = null;
  for (const perk of perks) {
    const match =
      perk.perkCode.trim().match(/^FP(\d+)$/i) ??
      (perk.perkName ?? '').match(/Bonus FP\s*\$?\s*(\d+)/i) ??
      (perk.perkName ?? '').match(/FP\s*\$?\s*(\d+)/i);
    if (match?.[1]) {
      const amount = Number.parseInt(match[1], 10);
      if (best === null || amount > best) best = amount;
    }
  }
  return best;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => x !== null) : [];

function mapSailing(s: any): RcOfferSailing {
  const port = s?.departurePort;
  return {
    id: str(s?.id),
    shipCode: str(s?.shipCode),
    shipName: str(s?.shipName),
    departurePort: port ? { code: str(port.code), name: str(port.name) } : null,
    sailDate: day(s?.sailDate),
    totalNights: int(s?.totalNights),
    itineraryCode: str(s?.itineraryCode),
    itineraryName: str(s?.itineraryName),
    itineraryDescription: str(s?.itineraryDescription),
    sailingType: str(s?.sailingType?.name),
    groupId: str(s?.groupId),
    roomTypes: Array.isArray(s?.roomTypeList)
      ? s.roomTypeList
          .map((r: any) => ({ code: String(r?.code ?? ''), name: str(r?.name) }))
          .filter((r: { code: string }) => r.code)
      : [],
    isGuarantee: s?.isGTY === true || s?.isGty === true,
    isBogo: s?.isGOBO === true,
    isComplimentary: s?.isCOMP === true,
    isDollarsOff: s?.isDOLLARSOFF === true,
    dollarsOff: s?.DOLLARSOFF_AMT === null || s?.DOLLARSOFF_AMT === undefined ? null : int(s.DOLLARSOFF_AMT),
    nextCruiseBonusPerkCode: str(s?.nextCruiseBonusPerkCode),
    nextCruiseBonus: s?.nextCruiseBonus ?? null,
    perks: s?.perks ?? null,
    raw: s,
  };
}

function mapOfferDetail(o: any): RcOfferDetail {
  const co = o?.campaignOffer ?? {};
  return {
    ...mapOffer(o),
    startDate: day(co.startDate),
    sailByDate: day(co.sailByDate),
    bookingFeeAmount: co.bookingFeeAmount === null || co.bookingFeeAmount === undefined ? null : int(co.bookingFeeAmount),
    roomCount: int(co.roomCount),
    allowedNumberOfPerks: int(co.allowedNumberOfPerks),
    sailingInclusionMode: str(co.sailingInclusionMode),
    exclusionList: co.exclusionList ?? null,
    descriptionList: strList(co.descriptionList),
    tags: strList(co.tags),
    digitalRedemptionOnly: co.digitalRedemptionOnly === true,
  };
}

/** Map one raw casino-API offer record into `RcOffer`. Exported for callers who page the raw API themselves. */
export function mapOffer(o: any): RcOffer {
  const co = o?.campaignOffer ?? {};
  const perks = readPerks(co.perkCodes);
  const offerCode = String(co.offerCode ?? o?.offerCode ?? '');
  const campaignCode = String(o?.campaignCode ?? '');

  return {
    offerCode,
    playerOfferId: str(o?.playerOfferId),
    campaignCode: str(campaignCode),
    campaignName: str(o?.campaignName),
    campaignType: str(o?.campaignType),
    name: str(co.name),
    offerType: co.offerType
      ? { code: str(co.offerType.code), name: str(co.offerType.name) }
      : null,
    variant: campaignCode ? str(offerCode.replace(campaignCode, '')) : null,
    description: str(co.description),
    freePlay: freePlayFrom(perks),
    tradeInValue: int(co.tradeInValue),
    bookBy: day(co.reserveByDate),
    perks,
    sailings: Array.isArray(co.sailings) ? co.sailings.map(mapSailing) : [],
    status: str(o?.status ?? co.status),
    redeemInfo: o?.redeemInfo ?? null,
    raw: o,
  };
}

/** The API router's own answer for a path it does not serve. */
export const isRouterNotFound = (data: unknown): boolean =>
  !!data && typeof data === 'object' && (data as any).code === 'NOT_FOUND';

async function page(
  session: RcSession, loyaltyId: string, n: number, sortBy: OfferSortField, config: RcConfig,
) {
  const query = new URLSearchParams({
    page: String(n),
    limit: String(PAGE_LIMIT),
    sortBy,
    sortDirection: 'asc',
  });

  return request<any>(`${LIST}?${query}`, {
    method: 'GET',
    headers: {
      ...casinoHeaders(session, { loyaltyId }, config),
      // The casino hub sends these on every call; empty is what it sends for a
      // guest who is not currently aboard.
      'x-environment-marker': '',
      'x-environment-ship-code': '',
    },
    // Read rather than throw, so the body can be inspected: a 404 here is
    // either "no offers" or "the route moved", and only the body separates
    // them. Classified in listOffers.
    allowStatus: [404],
    config,
  });
}

/** Parameters for `listOffers`. */
export interface ListOffersParams {
  /** Crown & Anchor number, from `account.crownAndAnchorId`. */
  loyaltyId: string;
  sortBy?: OfferSortField;
}

/** Every offer on the account, following pagination. */
export async function listOffers(
  session: RcSession,
  { loyaltyId, sortBy = 'offer.reserveByDate' }: ListOffersParams,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<OffersResult> {
  const first = await page(session, loyaltyId, 1, sortBy, config);

  const player = {
    firstName: str(first.data?.firstName),
    lastName: str(first.data?.lastName),
    loyaltyId: str(first.data?.loyaltyId),
  };

  if (first.status === 404) {
    if (isRouterNotFound(first.data)) {
      throw new RcRouteGoneError(
        'The casino offers route no longer exists. It has moved twice already; ' +
        'find the current path before treating this as an empty account.',
        { url: LIST, status: 404 },
      );
    }
    return { offers: [], outcome: 'none', totalOffers: 0, player };
  }

  const raw: any[] = Array.isArray(first.data?.offers) ? [...first.data.offers] : [];
  const totalPages = Number(first.data?.totalPages) || 1;

  for (let n = 2; n <= totalPages; n++) {
    const next = await page(session, loyaltyId, n, sortBy, config);
    if (Array.isArray(next.data?.offers)) raw.push(...next.data.offers);
  }

  return {
    offers: raw.map(mapOffer).filter((o) => o.offerCode),
    outcome: 'ok',
    totalOffers: Number(first.data?.totalOffers) || raw.length,
    player,
  };
}

/** Parameters for `fetchOfferDetail`. */
export interface OfferDetailParams {
  /** Crown & Anchor number, from `account.crownAndAnchorId`. */
  loyaltyId: string;
  offerCode: string;
  /** The grant to describe. Sailings can differ between grants of one code. */
  playerOfferId: string;
}

/**
 * One grant with its eligible sailings.
 *
 * This is the call the hub's offer page makes. It sends the list parameters
 * with `limit: 1` plus the two ids, and gets back the same envelope holding
 * exactly one offer — this time with `campaignOffer.sailings` filled (490 rows
 * on a wide offer) and the detail-only fields present.
 *
 * The bearer header is sufficient; no cookie session is needed. Returns null
 * when Royal answers the route but has no such grant.
 */
export async function fetchOfferDetail(
  session: RcSession,
  { loyaltyId, offerCode, playerOfferId }: OfferDetailParams,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<RcOfferDetail | null> {
  const query = new URLSearchParams({
    offerCode,
    playerOfferId,
    sortBy: 'offer.reserveByDate',
    sortDirection: 'asc',
    limit: '1',
    page: '1',
    digitalRedemption: 'true',
  });

  const res = await request<any>(`${DETAILS}?${query}`, {
    method: 'GET',
    headers: {
      ...casinoHeaders(session, { loyaltyId }, config),
      'x-environment-marker': '',
      'x-environment-ship-code': '',
    },
    allowStatus: [404],
    config,
  });

  if (res.status === 404) {
    if (isRouterNotFound(res.data)) {
      throw new RcRouteGoneError(
        'The casino offer-details route no longer exists. Find the current path ' +
        'before treating this as a grant with no sailings.',
        { url: DETAILS, status: 404 },
      );
    }
    return null;
  }

  const raw = Array.isArray(res.data?.offers) ? res.data.offers[0] : null;
  return raw ? mapOfferDetail(raw) : null;
}
