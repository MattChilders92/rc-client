import type { RcSession } from '../auth/index.ts';
import { casinoHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { num, str } from '../coerce.ts';
import { resolveConfig, type RcConfig } from '../config.ts';
import { brandHost, type Brand } from '../brand.ts';

/**
 * Club Royale standing from the casino system itself.
 *
 * Preferred over the loyalty block on the guest account: it also returns the
 * casino profile id and the annual window tier points are evaluated over, and it
 * is the API the offers page is actually built on.
 *
 * This endpoint validates its own schema and names any header it is missing in
 * the response body, which makes it the easiest Royal API to debug.
 */

const url = (brand: Brand): string => `https://${brandHost(brand)}/api/casino/v1/loyalty-data`;

/** Club Royale standing straight from the casino system — preferred over the guest account's loyalty block. */
export interface CasinoLoyalty {
  /** Casino profile id — distinct from the Crown & Anchor number. */
  casinoLoyaltyId: string | null;
  cruiseLoyaltyId: string | null;
  consumerId: string | null;
  tier: string | null;
  individualPoints: number;
  relationshipPoints: number;
  /** Tier is earned within an annual window; these are its bounds. */
  periodStart: string | null;
  periodEnd: string | null;
  multipleCasinoProfiles: boolean;
  raw: unknown;
}

/**
 * Returns null when the account has no casino profile.
 *
 * `options.brand` selects the casino host; it defaults to `'R'`. It lives on
 * the options object rather than as its own parameter because an existing
 * caller (`RcClient#casinoLoyalty`) already passes a full `RcConfig`
 * positionally in this spot — inserting `brand` ahead of it would silently
 * turn that config object into the `brand` argument instead.
 */
export async function fetchCasinoLoyalty(
  session: RcSession,
  options: Partial<RcConfig> & { brand?: Brand } = {},
): Promise<CasinoLoyalty | null> {
  const { brand = 'R', ...config } = options;
  const cfg = resolveConfig(config);
  const target = url(brand);
  const res = await request<any>(target, {
    headers: casinoHeaders(session, {}, cfg),
    allowStatus: [404],
    config: cfg,
  });
  if (res.status === 404) return null;

  // A schema complaint arrives as HTTP 200 carrying an error envelope.
  if (res.data?.error || !res.data?.data) return null;
  const d = res.data.data;

  return {
    casinoLoyaltyId: str(d.casinoLoyaltyId),
    cruiseLoyaltyId: str(d.cruiseLoyaltyId),
    consumerId: str(d.consumerId),
    tier: str(d.tier),
    individualPoints: num(d.individualPoints) ?? 0,
    relationshipPoints: num(d.relationshipPoints) ?? 0,
    periodStart: str(d.evaluationPeriodStartDateForPoints),
    periodEnd: str(d.evaluationPeriodEndDateForPoints),
    multipleCasinoProfiles: d.multipleCasinoProfiles === true,
    raw: d,
  };
}
