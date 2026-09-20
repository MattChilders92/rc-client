import { request } from '../http.ts';
import { str } from '../coerce.ts';
import { RcRequestError, RcShapeError } from '../errors.ts';
import { resolveConfig, type RcConfig } from '../config.ts';
import { parseItineraryPorts, searchHeaders, SEARCH_URL, type RcItineraryPorts } from './search.ts';

/**
 * The whole public catalogue: every itinerary, its ports, each dated sailing, a
 * lead price per room class, and the promotions Royal advertises on it.
 *
 * One pass of the same cruise search `fetchItineraryPorts` walks, with a wider
 * selection — so a caller that wants both pays for one sweep, not two.
 */
const CATALOGUE_QUERY = `query cruiseSearch_Catalogue($filters: String, $pagination: CruiseSearchPagination) {
  cruiseSearch(filters: $filters, pagination: $pagination) {
    results {
      total
      cruises {
        masterSailing { itinerary {
          code name totalNights
          departurePort { code name }
          destination { code name }
          ship { code name }
          days { number ports { port { code name } } }
        } }
        sailings {
          id sailDate bookingLink itinerary { code }
          taxesAndFees { value }
          taxesAndFeesIncluded
          stateroomClassPricing { price { value currency { code } } stateroomClass { id } }
          bestPromotion { code description title }
        }
      }
    }
  }
}`;

/** The four room classes every price in the catalogue is filed under. */
export type RcRoomClass = 'INTERIOR' | 'OCEANVIEW' | 'BALCONY' | 'SUITE';

/** What a promotion advertises, as far as its label reveals. */
export type RcPromoKind = 'kids_free' | 'pct_off_2nd' | 'obc' | 'dollars_off' | 'other';

/** A "from" price: per person, for two guests, the cheapest cabin of its class. Not a quote. */
export interface RcLeadPrice { roomClass: RcRoomClass; perPerson: number; currency: string | null }

/** One promotion Royal advertises on a sailing. */
export interface RcPromo { code: string | null; label: string; kind: RcPromoKind; endsOn: string | null }

/** One dated departure with its lead prices and promotions. */
export interface RcCatalogueSailing {
  sailingId: string;
  sailDate: string;
  itineraryCode: string | null;
  bookingLink: string | null;
  /** As Royal reports it; null when absent. */
  taxesAndFees: number | null;
  /** Royal's own flag for whether `prices` already include `taxesAndFees`. Null when absent: unknown, not false. */
  taxesIncluded: boolean | null;
  /** A class with no price is absent — sold out or not offered — never zero. */
  prices: RcLeadPrice[];
  promos: RcPromo[];
}

/** One itinerary from the catalogue, with everything the search knows about it. */
export interface RcCatalogueCruise {
  ports: RcItineraryPorts;
  shipName: string | null;
  destination: { code: string; name: string } | null;
  sailings: RcCatalogueSailing[];
}

const ROOM_CLASS: Record<string, RcRoomClass> = {
  INTERIOR: 'INTERIOR', INSIDE: 'INTERIOR',
  OUTSIDE: 'OCEANVIEW', OCEANVIEW: 'OCEANVIEW', OCEAN_VIEW: 'OCEANVIEW',
  BALCONY: 'BALCONY',
  DELUXE: 'SUITE', SUITE: 'SUITE',
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Pure. A label is all Royal gives, so the kind is read off the words. */
export function classifyPromo(label: string): RcPromoKind {
  const l = label.toLowerCase();
  if (/kids?\s+sail\s+free/.test(l)) return 'kids_free';
  if (/%\s*off/.test(l) && /(2nd|second)\s+guest/.test(l)) return 'pct_off_2nd';
  if (/on\s?board\s+credit|\bobc\b/.test(l)) return 'obc';
  if (/\$\s?\d[\d,]*\s*off/.test(l)) return 'dollars_off';
  return 'other';
}

/** Pure, so the shape is tested without a network call. */
export function parseCatalogueCruise(cruise: unknown): RcCatalogueCruise | null {
  const c = cruise as any;
  const ports = parseItineraryPorts(c);
  if (!ports) return null;
  const it = c.masterSailing.itinerary;

  const sailings: RcCatalogueSailing[] = [];
  for (const s of Array.isArray(c.sailings) ? c.sailings : []) {
    const sailDate = str(s?.sailDate);
    if (!sailDate) continue;

    const prices: RcLeadPrice[] = [];
    for (const p of Array.isArray(s.stateroomClassPricing) ? s.stateroomClassPricing : []) {
      const roomClass = ROOM_CLASS[String(p?.stateroomClass?.id ?? '').toUpperCase()];
      const perPerson = num(p?.price?.value);
      if (roomClass && perPerson !== null && perPerson > 0) {
        prices.push({ roomClass, perPerson, currency: str(p.price?.currency?.code) });
      }
    }

    // One "best" promotion, not a list. `description` is usually '', so the title is the label.
    const promos: RcPromo[] = [];
    const label = str(s.bestPromotion?.title) ?? str(s.bestPromotion?.description);
    if (label) promos.push({ code: str(s.bestPromotion.code), label, kind: classifyPromo(label), endsOn: null });

    sailings.push({
      sailingId: String(s.id ?? ''),
      sailDate,
      itineraryCode: str(s.itinerary?.code),
      bookingLink: str(s.bookingLink),
      taxesAndFees: num(s.taxesAndFees?.value),
      taxesIncluded: typeof s.taxesAndFeesIncluded === 'boolean' ? s.taxesAndFeesIncluded : null,
      prices, promos,
    });
  }

  const dest = str(it.destination?.code)
    ? { code: str(it.destination.code)!, name: str(it.destination.name) ?? str(it.destination.code)! }
    : null;
  return { ports, shipName: str(it.ship?.name), destination: dest, sailings };
}

/** One page of the catalogue. `total` lets the caller page to the end. */
export async function fetchCatalogue(
  opts: { count?: number; skip?: number } = {},
  config: Partial<RcConfig> = {},
): Promise<{ cruises: RcCatalogueCruise[]; total: number }> {
  const cfg = resolveConfig(config);
  const res = await request<any>(SEARCH_URL, {
    method: 'POST',
    headers: searchHeaders(cfg),
    body: {
      operationName: 'cruiseSearch_Catalogue',
      variables: { filters: '{}', pagination: { count: opts.count ?? 100, skip: opts.skip ?? 0 } },
      query: CATALOGUE_QUERY,
    },
    config: cfg,
  });

  // Same guards as the other two searches: a challenge page or a GraphQL error
  // inside a 200 must be a failure, never "the catalogue is empty".
  if (typeof res.data !== 'object' || res.data === null) {
    throw new RcShapeError('Cruise search returned a non-JSON body', { status: res.status, url: SEARCH_URL, body: res.data });
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length) {
    throw new RcRequestError(
      `Cruise search (catalogue) rejected by GraphQL: ${res.data.errors[0]?.message ?? 'unknown GraphQL error'}`,
      { status: res.status, url: SEARCH_URL, body: res.data.errors },
    );
  }
  const results = res.data?.data?.cruiseSearch?.results ?? {};
  const raw: unknown[] = Array.isArray(results.cruises) ? results.cruises : [];
  return {
    cruises: raw.map(parseCatalogueCruise).filter((c): c is RcCatalogueCruise => c !== null),
    total: Number(results.total) || raw.length,
  };
}
