import type { RcSession } from '../auth/index.ts';
import { commerceHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { RcShapeError } from '../errors.ts';
import { str, num, int } from '../coerce.ts';
import { resolveConfig, type RcConfig } from '../config.ts';

/**
 * Voyage-scoped sailing detail: nights, itinerary, ports and whether Royal is
 * still selling the sailing — keyed by ship code + sail date rather than by
 * account or booking.
 *
 * `listBookings`'s enrichment (`domains/bookings.ts`) is account-scoped and can
 * return an empty list for accounts that demonstrably have reservations. This
 * endpoint answers for the sailing itself, independent of whose booking (if
 * any) is attached to it — including sailings absent from the public cruise
 * search. It is also the only source here for `isSailingClosed`, which tells
 * "Royal stopped selling this sailing" apart from "we have not collected it",
 * a distinction the downstream data cannot make on its own.
 *
 * Authenticated like the other commerce calls, but with three additions this
 * endpoint specifically wants — verified live, not documented anywhere:
 * `req-app-id` overridden to the customer-journey app identity rather than
 * `commerceHeaders`' own `Royal.Web.PlanMyCruise`, a matching `req-app-vers`,
 * and `vds-id` when the session carries one. These stay call-site additions
 * here rather than a new `headers.ts` profile — `domains/bookings.ts` already
 * overrides `req-app-id` to this same `Royal.Web.CustomerJourney` identity for
 * its own endpoint (with a different `req-app-vers` and a different `vds-id`
 * source), so this is a second data point for an existing pattern, not a
 * structural difference that would justify a fourth profile.
 */

const BASE = 'https://aws-prd.api.rccl.com/en/royal/web/v3/ships/voyages';

/** Compact `YYYYMMDD` → `YYYY-MM-DD`. Null for anything absent or unparseable — never a guess. */
function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** Compact `YYYYMMDDTHHMMSS` → `YYYY-MM-DDTHH:MM:SS`. Null for anything absent or unparseable. */
function isoDateTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(se);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
}

/** One call on the itinerary: embarkation, a day at sea, a port of call, or disembarkation. */
export interface RcVoyagePort {
  portCode: string | null;
  /**
   * `EMBARK`, `DOCKED`, `CRUISING` or `DEBARK` on every sailing seen so far.
   * Kept as `string`, not a union, since Royal has not documented the set as
   * closed.
   */
  portType: string | null;
  day: number | null;
  arrivalDateTime: string | null;
  departureDateTime: string | null;
  title: string | null;
}

/** Ship code and sail date — the two things a voyage id is built from. */
export interface VoyageParts {
  shipCode: string;
  /** `YYYY-MM-DD`. Converted to Royal's compact form internally. */
  sailDate: string;
}

/** Voyage-scoped sailing detail, mapped from `payload.sailingInfo[0]`. */
export interface RcVoyage {
  voyageId: number | null;
  shipCode: string | null;
  shipName: string | null;
  /** `R` Royal Caribbean, `C` Celebrity. Kept as `string`, not `Brand`, since this is unvalidated wire data. */
  brand: string | null;
  regionCode: string | null;
  voyageType: string | null;
  canceled: boolean;
  charter: boolean;
  /**
   * Distinguishes "Royal is not selling this sailing" from "we have not
   * collected it" — the two look identical from booking data alone.
   */
  isSailingClosed: boolean;
  nights: number | null;
  sailDate: string | null;
  sailingEndDate: string | null;
  /**
   * The itinerary code, e.g. `"08D147"`. A booking's package code for the same
   * sailing is `shipCode + itineraryCode` (e.g. `"LE08D147"`) — this is the
   * itinerary code alone, not the package code.
   */
  itineraryCode: string | null;
  itineraryName: string | null;
  departurePort: string | null;
  departurePortName: string | null;
  departurePortCountryCode: string | null;
  arrivalPort: string | null;
  arrivalPortName: string | null;
  arrivalPortCountryCode: string | null;
  /** Every port call, in order — nine on a typical week-plus sailing, including embark and debark. */
  ports: RcVoyagePort[];
  /** The untouched `sailingInfo[0]` record, so a field added later needs no library change. */
  raw: unknown;
}

