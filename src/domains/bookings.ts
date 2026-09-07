import type { RcSession } from '../auth/index.ts';
import { commerceHeaders } from '../headers.ts';
import { request } from '../http.ts';

/**
 * The guest's own reservations.
 *
 * Useful beyond listing trips: each booking carries the ship code, package code
 * and sail date needed to price cabins or products for that sailing, so a
 * tracker can discover what to watch instead of being told.
 */

const BASE = 'https://aws-prd.api.rccl.com';

export interface RcBooking {
  reservationId: string;
  shipCode: string | null;
  shipName: string | null;
  packageCode: string | null;
  sailDate: string | null;
  returnDate: string | null;
  nights: number | null;
  itineraryName: string | null;
  stateroomNumber: string | null;
  stateroomCategory: string | null;
  guestCount: number | null;
  raw: unknown;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

const day = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function mapBooking(b: any): RcBooking {
  const sailing = b?.sailing ?? b?.cruise ?? {};
  const room = b?.stateroom ?? b?.cabin ?? {};
  return {
    reservationId: String(b?.reservationId ?? b?.bookingId ?? b?.id ?? ''),
    shipCode: str(sailing.shipCode ?? b?.shipCode),
    shipName: str(sailing.shipName ?? b?.shipName),
    packageCode: str(sailing.packageCode ?? b?.packageCode),
    sailDate: day(sailing.sailDate ?? b?.sailDate ?? b?.departureDate),
    returnDate: day(sailing.returnDate ?? b?.returnDate),
    nights: b?.nights === undefined ? null : Number(b.nights) || null,
    itineraryName: str(sailing.itineraryName ?? b?.itineraryName),
    stateroomNumber: str(room.number ?? b?.stateroomNumber),
    stateroomCategory: str(room.category ?? b?.stateroomCategory),
    guestCount: Array.isArray(b?.guests) ? b.guests.length : null,
    raw: b,
  };
}

export interface ListBookingsOptions {
  brand?: 'R' | 'C';
  includeCheckin?: boolean;
}

/**
 * Reservations linked to the online profile.
 *
 * Note that a booking made by phone or through a casino host is not necessarily
 * attached to the web account: such a profile returns 200 with an empty list,
 * which is a real answer and not an error.
 */
export async function listBookings(
  session: RcSession,
  opts: ListBookingsOptions = {},
): Promise<RcBooking[]> {
  const url =
    `${BASE}/v1/profileBookings/enriched/${encodeURIComponent(session.accountId)}` +
    `?brand=${opts.brand ?? 'R'}&includeCheckin=${opts.includeCheckin ?? true}`;

  const res = await request<any>(url, {
    headers: commerceHeaders(session),
    // An account with no reservations, rather than a missing route.
    allowStatus: [404],
  });
  if (res.status === 404) return [];

  // The list is `payload.profileBookings`. An account with nothing linked
  // returns 200 with an empty array and `errors: []` — a genuine "none",
  // distinct from a failure.
  const list: any[] = res.data?.payload?.profileBookings ?? [];
  return list.map(mapBooking).filter((b) => b.reservationId);
}
