import { request } from '../http.ts';
import { str } from '../coerce.ts';
import { RcRequestError, RcShapeError } from '../errors.ts';
import { resolveConfig, type RcConfig } from '../config.ts';

/**
 * Public cruise search — the sailings and itineraries behind royalcaribbean.com's
 * "find a cruise" widget.
 *
 * The only domain here that needs no credentials, which makes it the one usable
 * for browsing deals without linking an account.
 *
 * It is GraphQL. The query below is deliberately narrower than the site's own:
 * every field requested is a field that can break, and this asks only for what
 * identifies a sailing.
 */

const URL_ = 'https://www.royalcaribbean.com/graph';

const QUERY = `query cruiseSearch_Cruises($filters: String, $qualifiers: String, $sort: CruiseSearchSort, $pagination: CruiseSearchPagination) {
  cruiseSearch(filters: $filters, qualifiers: $qualifiers, sort: $sort, pagination: $pagination) {
    results {
      total
      cruises {
        id
        productViewLink
        masterSailing {
          itinerary {
            name
            code
            totalNights
            departurePort { code name countryCode }
            destination { code name }
            ship { code name }
          }
        }
        sailings { id sailDate startDate endDate bookingLink itinerary { code } }
      }
    }
  }
}`;

/** One dated departure of an `RcCruise`. */
export interface RcSailingSummary {
  sailingId: string;
  sailDate: string | null;
  startDate: string | null;
  endDate: string | null;
  itineraryCode: string | null;
  bookingLink: string | null;
}

/** One itinerary from the public search, with the individual dated sailings it runs. */
export interface RcCruise {
  id: string;
  shipCode: string | null;
  shipName: string | null;
  itineraryCode: string | null;
  itineraryName: string | null;
  nights: number | null;
  departurePort: string | null;
  destination: string | null;
  link: string | null;
  sailings: RcSailingSummary[];
}

/** What `searchCruises` returns: one page of matching cruises plus the total across all pages. */
export interface SearchResult {
  cruises: RcCruise[];
  total: number;
}

/** Parameters for `searchCruises`. Every field is optional; the defaults mirror an unfiltered site search. */
export interface SearchParams {
  /** Royal's own filter string, e.g. `{"ship":["LE"]}`. Defaults to no filter. */
  filters?: string;
  /** Defaults to `RECOMMENDED`. */
  sortBy?: 'RECOMMENDED' | 'PRICE' | 'DATE';
  /** Results per page. Defaults to 25. */
  limit?: number;
  /** 1-based. Defaults to 1. */
  page?: number;
}

function headers(config: RcConfig): Record<string, string> {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    adrum: 'isAjax:true',
    'apollographql-client-name': 'cruise-search-widget',
    'app-name': 'graph',
    brand: 'R',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    country: 'USA',
    countryalpha2code: 'US',
    currency: 'USD',
    language: 'en',
    office: 'MIA',
    pragma: 'no-cache',
    'request-timeout': '20',
    'user-agent': config.userAgent,
    referer: 'https://www.royalcaribbean.com/',
    // The site sends a session uuid; any valid one is accepted.
    'x-session-id': crypto.randomUUID(),
  };
}

/** Public cruise search: no credentials, one GraphQL call, one page of results. */
export async function searchCruises(
  params: SearchParams = {},
  config: Partial<RcConfig> = {},
): Promise<SearchResult> {
  const cfg = resolveConfig(config);
  const limit = params.limit ?? 25;
  const page = params.page ?? 1;

  const res = await request<any>(URL_, {
    method: 'POST',
    headers: headers(cfg),
    body: {
      operationName: 'cruiseSearch_Cruises',
      variables: {
        filters: params.filters ?? '{}',
        sort: { by: params.sortBy ?? 'RECOMMENDED' },
        pagination: { count: limit, skip: (page - 1) * limit },
      },
      query: QUERY,
    },
    config: cfg,
  });

  // Royal's edge occasionally answers this POST with an HTML challenge page
  // rather than the GraphQL envelope, still as a 200. Read as text, that
  // parses to no errors and no results, which would otherwise come out as a
  // silent "no cruises found" — the exact failure mode this library exists
  // to prevent.
  if (typeof res.data !== 'object' || res.data === null) {
    throw new RcShapeError('Cruise search returned a non-JSON body', {
      status: res.status, url: URL_, body: res.data,
    });
  }

  // GraphQL reports failures inside a 200, so errors have to be read out.
  if (Array.isArray(res.data?.errors) && res.data.errors.length) {
    const first = res.data.errors[0];
    throw new RcRequestError(
      `Cruise search rejected by GraphQL: ${first?.message ?? 'unknown GraphQL error'}`,
      { status: res.status, url: URL_, body: res.data.errors },
    );
  }

  const results = res.data?.data?.cruiseSearch?.results ?? {};
  const cruises: any[] = results.cruises ?? [];

  return {
    total: Number(results.total) || cruises.length,
    cruises: cruises.map((c) => {
      const it = c?.masterSailing?.itinerary ?? {};
      return {
        id: String(c?.id ?? ''),
        shipCode: str(it.ship?.code),
        shipName: str(it.ship?.name),
        itineraryCode: str(it.code),
        itineraryName: str(it.name),
        nights: it.totalNights === undefined ? null : Number(it.totalNights) || null,
        departurePort: str(it.departurePort?.name),
        destination: str(it.destination?.name),
        link: str(c?.productViewLink),
        sailings: (c?.sailings ?? []).map((s: any) => ({
          sailingId: String(s?.id ?? ''),
          sailDate: str(s?.sailDate),
          startDate: str(s?.startDate),
          endDate: str(s?.endDate),
          itineraryCode: str(s?.itinerary?.code),
          bookingLink: str(s?.bookingLink),
        })),
      };
    }),
  };
}

