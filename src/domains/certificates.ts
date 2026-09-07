import { USER_AGENT } from '../http.ts';

/**
 * Instant Reward Certificates.
 *
 * A second class of casino offer that is not in any player's API at all. Royal
 * publishes them as PDFs under a predictable path, one campaign a month per
 * region, and each campaign PDF links to one PDF per tier. Because they are
 * public, this is the one offer class where the *whole* catalogue — every tier,
 * not just the one a player holds — can be seen.
 *
 *   campaign  {base}/{YY}{MM}{suffix}.pdf         e.g. 2609A.pdf
 *   tier      {base}/{YY}{MM}{suffix}{tier}.pdf   e.g. 2609A04.pdf, 2609AVIP1.pdf
 *
 * Discovery is by asking: generate the candidate codes for the months around
 * now and HEAD each URL. Parsing works on text positions extracted from the
 * PDFs by the caller (this library carries no PDF dependency), because every
 * cell of the tier table is its own text item and column membership is a
 * matter of where it sits under the header.
 *
 * Ported from the old platform's discover/process tasks, with one structural
 * change: the old parser split rows on tab characters, which depended on the
 * extractor's join behaviour. Positions do not.
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

/** The PDF bytes. Parsing is the caller's; this library carries no PDF dependency. */
export async function downloadPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

/* ── Parsing, over extracted text positions ───────────────────────────────── */

export interface TextCell { x: number; str: string }
/** One visual line of a page: cells left to right. */
export interface TextLine { y: number; cells: TextCell[] }
export type PageLines = TextLine[];

export interface InstantTier {
  offerCode: string;
  campaignCode: string;
  tier: string;
  points: number | null;
  tradeInValue: number | null;
  pdfUrl: string;
}

/**
 * The campaign page: one link per tier PDF, and the text lists each offer code
 * followed by its points ("2609AVIP1" / "70,000 Points"). Codes come from the
 * link filenames, which are more reliable than the text; points come from the
 * text; a campaign whose page could not be read falls back to DEFAULT_TIERS.
 */
export function parseCampaignPage(
  code: string, lines: PageLines, links: string[],
): InstantTier[] {
  const flat = lines.flatMap((l) => l.cells.map((c) => c.str.trim())).filter(Boolean);
  const points = new Map<string, number>();
  for (let i = 0; i < flat.length - 1; i++) {
    const cur = flat[i]!, next = flat[i + 1]!;
    const pm = next.match(/^([\d,]+)\s*Points$/i);
    if (pm && splitOfferCode(cur)) points.set(cur, Number(pm[1]!.replace(/,/g, '')));
  }

  const tiers = new Map<string, InstantTier>();
  for (const url of links) {
    if (!url.endsWith('.pdf')) continue;
    // The old platform fixed a known typo in Royal's links; keep that.
    const offerCode = url.split('/').pop()!.replace('.pdf', '').replace('CHNN', 'CHN');
    const split = splitOfferCode(offerCode);
    if (!split || split.campaignCode !== code || tiers.has(offerCode)) continue;
    tiers.set(offerCode, {
      offerCode, campaignCode: code, tier: split.tier,
      points: points.get(offerCode) ?? DEFAULT_TIERS.find((d) => d.tier === split.tier)?.points ?? null,
      tradeInValue: tierTradeInValue(split.tier),
      pdfUrl: tierPdfUrl(offerCode),
    });
  }
  if (tiers.size > 0) return [...tiers.values()];

  return DEFAULT_TIERS.map(({ tier, points: p }) => ({
    offerCode: `${code}${tier}`, campaignCode: code, tier, points: p,
    tradeInValue: tierTradeInValue(tier), pdfUrl: tierPdfUrl(`${code}${tier}`),
  }));
}

export interface InstantSailing {
  offerCode: string;
  shipName: string;
  departurePort: string;
  sailDate: string | null;
  itinerary: string;
  nights: number | null;
  /** As printed, e.g. "Balcony - GTY". */
  stateroomType: string;
  /** INTERIOR / OCEANVIEW / BALCONY / SUITE, matching the room-pricing types. */
  roomType: string;
  isGuarantee: boolean;
  /** As printed: "Cruise Fare For 2 Guests" or "… For 1 Guest". */
  offerType: string;
  /** "For 1 Guest": the comp covers one fare and the second guest pays. */
  secondGuestPays: boolean;
  freePlay: number | null;
  onboardCredit: number | null;
}

