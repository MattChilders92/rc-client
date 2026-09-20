import { DEFAULT_TIERS, splitOfferCode, tierPdfUrl, tierTradeInValue } from './discover.ts';

/**
 * Instant Reward PDF parsing, over extracted text positions.
 *
 * Works on text positions extracted from the campaign and tier PDFs by the
 * caller (this library carries no PDF dependency): every cell of the tier
 * table is its own text item and column membership is a matter of where it
 * sits under the header.
 */

/** A text item: its left edge, its text, and (when the extractor knows it) its width. */
export interface TextCell { x: number; str: string; w?: number }
/** One visual line of a page: cells left to right. */
export interface TextLine { y: number; cells: TextCell[] }
/** A page's worth of text lines, as extracted by the caller's PDF library. */
export type PageLines = TextLine[];

/** One tier PDF's identity and stated point threshold, as `parseCampaignPage` reads it off the campaign page. */
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

/** One row of a tier PDF's table: a sailing the tier's offer can be redeemed on. */
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

/** What `parseTierPages` returns: every sailing row found, plus the surrounding prose. */
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

/**
 * Identity of a sailing line within a tier PDF. The store keys rows on this
 * too, so the parser's dedupe and the database's conflict target cannot drift.
 */
export function instantSailingKey(s: Pick<InstantSailing, 'shipName' | 'sailDate' | 'stateroomType' | 'offerType'>): string {
  return `${s.shipName}|${s.sailDate ?? ''}|${s.stateroomType}|${s.offerType}`;
}

/**
 * Normalise a tier PDF's free-text stateroom description to the same
 * INTERIOR/OCEANVIEW/BALCONY/SUITE vocabulary `rooms.ts` uses, so a
 * certificate's rooms can be compared against live room-pricing results.
 * Unrecognised text falls back to INTERIOR rather than throwing.
 */
export function roomTypeOf(stateroom: string): string {
  const u = stateroom.toUpperCase();
  if (u.includes('INTERIOR') || u.includes('INSIDE')) return 'INTERIOR';
  if (u.includes('OCEAN') || u.includes('OUTSIDE')) return 'OCEANVIEW';
  if (u.includes('BALCONY') || u.includes('VERANDA')) return 'BALCONY';
  // The VIP tiers name suite categories without the word: Owners Loft, Sky
  // Loft, Star Loft, Royal Loft, Crown Loft, Aqua Theater / Aquatheater.
  if (/SUITE|LOFT|AQUA ?THEAT|OWNER|VILLA|PENTHOUSE/.test(u)) return 'SUITE';
  return 'INTERIOR';
}

// Not the shared `coerce.ts` money(): that one rejects zero, this one just
// strips a leading `$` and allows a zero dollar amount.
const dollarsFromCell = (s: string | undefined): number | null => {
  const m = (s ?? '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

const HEADER_KEYS: Record<string, keyof RawRow> = {
  'offer code': 'offerCode', ship: 'ship', 'departure port': 'port', 'sail date': 'sailDate',
  itinerary: 'itinerary', 'stateroom type': 'stateroom', 'offer type': 'offerType',
  'next cruise bonus': 'bonus', 'next cruise obc': 'obc',
  'next cruise bonus stateroom type': 'stateroom',
  // Some tiers label the stateroom column just "Offer" and carry no offer-type column.
  offer: 'stateroom',
  'next cruise bonus offer': 'stateroom',
};
/**
 * Royal re-labels the stateroom column per tier ('Stateroom Type', 'Offer',
 * 'Next Cruise Bonus Offer', 'Next Cruise Bonus Stateroom Type'); an unmapped
 * header would let its cells drift to the nearest mapped neighbour, so any
 * unknown label that is not 'Offer Type' and mentions stateroom or a bonus is
 * taken as the stateroom column.
 */
function headerKey(label: string): keyof RawRow | undefined {
  const l = label.trim().toLowerCase();
  if (HEADER_KEYS[l]) return HEADER_KEYS[l];
  if (l !== 'offer type' && /stateroom|bonus/.test(l)) return 'stateroom';
  return undefined;
}
interface RawRow {
  offerCode?: string; ship?: string; port?: string; sailDate?: string; itinerary?: string;
  stateroom?: string; offerType?: string; bonus?: string; obc?: string;
}

const center = (c: TextCell) => c.x + (c.w ?? 0) / 2;

/**
 * A tier PDF: every page repeats the header, and each cell of each row is its
 * own text item. Royal centres every cell under its header, so a cell belongs
 * to the header whose centre is nearest its own — a long itinerary split
 * across two items still lands in one column, and a ship name that starts
 * left of the "Ship" header is still the ship.
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
          .map((c) => ({ x: center(c), key: headerKey(c.str) }))
          .filter((c): c is { x: number; key: keyof RawRow } => !!c.key);
        continue;
      }
      if (!columns || !splitOfferCode(cells[0]!.str.trim())) {
        if (pageIndex === 0) notes.push(cells.map((c) => c.str.trim()).join(' '));
        continue;
      }

      const row: RawRow = {};
      for (const cell of cells) {
        const x = center(cell);
        let col = columns[0]!;
        for (const c of columns) if (Math.abs(c.x - x) < Math.abs(col.x - x)) col = c;
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
        freePlay: dollarsFromCell(row.bonus),
        onboardCredit: dollarsFromCell(row.obc),
      };
      const key = instantSailingKey(sailing);
      if (seen.has(key)) continue;
      seen.add(key);
      sailings.push(sailing);
    }
  });

  // The offer's terms are the headline lines around the table, in reading order.
  const terms = notes.filter((n) => /just pay|cruise fare|freeplay|free play/i.test(n));
  const description = terms.length ? terms.join(' ') : null;
  return { sailings, notes, description };
}