/**
 * Itinerary ports, from the same public cruise search.
 *
 * `cruiseSearch` returns each cruise's itinerary with a day-by-day port list,
 * which is the only credential-free source for where a sailing actually calls —
 * the casino offer feed carries the departure port and nothing else. Ports
 * belong to the itinerary rather than the sail date, so one fetch serves every
 * date that itinerary runs.
 */
const PORTS_QUERY = `query cruiseSearch_Ports($filters: String, $pagination: CruiseSearchPagination) {
  cruiseSearch(filters: $filters, pagination: $pagination) {
    results {
      total
      cruises {
        masterSailing { itinerary {
          code name totalNights
          departurePort { code name }
          ship { code name }
          days { number ports { port { code name } } }
        } }
        sailings { sailDate itinerary { code } }
      }
    }
  }
}`;

/** Royal's sentinel for a day at sea; it is not a port. */
const SEA_DAY = 'CRU';

/** One day of an itinerary — an empty `ports` list means a day at sea. */
export interface RcItineraryDay {
  day: number;
  ports: { code: string; name: string }[];
}

/** One itinerary's day-by-day ports, as `fetchItineraryPorts`/`parseItineraryPorts` return it. */
export interface RcItineraryPorts {
  itineraryCode: string;
  itineraryName: string | null;
  nights: number | null;
  shipCode: string | null;
  departurePort: { code: string; name: string } | null;
  /** Every day, including sea days, which keep their number and an empty port list. */
  days: RcItineraryDay[];
  /** The dates this itinerary is offered on, as the search reported them. */
  sailDates: string[];
}

/** Pure, so the shape is tested without a network call. */
export function parseItineraryPorts(cruise: unknown): RcItineraryPorts | null {
  const c = cruise as any;
  const it = c?.masterSailing?.itinerary;
  const code = str(it?.code);
  if (!code) return null;

  const days: RcItineraryDay[] = Array.isArray(it.days)
    ? it.days.map((d: any, i: number) => ({
        day: Number.isFinite(d?.number) ? Number(d.number) : i + 1,
        ports: (Array.isArray(d?.ports) ? d.ports : [])
          .map((p: any) => ({ code: str(p?.port?.code), name: str(p?.port?.name) }))
          .filter((p: any): p is { code: string; name: string | null } =>
            p.code !== null && p.code !== SEA_DAY)
          .map((p: any) => ({ code: p.code as string, name: p.name ?? p.code })),
      }))
    : [];

  const dep = str(it.departurePort?.code)
    ? { code: str(it.departurePort.code)!, name: str(it.departurePort.name) ?? str(it.departurePort.code)! }
    : null;

  return {
    itineraryCode: code,
    itineraryName: str(it.name),
    nights: Number.isFinite(it.totalNights) ? Number(it.totalNights) : null,
    shipCode: str(it.ship?.code),
    departurePort: dep,
    days,
    sailDates: (Array.isArray(c.sailings) ? c.sailings : [])
      .map((s: any) => str(s?.sailDate))
      .filter((d: string | null): d is string => d !== null),
  };
}

/** One page of the catalogue. `total` lets the caller page to the end. */
export async function fetchItineraryPorts(
  opts: { count?: number; skip?: number } = {},
  config: Partial<RcConfig> = {},
): Promise<{ itineraries: RcItineraryPorts[]; total: number }> {
  const cfg = resolveConfig(config);
  const res = await request<any>(URL_, {
    method: 'POST',
    headers: headers(cfg),
    body: {
      operationName: 'cruiseSearch_Ports',
      variables: { filters: '{}', pagination: { count: opts.count ?? 100, skip: opts.skip ?? 0 } },
      query: PORTS_QUERY,
    },
    config: cfg,
  });

  // Same non-JSON guard as searchCruises: a challenge page read as text would
  // otherwise map to zero itineraries rather than a failure.
  if (typeof res.data !== 'object' || res.data === null) {
    throw new RcShapeError('Cruise search returned a non-JSON body', {
      status: res.status, url: URL_, body: res.data,
    });
  }

  // GraphQL reports failures inside a 200, so errors have to be read out.
  if (Array.isArray(res.data?.errors) && res.data.errors.length) {
    const first = res.data.errors[0];
    throw new RcRequestError(
      `Cruise search (ports) rejected by GraphQL: ${first?.message ?? 'unknown GraphQL error'}`,
      { status: res.status, url: URL_, body: res.data.errors },
    );
  }
  const results = res.data?.data?.cruiseSearch?.results ?? {};
  const cruises: any[] = Array.isArray(results.cruises) ? results.cruises : [];
  return {
    itineraries: cruises
      .map(parseItineraryPorts)
      .filter((i: RcItineraryPorts | null): i is RcItineraryPorts => i !== null),
    total: Number(results.total) || cruises.length,
  };
}

/** Shared with domains/catalogue.ts, which pages the same endpoint with a wider selection. */
export { headers as searchHeaders, URL_ as SEARCH_URL };