/**
 * Maps one `sailingInfo[0]` record into `RcVoyage`. Pure, so the mapping is
 * tested without a network call.
 *
 * Returns `null` when the record carries no `itineraryCode` — the field this
 * whole endpoint exists for — rather than a half-mapped voyage.
 */
export function parseVoyage(info: unknown): RcVoyage | null {
  const p = info as any;
  const itineraryCode = str(p?.itineraryCode);
  if (!itineraryCode) return null;

  const it = p?.itinerary ?? {};
  const ports: RcVoyagePort[] = Array.isArray(it.portInfo)
    ? it.portInfo.map((port: any) => ({
        portCode: str(port?.portCode),
        portType: str(port?.portType),
        day: int(port?.day),
        arrivalDateTime: isoDateTime(port?.arrivalDateTime),
        departureDateTime: isoDateTime(port?.departureDateTime),
        title: str(port?.title),
      }))
    : [];

  return {
    voyageId: int(p?.voyageId),
    shipCode: str(p?.shipCode),
    shipName: str(p?.shipName),
    brand: str(p?.brand),
    regionCode: str(p?.regionCode),
    voyageType: str(p?.voyageType),
    canceled: p?.canceled === true,
    charter: p?.charter === true,
    isSailingClosed: p?.isSailingClosed === true,
    nights: num(p?.duration),
    sailDate: isoDate(p?.sailDate),
    sailingEndDate: isoDate(p?.sailingEndDate),
    itineraryCode,
    itineraryName: str(it.description),
    departurePort: str(p?.departurePort),
    departurePortName: str(p?.departurePortName),
    departurePortCountryCode: str(p?.departurePortCountryCode),
    arrivalPort: str(p?.arrivalPort),
    arrivalPortName: str(p?.arrivalPortName),
    arrivalPortCountryCode: str(p?.arrivalPortCountryCode),
    ports,
    raw: p,
  };
}

/**
 * Builds the voyage id `fetchVoyage` takes, from a ship code and a sail date —
 * the ship code followed by the sail date with its dashes stripped, e.g.
 * `voyageId('LE', '2026-11-14')` → `'LE20261114'`. Saves every caller from
 * reimplementing Royal's compact-date convention by hand.
 */
export function voyageId(shipCode: string, sailDate: string): string {
  return `${shipCode}${sailDate.replace(/-/g, '')}`;
}

/**
 * Voyage-scoped sailing detail for one sailing: nights, itinerary, ports and
 * `isSailingClosed`, independent of whose booking (if any) is attached to it.
 *
 * Pass either the voyage id directly (`'LE20261114'`) or `{ shipCode,
 * sailDate }`, which is run through `voyageId` for you.
 *
 * A 404 (unknown voyage) throws the library's usual `RcRouteGoneError` rather
 * than being read as "no data" — this endpoint has no legitimate empty case
 * for a well-formed voyage id.
 */
export async function fetchVoyage(
  session: RcSession,
  voyageOrParts: string | VoyageParts,
  config: Partial<RcConfig> = {},
): Promise<RcVoyage> {
  const cfg = resolveConfig(config);
  const id = typeof voyageOrParts === 'string'
    ? voyageOrParts
    : voyageId(voyageOrParts.shipCode, voyageOrParts.sailDate);
  const url = `${BASE}/${encodeURIComponent(id)}/enriched`;

  const headers = {
    ...commerceHeaders(session, cfg),
    // This endpoint wants the customer-journey app identity and its own
    // version, not commerceHeaders' PlanMyCruise defaults — verified live.
    'req-app-id': 'Royal.Web.CustomerJourney',
    'req-app-vers': '1.5.1',
    ...(session.vdsId ? { 'vds-id': session.vdsId } : {}),
  };

  const res = await request<any>(url, { headers, config: cfg });

  const voyage = parseVoyage(res.data?.payload?.sailingInfo?.[0]);
  if (!voyage) {
    throw new RcShapeError('Voyage response carried no sailingInfo with an itinerary code', {
      status: res.status, url, body: res.data,
    });
  }
  return voyage;
}
