import { request, USER_AGENT } from '../http.ts';

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

export interface RcSailingSummary {
  sailingId: string;
  sailDate: string | null;
  startDate: string | null;
  endDate: string | null;
  itineraryCode: string | null;
  bookingLink: string | null;
}

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

export interface SearchResult {
  cruises: RcCruise[];
  total: number;
}

export interface SearchParams {
  /** Royal's own filter string, e.g. `{"ship":["LE"]}`. Defaults to no filter. */
  filters?: string;
  sortBy?: 'RECOMMENDED' | 'PRICE' | 'DATE';
  limit?: number;
  page?: number;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

function headers(): Record<string, string> {
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
    'user-agent': USER_AGENT,
    referer: 'https://www.royalcaribbean.com/',
    // The site sends a session uuid; any valid one is accepted.
    'x-session-id': crypto.randomUUID(),
  };
}

export async function searchCruises(params: SearchParams = {}): Promise<SearchResult> {
  const limit = params.limit ?? 25;
  const page = params.page ?? 1;

  const res = await request<any>(URL_, {
    method: 'POST',
    headers: headers(),
    body: {
      operationName: 'cruiseSearch_Cruises',
      variables: {
        filters: params.filters ?? '{}',
        sort: { by: params.sortBy ?? 'RECOMMENDED' },
        pagination: { count: limit, skip: (page - 1) * limit },
      },
      query: QUERY,
    },
  });

  // GraphQL reports failures inside a 200, so errors have to be read out.
  if (Array.isArray(res.data?.errors) && res.data.errors.length) {
    const first = res.data.errors[0];
    throw new Error(`Cruise search failed: ${first?.message ?? 'unknown GraphQL error'}`);
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