export interface TierParse {
  sailings: InstantSailing[];
  /** Non-table lines from the first page, for the offer's terms. */
  notes: string[];
  description: string | null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** "September 1, 2026" → 2026-09-01. */
export function normalizeSailDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const long = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (long) {
    const m = MONTHS.indexOf(long[1]!.toLowerCase());
    if (m >= 0) return `${long[3]}-${String(m + 1).padStart(2, '0')}-${long[2]!.padStart(2, '0')}`;
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const y = slash[3]!.length === 2 ? `20${slash[3]}` : slash[3]!;
    return `${y}-${slash[1]!.padStart(2, '0')}-${slash[2]!.padStart(2, '0')}`;
  }
  return null;
}

export function roomTypeOf(stateroom: string): string {
  const u = stateroom.toUpperCase();
  if (u.includes('INTERIOR') || u.includes('INSIDE')) return 'INTERIOR';
  if (u.includes('OCEAN') || u.includes('OUTSIDE')) return 'OCEANVIEW';
  if (u.includes('BALCONY') || u.includes('VERANDA')) return 'BALCONY';
  if (u.includes('SUITE')) return 'SUITE';
  return 'INTERIOR';
}

const money = (s: string | undefined): number | null => {
  const m = (s ?? '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

const HEADER_KEYS: Record<string, keyof RawRow> = {
  'offer code': 'offerCode', ship: 'ship', 'departure port': 'port', 'sail date': 'sailDate',
  itinerary: 'itinerary', 'stateroom type': 'stateroom', 'offer type': 'offerType',
  'next cruise bonus': 'bonus', 'next cruise obc': 'obc',
  'next cruise bonus stateroom type': 'stateroom',
};
interface RawRow {
  offerCode?: string; ship?: string; port?: string; sailDate?: string; itinerary?: string;
  stateroom?: string; offerType?: string; bonus?: string; obc?: string;
}

/**
 * A tier PDF: every page repeats the header, and each cell of each row is its
 * own text item. A cell belongs to the header column it sits under, so a long
 * itinerary split across two items still lands in one column.
 */
export function parseTierPages(pages: PageLines[]): TierParse {
  const sailings: InstantSailing[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  pages.forEach((lines, pageIndex) => {
    let columns: { x: number; key: keyof RawRow }[] | null = null;

    for (const line of lines) {
      const cells = line.cells.filter((c) => c.str.trim() !== '');
      if (cells.length === 0) continue;
      const first = cells[0]!.str.trim().toLowerCase();

      if (first === 'offer code') {
        columns = cells
          .map((c) => ({ x: c.x, key: HEADER_KEYS[c.str.trim().toLowerCase()] }))
          .filter((c): c is { x: number; key: keyof RawRow } => !!c.key);
        continue;
      }
      if (!columns || !splitOfferCode(cells[0]!.str.trim())) {
        if (pageIndex === 0) notes.push(cells.map((c) => c.str.trim()).join(' '));
        continue;
      }

      const row: RawRow = {};
      for (const cell of cells) {
        // The nearest header at or left of the cell; a cell left of every
        // header belongs to the first column.
        let col = columns[0]!;
        for (const c of columns) if (c.x <= cell.x + 2) col = c;
        row[col.key] = row[col.key] ? `${row[col.key]} ${cell.str.trim()}` : cell.str.trim();
      }
      if (!row.offerCode || !row.ship || !row.sailDate) continue;

      const stateroom = (row.stateroom ?? '').trim();
      const ship = row.ship.replace(/[®™]/g, '').trim();
      const sailing: InstantSailing = {
        offerCode: row.offerCode.trim(),
        shipName: ship,
        departurePort: (row.port ?? '').trim(),
        sailDate: normalizeSailDate(row.sailDate),
        itinerary: (row.itinerary ?? '').trim(),
        nights: (() => { const m = (row.itinerary ?? '').match(/(\d+)\s*Night/i); return m ? Number(m[1]) : null; })(),
        stateroomType: stateroom,
        roomType: roomTypeOf(stateroom),
        isGuarantee: /\bGTY\b/i.test(stateroom),
        offerType: (row.offerType ?? '').trim(),
        secondGuestPays: /for\s+1\s+guest/i.test(row.offerType ?? ''),
        freePlay: money(row.bonus),
        onboardCredit: money(row.obc),
      };
      const key = `${sailing.offerCode}|${sailing.shipName}|${sailing.sailDate}|${sailing.stateroomType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sailings.push(sailing);
    }
  });

  const description = notes.find((n) => /just pay|cruise fare|freeplay|free play/i.test(n)) ?? null;
  return { sailings, notes, description };
}
