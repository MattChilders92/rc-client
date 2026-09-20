import { anonymousHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { num as coerceNum, str } from '../coerce.ts';
import { DEFAULT_CONFIG, type RcConfig } from '../config.ts';

/**
 * Cabin categories and fares for a sailing.
 *
 * This is a real JSON API and takes **no credentials** — unlike the
 * room-selection web page, whose prices are buried in a Next.js flight payload
 * behind Akamai. Prefer this; scraping that page is never necessary.
 *
 * The catch is occupancy. Royal only returns cabins that can sleep the party you
 * ask for, so a single request never sees every category. `sweepOccupancy`
 * cycles guest counts and merges, which is how full coverage is obtained.
 */

const BASE: Record<Brand, string> = {
  RC: 'https://www.royalcaribbean.com/itinerary/api/v1',
  CEL: 'https://www.celebritycruises.com/itinerary/api/v1',
};

/** Which site's inventory to query — Royal Caribbean or Celebrity. Each has its own base URL. */
export type Brand = 'RC' | 'CEL';

/** What to look up cabins for: sailing, party size, and locale. */
export interface RoomQuery {
  /** Royal's sailing identifier, as used across the booking APIs. */
  packageCode: string;
  /** `YYYY-MM-DD`. */
  sailDate: string;
  /** Defaults to 2. */
  adults?: number;
  /** Defaults to 0. */
  children?: number;
  /** `RC` or `CEL`. Defaults to `RC`. */
  brand?: Brand;
  /** ISO country the guest is booking from. Defaults to `USA`. */
  countryCode?: string;
  /** Defaults to `USD`. */
  currencyCode?: string;
  /** Royal's booking-office code; `MIA` is the US site. */
  officeCode?: string;
}

/** One bookable cabin category/subtype at one occupancy. */
export interface RcRoom {
  categoryCode: string;
  subtypeCode: string | null;
  name: string | null;
  /** INTERIOR · OCEANVIEW · BALCONY · SUITE, where Royal states it. */
  type: string | null;
  guarantee: boolean;
  maxOccupancy: number | null;
  roomsLeft: number | null;
  /** What the cabin actually costs, discounts applied and taxes included. */
  allIn: number | null;
  perPerson: number | null;
  /** List fare before discounts. Never what anyone pays. */
  grossFare: number | null;
  taxes: number | null;
  /** The occupancy this price was quoted for. */
  occupancy: { adults: number; children: number };
  raw: unknown;
}

// Rounds to cents — unlike the shared `num` — because these are money fields
// and Royal's pricing carries float noise past two decimal places. A null or
// empty input still yields null here too, same as the shared `num`: the
// local helper this replaced used bare `Number(v)`, which coerces `null`/`''`
// to `0`, but `allIn`/`perPerson`/`taxes` are `number | null` and a missing
// price is not the same thing as a cabin that costs nothing.
const num = (v: unknown): number | null => {
  const n = coerceNum(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

/**
 * A stable identity for a cabin. Royal reuses `categoryCode` across several
 * bookable subtypes, and a guarantee cabin is a different product from the
 * assigned-room version of the same category.
 */
export function roomKey(room: Pick<RcRoom, 'categoryCode' | 'subtypeCode' | 'guarantee'>): string {
  const base = !room.subtypeCode || room.subtypeCode === room.categoryCode
    ? room.categoryCode
    : `${room.categoryCode}:${room.subtypeCode}`;
  return room.guarantee ? `${base}-GTY` : base;
}

function url(q: RoomQuery): string {
  const base = BASE[q.brand ?? 'RC'];
  const params = new URLSearchParams({
    packageCode: q.packageCode,
    sailDate: q.sailDate,
    adults: String(q.adults ?? 2),
    children: String(q.children ?? 0),
    countryCode: q.countryCode ?? 'USA',
    currencyCode: q.currencyCode ?? 'USD',
    languageCode: 'en',
    officeCode: q.officeCode ?? 'MIA',
  });
  return `${base}/sailings?${params}`;
}

/**
 * Royal's grouping codes for the four cabin classes.
 */
const TYPE_BY_GROUP: Record<string, string> = {
  INTERIOR: 'INTERIOR',
  OUTSIDE: 'OCEANVIEW',
  BALCONY: 'BALCONY',
  DELUXE: 'SUITE',
};

/**
 * Map one subtype.
 *
 * Note the price semantics here differ from the room-selection web page:
 * `pricing.amount` is **per person** and `pricing.total` is the whole cabin.
 * On the web page's embedded payload it is the other way round, which makes
 * mixing the two sources a quiet way to be out by a factor of the party size.
 */
function mapRoom(
  sub: any,
  group: any,
  sailing: any,
  occupancy: { adults: number; children: number },
): RcRoom {
  const pricing = sub?.pricing ?? {};
  const taxes = sailing?.taxesAndFees ?? {};

  return {
    categoryCode: String(sub?.categoryCode ?? sub?.code ?? ''),
    subtypeCode: str(sub?.code),
    name: str(sub?.name),
    type: TYPE_BY_GROUP[String(group?.code ?? '')] ?? str(group?.name),
    guarantee: sub?.isGuarantee === true,
    maxOccupancy: readMaxOccupancy(sub?.features),
    roomsLeft: sub?.roomsLeft === undefined ? null : Number(sub.roomsLeft),
    allIn: num(pricing.total),
    perPerson: num(pricing.amount),
    // This endpoint quotes the fare already discounted and gives no list price.
    grossFare: null,
    taxes: num(taxes.total),
    occupancy,
    raw: sub,
  };
}

/**
 * Royal states occupancy as prose in a feature line, e.g. "Up to 4 guests".
 *
 * The live payload nests those lines under `features.singleFeatures`; reading
 * `features` as a bare array returns null for every real response. Guarantee
 * cabins state no occupancy at all, so null there is correct. `roomFeatures` is
 * deliberately not scanned — its bed prose says "up to 3 guests" about the sofa
 * bed and would read low.
 */
function readMaxOccupancy(features: unknown): number | null {
  const blocks: any[] = Array.isArray(features)
    ? features
    : ((features as any)?.singleFeatures ?? []);

  const stated = blocks.find((f) => f?.code === 'occupancy');
  for (const f of stated ? [stated] : blocks) {
    const lines: unknown = f?.lines ?? f?.text;
    const text = Array.isArray(lines) ? lines.join(' ') : String(lines ?? '');
    const match = text.match(/(\d+)\s*guests?/i);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

function collect(body: any, occupancy: { adults: number; children: number }): RcRoom[] {
  const out: RcRoom[] = [];
  const sailings: any[] = body?.sailings ?? [];

  for (const sailing of sailings) {
    for (const group of sailing?.rooms ?? []) {
      for (const sub of group?.subtypes ?? []) {
        const room = mapRoom(sub, group, sailing, occupancy);
        if (room.categoryCode) out.push(room);
      }
    }
  }
  return out;
}

/** Cabins bookable at one specific occupancy. */
export async function fetchRooms(
  query: RoomQuery,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<RcRoom[]> {
  const occupancy = { adults: query.adults ?? 2, children: query.children ?? 0 };
  const target = url(query);
  const res = await request<any>(target, {
    headers: anonymousHeaders(config),
    // A sailing that does not exist, or has nothing for this party size.
    allowStatus: [404],
    config,
  });
  if (res.status === 404) return [];
  return collect(res.data, occupancy);
}

/**
 * Occupancy combinations that between them surface every cabin category.
 * Ordered low to high so the first price seen for a cabin is its
 * lowest-occupancy — and therefore most comparable — quote.
 */
export const COVERAGE_OCCUPANCIES: ReadonlyArray<{ adults: number; children: number }> = [
  { adults: 2, children: 0 },
  { adults: 3, children: 0 },
  { adults: 4, children: 0 },
  { adults: 2, children: 2 },
  { adults: 1, children: 0 },
];

/**
 * Every cabin on the sailing, by asking for several party sizes and merging.
 *
 * A single request only ever returns cabins that sleep the party asked for, so
 * one call silently omits categories. First price seen wins.
 */
export async function sweepOccupancy(
  query: Omit<RoomQuery, 'adults' | 'children'>,
  occupancies: ReadonlyArray<{ adults: number; children: number }> = COVERAGE_OCCUPANCIES,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<Map<string, RcRoom>> {
  const found = new Map<string, RcRoom>();

  for (const occ of occupancies) {
    const rooms = await fetchRooms({ ...query, ...occ }, config);
    for (const room of rooms) {
      const key = roomKey(room);
      if (!found.has(key)) found.set(key, room);
    }
  }
  return found;
}
