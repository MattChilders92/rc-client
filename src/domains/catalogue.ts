import { request } from '../http.ts';
import { str } from '../coerce.ts';
import { RcRequestError, RcShapeError } from '../errors.ts';
import { resolveConfig, type RcConfig } from '../config.ts';
import {
  parseItineraryPorts, searchHeaders, searchUrl, packageCodeFromSailingId,
  type RcItineraryPorts,
} from './search.ts';
import { type Brand } from '../brand.ts';

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

/**
 * The room classes a catalogue price is filed under.
 *
 * Royal sells four; Celebrity sells the same four plus Concierge Class and
 * AquaClass, which its search returns as their own priced entries. They are
 * kept as distinct values rather than folded into `BALCONY`, because they are
 * separately priced products a caller may want to tell apart — and because an
 * earlier version silently dropped every class it did not recognise, losing
 * two of Celebrity's six on every sailing.
 */
export type RcRoomClass =
  | 'INTERIOR' | 'OCEANVIEW' | 'BALCONY' | 'SUITE' | 'CONCIERGE' | 'AQUA';

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
  /**
   * The code room pricing wants, taken from the sailing id rather than from a
   * code field, so it cannot be confused with the cruise's master code.
   *
   * Use this, not `RcCatalogueCruise.ports.itineraryCode`. A Celebrity cruise
   * advertises one master itinerary code while its individual dates run under
   * their own package codes — measured on one recorded search, 33 of 50
   * sailings differed from their parent — and pricing 404s on the master
   * code. This field and the sibling `itineraryCode` above have always agreed
   * in recorded data; the divergence is against the parent, not within the
   * sailing.
   *
   * Null when the id is absent or not in `<code>_<date>` form.
   */
  packageCode: string | null;
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

// Royal's search says OUTSIDE and DELUXE where the rest of its own APIs say
// OCEANVIEW and SUITE. Celebrity adds CONCIERGE and AQUA.
const ROOM_CLASS: Record<string, RcRoomClass> = {
  INTERIOR: 'INTERIOR', INSIDE: 'INTERIOR',
  OUTSIDE: 'OCEANVIEW', OCEANVIEW: 'OCEANVIEW', OCEAN_VIEW: 'OCEANVIEW',
  BALCONY: 'BALCONY',
  DELUXE: 'SUITE', SUITE: 'SUITE',
  CONCIERGE: 'CONCIERGE',
  AQUA: 'AQUA', AQUACLASS: 'AQUA', AQUA_CLASS: 'AQUA',
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

    const sailingId = String(s.id ?? '');
    sailings.push({
      sailingId,
      sailDate,
      itineraryCode: str(s.itinerary?.code),
      packageCode: packageCodeFromSailingId(sailingId),
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

// Royal's gateway answers HTTP 413 at `count: 100` for this heavier
// selection (every dated sailing plus lead prices and promos, not just the
// itinerary the other two searches ask for). 50 works. Do not raise this
// back to 100 without confirming the gateway's limit has changed.
const DEFAULT_COUNT = 50;

/** One page of the catalogue. `total` lets the caller page to the end. */
export async function fetchCatalogue(
  opts: {
    count?: number;
    skip?: number;
    /** Selects both the host this call goes to and the `brand` header it sends. Defaults to `'R'`. */
    brand?: Brand;
  } = {},
  config: Partial<RcConfig> = {},
): Promise<{ cruises: RcCatalogueCruise[]; total: number }> {
  const cfg = resolveConfig(config);
  const brand = opts.brand ?? 'R';
  const target = searchUrl(brand);
  const res = await request<any>(target, {
    method: 'POST',
    headers: searchHeaders(cfg, brand),
    body: {
      operationName: 'cruiseSearch_Catalogue',
      variables: { filters: '{}', pagination: { count: opts.count ?? DEFAULT_COUNT, skip: opts.skip ?? 0 } },
      query: CATALOGUE_QUERY,
    },
    config: cfg,
  });

  // Same guards as the other two searches: a challenge page or a GraphQL error
  // inside a 200 must be a failure, never "the catalogue is empty".
  if (typeof res.data !== 'object' || res.data === null) {
    throw new RcShapeError('Cruise search returned a non-JSON body', { status: res.status, url: target, body: res.data });
  }
  if (Array.isArray(res.data?.errors) && res.data.errors.length) {
    throw new RcRequestError(
      `Cruise search (catalogue) rejected by GraphQL: ${res.data.errors[0]?.message ?? 'unknown GraphQL error'}`,
      { status: res.status, url: target, body: res.data.errors },
    );
  }
  const results = res.data?.data?.cruiseSearch?.results ?? {};
  const raw: unknown[] = Array.isArray(results.cruises) ? results.cruises : [];
  return {
    cruises: raw.map(parseCatalogueCruise).filter((c): c is RcCatalogueCruise => c !== null),
    total: Number(results.total) || raw.length,
  };
}
