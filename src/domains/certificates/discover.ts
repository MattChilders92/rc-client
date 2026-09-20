import { USER_AGENT } from '../../http.ts';

/**
 * Instant Reward campaign discovery.
 *
 * Campaign and tier PDF URL shapes, region/tier constants, and the HEAD-probe
 * sweep that finds which campaign codes Royal has actually published for the
 * months around now.
 *
 *   campaign  {base}/{YY}{MM}{suffix}.pdf         e.g. 2609A.pdf
 *   tier      {base}/{YY}{MM}{suffix}{tier}.pdf   e.g. 2609A04.pdf, 2609AVIP1.pdf
 */

export const INSTANT_PDF_BASE =
  'https://www.royalcaribbean.com/content/dam/royal/resources/pdf/casino/offers';

/** Region suffixes seen on campaign codes, with what the old platform recorded them as. */
export const INSTANT_SUFFIXES = {
  A: 'North America (3–5 nights)',
  C: 'North America (6+ nights)',
  D: 'Europe',
  O: 'Oceania',
  S: 'Singapore',
  P: 'Unknown region',
  CHN: 'China',
} as const;
export type InstantSuffix = keyof typeof INSTANT_SUFFIXES;

/** Tier suffixes and the point thresholds the campaign page lists for them. */
export const DEFAULT_TIERS: ReadonlyArray<{ tier: string; points: number }> = [
  { tier: 'VIP1', points: 70000 }, { tier: 'VIP2', points: 40000 },
  { tier: '01', points: 25000 }, { tier: '02', points: 15000 }, { tier: '02A', points: 9000 },
  { tier: '03', points: 6500 }, { tier: '03A', points: 4000 }, { tier: '04', points: 3000 },
  { tier: '05', points: 2000 }, { tier: '06', points: 1500 }, { tier: '07', points: 1200 },
  { tier: '08', points: 800 }, { tier: '09', points: 600 }, { tier: '10', points: 400 },
];

/** Trade-in values by tier, as the old platform carried them. Unverified beyond that. */
const TRADE_IN_BY_TIER: Record<string, number> = {
  '01': 3000, '02': 1500, '03': 1000, '04': 750, '05': 500, '06': 300, '07': 300, '08': 250,
};
export function tierTradeInValue(tier: string): number | null {
  const key = Object.keys(TRADE_IN_BY_TIER).find((k) => tier.startsWith(k));
  return key ? TRADE_IN_BY_TIER[key]! : null;
}

export const campaignCode = (year: number, month1to12: number, suffix: InstantSuffix): string =>
  `${String(year).slice(2)}${String(month1to12).padStart(2, '0')}${suffix}`;
export const campaignPdfUrl = (code: string): string => `${INSTANT_PDF_BASE}/${code}.pdf`;
export const tierPdfUrl = (offerCode: string): string => `${INSTANT_PDF_BASE}/${offerCode}.pdf`;

/** Split an offer code into its campaign and tier: `2609A04` → `2609A` + `04`. */
export function splitOfferCode(offerCode: string): { campaignCode: string; tier: string } | null {
  const m = offerCode.match(/^(\d{4}(?:CHN|[A-Z]))(VIP\d|\d{2}[A-Z]?)$/);
  return m ? { campaignCode: m[1]!, tier: m[2]! } : null;
}

export interface CandidateCampaign {
  code: string;
  suffix: InstantSuffix;
  region: string;
  /** First day of the campaign's month, ISO. */
  month: string;
  url: string;
}

/** Codes for the months around now. The old platform checked −1 … +2. */
export function candidateCampaigns(
  opts: { monthsBack?: number; monthsAhead?: number; now?: Date } = {},
): CandidateCampaign[] {
  const { monthsBack = 1, monthsAhead = 2, now = new Date() } = opts;
  const out: CandidateCampaign[] = [];
  for (let off = -monthsBack; off <= monthsAhead; off++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + off, 1));
    for (const suffix of Object.keys(INSTANT_SUFFIXES) as InstantSuffix[]) {
      const code = campaignCode(d.getUTCFullYear(), d.getUTCMonth() + 1, suffix);
      out.push({
        code, suffix, region: INSTANT_SUFFIXES[suffix],
        month: d.toISOString().slice(0, 10), url: campaignPdfUrl(code),
      });
    }
  }
  return out;
}

async function exists(url: string, timeoutMs: number): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, signal: ctl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Which candidate campaigns Royal has actually published. HEADs in small
 * parallel batches, the way the old platform did; a missing month is the
 * normal case, not an error.
 */
export async function discoverInstantCampaigns(
  opts: { monthsBack?: number; monthsAhead?: number; now?: Date; batch?: number; timeoutMs?: number } = {},
): Promise<CandidateCampaign[]> {
  const { batch = 7, timeoutMs = 4000 } = opts;
  const candidates = candidateCampaigns(opts);
  const found: CandidateCampaign[] = [];
  for (let i = 0; i < candidates.length; i += batch) {
    const slice = candidates.slice(i, i + batch);
    const results = await Promise.all(slice.map((c) => exists(c.url, timeoutMs)));
    results.forEach((ok, j) => { if (ok) found.push(slice[j]!); });
  }
  return found;
}
