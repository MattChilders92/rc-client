import type { RcSession } from '../auth/index.ts';
import { casinoHeaders } from '../headers.ts';
import { request } from '../http.ts';

/**
 * Club Royale casino offers, and the sailings each offer is valid for.
 *
 * One endpoint serves both: `POST /api/casino/v2/offers/merged`. Adding
 * `offerCode` and `playerOfferId` to the same body switches it from listing all
 * offers to returning one with its `sailings[]` populated.
 *
 * This replaced `POST /api/casino/casino-offers/v1`, which now answers 404 for
 * every input including an empty loyalty id. Any code still calling the old
 * route is silently receiving nothing.
 *
 * The player is identified entirely by headers — `x-account-id`, `x-loyalty-id`
 * and the Bearer token. The body carries no identity at all.
 */

const URL_ = 'https://www.royalcaribbean.com/api/casino/v2/offers/merged';

/**
 * Royal's own session sends both brands' agency ids on every request and tags
 * each returned offer with the one it belongs to. 109638 is Royal Caribbean;
 * 388809 is believed to be Celebrity but has not been confirmed against a
 * Celebrity account.
 */
export const AGENCY_IDS = { RC: '109638', CEL: '388809' } as const;

const PAGE_LIMIT = 100;

export interface RcPerk {
  perkCode: string;
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
  /** Per-player association id; required to request this offer's sailings. */
  playerOfferId: string | null;
  campaignCode: string | null;
  campaignName: string | null;
  campaignType: string | null;
  /** Whatever the offer code carries beyond the campaign code. */
  tier: string | null;
  description: string | null;
  /** Parsed out of the perk codes; Royal does not return it as a field. */
  freePlay: number | null;
  tradeInValue: number | null;
  bookBy: string | null;
  perks: RcPerk[];
  sailings: RcOfferSailing[];
  status: string | null;
  raw: unknown;
}

export interface OffersResult {
  offers: RcOffer[];
  /**
   * Why the list is what it is. `none` means Royal answered 404/422, which on
   * this endpoint means the account has no offers — distinct from a thrown
   * `RcRouteGoneError`, which would mean the route moved again.
   */
  outcome: 'ok' | 'none';
  totalOffers: number;
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
 * Free play is encoded in the perk code (`FP100`) or its name ("Bonus FP $100"),
 * never returned as a number. Where an offer carries several, the largest wins —
 * that is the figure Royal advertises.
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
    // Room types came back UPPERCASE on the old API and mixed-case on this one.
    roomType: str(s?.roomType),
    isGuarantee: s?.isGTY === true || s?.isGty === true,
    isComplimentary: s?.isCOMP === true,
    dollarsOff: int(s?.DOLLARSOFF_AMT),
  };
}

function mapOffer(o: any): RcOffer {
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
    tier: campaignCode ? str(offerCode.replace(campaignCode, '')) : null,
    description: str(co.description),
    freePlay: freePlayFrom(perks),
    tradeInValue: int(co.tradeInValue),
    bookBy: day(co.reserveByDate),
    perks,
    sailings: Array.isArray(co.sailings) ? co.sailings.map(mapSailing) : [],
    status: str(o?.status),
    raw: o,
  };
}

interface PageBody {
  sortBy: string;
  sortDirection: string;
  limit: number;
  approvedAgencyIds: string[];
  page: number;
  digitalRedemption: boolean;
  offerCode?: string;
  playerOfferId?: string;
}

function body(page: number, extra: Partial<PageBody> = {}): PageBody {
  return {
    sortBy: 'offer.reserveByDate',
    sortDirection: 'asc',
    limit: PAGE_LIMIT,
    approvedAgencyIds: [AGENCY_IDS.RC, AGENCY_IDS.CEL],
    page,
    digitalRedemption: true,
    ...extra,
  };
}

async function post(session: RcSession, loyaltyId: string, payload: PageBody) {
  return request<any>(URL_, {
    method: 'POST',
    headers: casinoHeaders(session, { loyaltyId }),
    body: payload,
    // On this endpoint a 404 means "no offers for this player", so it is read
    // rather than thrown. A moved route would surface as a shape failure below.
    allowStatus: [404, 422],
  });
}

export interface ListOffersParams {
  /** Crown & Anchor number, from `account.crownAndAnchorId`. */
  loyaltyId: string;
}

/** Every offer on the account, following pagination. */
export async function listOffers(
  session: RcSession,
  { loyaltyId }: ListOffersParams,
): Promise<OffersResult> {
  const first = await post(session, loyaltyId, body(1));
  if (first.status === 404 || first.status === 422) {
    return { offers: [], outcome: 'none', totalOffers: 0 };
  }

  const raw: any[] = Array.isArray(first.data?.offers) ? [...first.data.offers] : [];
  const totalPages = Number(first.data?.totalPages) || 1;

  for (let page = 2; page <= totalPages; page++) {
    const next = await post(session, loyaltyId, body(page));
    if (Array.isArray(next.data?.offers)) raw.push(...next.data.offers);
  }

  return {
    offers: raw.map(mapOffer).filter((o) => o.offerCode),
    outcome: 'ok',
    totalOffers: Number(first.data?.totalOffers) || raw.length,
  };
}

/**
 * One offer with its `sailings[]` populated — the same call with two extra body
 * fields, which is why there is no separate endpoint for it.
 */
export async function fetchOfferSailings(
  session: RcSession,
  params: ListOffersParams & { offerCode: string; playerOfferId?: string },
): Promise<RcOffer | null> {
  const res = await post(
    session,
    params.loyaltyId,
    body(1, {
      offerCode: params.offerCode,
      ...(params.playerOfferId ? { playerOfferId: params.playerOfferId } : {}),
    }),
  );
  if (res.status === 404 || res.status === 422) return null;

  const list: any[] = Array.isArray(res.data?.offers) ? res.data.offers : [];
  const match = list.find((o) => String(o?.campaignOffer?.offerCode ?? '') === params.offerCode);
  return match ? mapOffer(match) : (list[0] ? mapOffer(list[0]) : null);
}
