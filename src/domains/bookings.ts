import type { RcSession } from '../auth/index.ts';
import { commerceHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { str } from '../coerce.ts';
import { DEFAULT_CONFIG, type RcConfig } from '../config.ts';

/**
 * The guest's own reservations.
 *
 * There are two endpoints and they are **not** interchangeable:
 *
 *   /v1/profileBookings/{accountId}            the links — always populated
 *   /v1/profileBookings/enriched/{accountId}   the links plus sailing detail
 *
 * `enriched` is the one every existing implementation calls, and it can return
 * an empty array while the plain endpoint returns real bookings for the same
 * account. Observed live: a valid upcoming reservation appears under the plain
 * path and is absent from `enriched`. So the plain path is the source of truth
 * for *which* bookings exist, and enrichment is layered on when it works.
 *
 * The link record carries placeholder values for `shipCode`, `sailDate` and
 * `numberOfNights` — a real 2026 booking came back as ship "NC" sailing in 2039.
 * Those are reported only when enrichment supplied them, which each booking's
 * `enriched` flag tells you.
 */

const BASE = 'https://aws-prd.api.rccl.com';

/** One reservation on the profile. Sailing fields are null unless `enriched` is true. */
export interface RcBooking {
  /** Reservation number, as printed on the booking confirmation. */
  bookingId: string;
  passengerId: string | null;
  consumerId: string | null;
  brand: string | null;
  /** How the booking came to be attached to the profile. */
  linkType: string | null;

  /**
   * True when the sailing details below came from the enriched endpoint. When
   * false every sailing field is null: the link record's own values are
   * placeholders and are deliberately not passed through.
   */
  enriched: boolean;
  shipCode: string | null;
  shipName: string | null;
  packageCode: string | null;
  sailDate: string | null;
  returnDate: string | null;
  nights: number | null;
  itineraryName: string | null;
  stateroomNumber: string | null;
  stateroomCategory: string | null;

  raw: unknown;
}

/** Royal writes dates as `YYYYMMDD` here and ISO elsewhere. */
const day = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function fromLink(link: any): RcBooking {
  return {
    bookingId: String(link?.bookingId ?? link?.reservationId ?? ''),
    passengerId: str(link?.passengerId),
    consumerId: str(link?.consumerId),
    brand: str(link?.brand),
    linkType: str(link?.linkType),
    enriched: false,
    shipCode: null,
    shipName: null,
    packageCode: null,
    sailDate: null,
    returnDate: null,
    nights: null,
    itineraryName: null,
    stateroomNumber: null,
    stateroomCategory: null,
    raw: link,
  };
}

function applyEnrichment(booking: RcBooking, detail: any): RcBooking {
  const sailing = detail?.sailing ?? detail?.cruise ?? detail ?? {};
  const room = detail?.stateroom ?? detail?.cabin ?? {};
  return {
    ...booking,
    enriched: true,
    shipCode: str(sailing.shipCode ?? detail?.shipCode),
    shipName: str(sailing.shipName ?? detail?.shipName),
    packageCode: str(sailing.packageCode ?? detail?.packageCode),
    sailDate: day(sailing.sailDate ?? detail?.sailDate ?? detail?.startDate),
    returnDate: day(sailing.returnDate ?? detail?.endDate),
    nights: detail?.numberOfNights === undefined ? null : Number(detail.numberOfNights) || null,
    itineraryName: str(sailing.itineraryName ?? detail?.itineraryName),
    stateroomNumber: str(room.number ?? detail?.stateroomNumber),
    stateroomCategory: str(room.category ?? detail?.stateroomCategory),
    raw: { link: booking.raw, detail },
  };
}

/** Options for `listBookings`. */
export interface ListBookingsOptions {
  /** `R` for Royal Caribbean, `C` for Celebrity. Defaults to `R`. */
  brand?: 'R' | 'C';
  /**
   * Skip the enrichment call. The links alone say which reservations exist, and
   * enrichment is an extra round trip that frequently returns nothing.
   */
  linksOnly?: boolean;
}

/**
 * Every booking attached to the profile.
 *
 * An account with genuinely nothing linked returns an empty array with
 * `errors: []` — a real answer, not a failure.
 */
export async function listBookings(
  session: RcSession,
  opts: ListBookingsOptions = {},
  config: RcConfig = DEFAULT_CONFIG,
): Promise<RcBooking[]> {
  const brand = opts.brand ?? 'R';
  const headers = {
    ...commerceHeaders(session, config),
    // The bookings service expects the customer-journey app identity.
    'req-app-id': 'Royal.Web.CustomerJourney',
    'req-app-vers': '1.0.7',
    'vds-id': session.accountId,
  };

  const links = await request<any>(
    `${BASE}/v1/profileBookings/${encodeURIComponent(session.accountId)}?brand=${brand}`,
    { headers, allowStatus: [404], config },
  );
  if (links.status === 404) return [];

  const list: any[] = links.data?.payload?.profileBookings ?? [];
  const bookings = list
    .filter((l) => l && l.deleted !== true)
    .map(fromLink)
    .filter((b) => b.bookingId);

  if (opts.linksOnly || bookings.length === 0) return bookings;

  // Enrichment is best-effort: it returns an empty list often enough that a
  // failure here must not lose the bookings already known.
  try {
    const enriched = await request<any>(
      `${BASE}/v1/profileBookings/enriched/${encodeURIComponent(session.accountId)}` +
      `?brand=${brand}&includeCheckin=true`,
      { headers, allowStatus: [404], config },
    );
    const details: any[] = enriched.data?.payload?.profileBookings ?? [];
    const byId = new Map(
      details.map((d) => [String(d?.bookingId ?? d?.reservationId ?? ''), d]),
    );

    return bookings.map((b) => {
      const detail = byId.get(b.bookingId);
      return detail ? applyEnrichment(b, detail) : b;
    });
  } catch {
    return bookings;
  }
}
