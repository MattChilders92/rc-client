import type { RcSession } from '../auth/index.ts';
import { RcRouteGoneError } from '../errors.ts';
import { casinoHeaders } from '../headers.ts';
import { request } from '../http.ts';

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

/** Rejected input is answered with a schema error listing these, which is how we know them. */
export const SORT_FIELDS = [
  'sailDate', 'createdAt', 'offer.offerCode', 'offer.offerType', 'offer.reserveByDate',
  'offer.startDate', 'offer.sailByDate', 'offer.tradeInValue', 'offer.campaign.campaignType',
] as const;
export type OfferSortField = (typeof SORT_FIELDS)[number];

const PAGE_LIMIT = 100;

export interface RcPerk {
  /** Opaque internal code (`TBK6`), not the free-play amount. */
  perkCode: string;
  /** Where the value actually is — "Bonus FP $75". */
  perkName: string | null;
  type: string | null;
}

export interface RcOfferSailing {
  id: string | null;
  shipCode: string | null;
  sailDate: string | null;
  roomType: string | null;
  isGuarantee: boolean;
  isComplimentary: boolean;
  dollarsOff: number | null;
}

export interface RcOffer {
  offerCode: string;
  /** Per-player association id. One offer code can carry several. */
  playerOfferId: string | null;
  campaignCode: string | null;
  campaignName: string | null;
  campaignType: string | null;
  /** The offer's own short name, distinct from the campaign's. */
  name: string | null;
  /** e.g. `{ code: 'COMP', name: 'Complimentary' }`. */
  offerType: { code: string | null; name: string | null } | null;
  /** Whatever the offer code carries beyond the campaign code. */
  tier: string | null;
  description: string | null;
  /** Parsed out of the perk names; Royal does not return it as a field. */
  freePlay: number | null;
  tradeInValue: number | null;
  bookBy: string | null;
  perks: RcPerk[];
  /**
   * Currently always empty: the list endpoint returns the key but never fills
   * it, and this API version exposes no separate sailings route.
   * @see docs/endpoints.md
   */
  sailings: RcOfferSailing[];
  status: string | null;
  raw: unknown;
}

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

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
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

function mapSailing(s: any): RcOfferSailing {
  return {
    id: str(s?.id),
    shipCode: str(s?.shipCode),
    sailDate: day(s?.sailDate),
    roomType: str(s?.roomType),
    isGuarantee: s?.isGTY === true || s?.isGty === true,
    isComplimentary: s?.isCOMP === true,
    dollarsOff: int(s?.DOLLARSOFF_AMT),
  };
}

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
    tier: campaignCode ? str(offerCode.replace(campaignCode, '')) : null,
    description: str(co.description),
    freePlay: freePlayFrom(perks),
    tradeInValue: int(co.tradeInValue),
    bookBy: day(co.reserveByDate),
    perks,
    sailings: Array.isArray(co.sailings) ? co.sailings.map(mapSailing) : [],
    status: str(o?.status ?? co.status),
    raw: o,
  };
}

/** The API router's own answer for a path it does not serve. */
export const isRouterNotFound = (data: unknown): boolean =>
  !!data && typeof data === 'object' && (data as any).code === 'NOT_FOUND';

async function page(session: RcSession, loyaltyId: string, n: number, sortBy: OfferSortField) {
  const query = new URLSearchParams({
    page: String(n),
    limit: String(PAGE_LIMIT),
    sortBy,
    sortDirection: 'asc',
  });

  return request<any>(`${LIST}?${query}`, {
    method: 'GET',
    headers: {
      ...casinoHeaders(session, { loyaltyId }),
      // The casino hub sends these on every call; empty is what it sends for a
      // guest who is not currently aboard.
      'x-environment-marker': '',
      'x-environment-ship-code': '',
    },
    // Read rather than throw, so the body can be inspected: a 404 here is
    // either "no offers" or "the route moved", and only the body separates
    // them. Classified in listOffers.
    allowStatus: [404],
  });
}

export interface ListOffersParams {
  /** Crown & Anchor number, from `account.crownAndAnchorId`. */
  loyaltyId: string;
  sortBy?: OfferSortField;
}

/** Every offer on the account, following pagination. */
export async function listOffers(
  session: RcSession,
  { loyaltyId, sortBy = 'offer.reserveByDate' }: ListOffersParams,
): Promise<OffersResult> {
  const first = await page(session, loyaltyId, 1, sortBy);

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
    const next = await page(session, loyaltyId, n, sortBy);
    if (Array.isArray(next.data?.offers)) raw.push(...next.data.offers);
  }

  return {
    offers: raw.map(mapOffer).filter((o) => o.offerCode),
    outcome: 'ok',
    totalOffers: Number(first.data?.totalOffers) || raw.length,
    player,
  };
}
