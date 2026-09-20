/**
 * Record live responses as test fixtures.
 *
 *   RC_USERNAME=… RC_PASSWORD=… npm run capture
 *
 * Fixtures are committed, so everything identifying is scrubbed on the way in:
 * names, emails, loyalty and consumer numbers, reservation ids, tokens and
 * addresses. Prices, codes, dates and structure are kept, because those are what
 * the tests assert on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../src/auth/index.ts';
import { casinoHeaders, commerceHeaders, guestHeaders } from '../src/headers.ts';
import { REDACT_KEYS } from '../src/redaction.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures');

const username = process.env.RC_USERNAME;
const password = process.env.RC_PASSWORD;
if (!username || !password) {
  console.error('Set RC_USERNAME and RC_PASSWORD.');
  process.exit(1);
}

/**
 * Ids that must stay *distinct* after redaction.
 *
 * One shared placeholder destroys the fact that two records are different
 * things: three separately redeemable grants would come out looking like the
 * same grant three times, and no test could tell. These get a stable surrogate
 * per original value instead — no less scrubbed, but still countable.
 */
const DISTINCT_KEYS = new Set(['playerofferid']);
const surrogates = new Map<string, string>();

function surrogateFor(value: string): string {
  const held = surrogates.get(value);
  if (held) return held;
  const made = `00000000-0000-0000-0000-${String(surrogates.size + 1).padStart(12, '0')}`;
  surrogates.set(value, made);
  return made;
}

/** Values matching these are scrubbed wherever they appear. */
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, 'redacted@example.com'],
  [/\b\d{9,12}\b/g, '000000000'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
   '00000000-0000-0000-0000-000000000000'],
];

function redact(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    // Ahead of the blanket rules: a surrogate is already safe, and the uuid
    // pattern below would otherwise flatten them all back into one value.
    if (DISTINCT_KEYS.has(key.toLowerCase())) return surrogateFor(value);
    if (REDACT_KEYS.has(key.toLowerCase())) return 'REDACTED';
    let out = value;
    for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
    return out;
  }
  if (typeof value === 'number') {
    return REDACT_KEYS.has(key.toLowerCase()) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, k)]),
    );
  }
  return value;
}

async function save(name: string, body: unknown): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(redact(body), null, 2) + '\n');
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

async function grab(name: string, url: string, init: RequestInit): Promise<void> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    console.log(`${name}: HTTP ${res.status}`);
    await save(name, { _status: res.status, body });
  } catch (err) {
    console.error(`${name}: failed — ${(err as Error).message}`);
  }
}

const session = await signIn({ username, password });
console.log(`signed in as ${session.accountId}\n`);

const account = await fetch(
  `https://aws-prd.api.rccl.com/en/royal/web/v3/guestAccounts/${session.accountId}`,
  { headers: guestHeaders(session) },
).then((r) => r.json() as Promise<any>);

const loyaltyId = account?.payload?.loyaltyInformation?.crownAndAnchorId ?? '';

await save('account', { _status: 200, body: account });

await grab('casino-loyalty', 'https://www.royalcaribbean.com/api/casino/v1/loyalty-data', {
  headers: casinoHeaders(session),
});

// A GET with query parameters. The body-carrying POST at
// /api/casino/v2/offers/merged is gone; see docs/endpoints.md.
await grab(
  'offers',
  'https://www.royalcaribbean.com/api/casino/v2/offers/list' +
    '?page=1&limit=100&sortBy=offer.reserveByDate&sortDirection=asc',
  {
    headers: {
      ...casinoHeaders(session, { loyaltyId }),
      'x-environment-marker': '',
      'x-environment-ship-code': '',
    },
  },
);

// One grant's sailings. Plural `details`; the bearer alone is enough.
{
  const firstOffer = (await (await fetch(
    'https://www.royalcaribbean.com/api/casino/v2/offers/list' +
      '?page=1&limit=1&sortBy=offer.reserveByDate&sortDirection=asc',
    { headers: { ...casinoHeaders(session, { loyaltyId }), 'x-environment-marker': '', 'x-environment-ship-code': '' } },
  )).json() as any)?.offers?.[0];
  if (firstOffer?.playerOfferId) {
    await grab(
      'offer-details',
      'https://www.royalcaribbean.com/api/casino/v2/offers/details?' + new URLSearchParams({
        offerCode: firstOffer.campaignOffer.offerCode, playerOfferId: firstOffer.playerOfferId,
        sortBy: 'offer.reserveByDate', sortDirection: 'asc', limit: '1', page: '1', digitalRedemption: 'true',
      }),
      { headers: { ...casinoHeaders(session, { loyaltyId }), 'x-environment-marker': '', 'x-environment-ship-code': '' } },
    );
  }
}

// The plain endpoint, not `enriched` — the latter can return an empty list for
// an account that demonstrably has bookings.
const bookingHeaders = {
  ...commerceHeaders(session),
  'req-app-id': 'Royal.Web.CustomerJourney',
  'req-app-vers': '1.0.7',
  'vds-id': session.accountId,
};

await grab('bookings',
  `https://aws-prd.api.rccl.com/v1/profileBookings/${session.accountId}?brand=R`,
  { headers: bookingHeaders });

await grab('bookings-enriched',
  `https://aws-prd.api.rccl.com/v1/profileBookings/enriched/${session.accountId}?brand=R&includeCheckin=true`,
  { headers: bookingHeaders });

// A sailing that is reliably on sale, so room and product fixtures stay stable.
const SHIP = process.env.CAPTURE_SHIP ?? 'LE';
const PACKAGE = process.env.CAPTURE_PACKAGE ?? 'LE08D147';
const SAIL_DATE = process.env.CAPTURE_SAIL_DATE ?? '2026-11-14';

await grab('rooms',
  `https://www.royalcaribbean.com/itinerary/api/v1/sailings?packageCode=${PACKAGE}` +
  `&sailDate=${SAIL_DATE}&adults=2&children=0&countryCode=USA&currencyCode=USD` +
  `&languageCode=en&officeCode=MIA`,
  { headers: { accept: 'application/json, text/plain, */*', referer: 'https://www.royalcaribbean.com/' } });

await grab('products-beverage',
  `https://aws-prd.api.rccl.com/en/royal/web/commerce-api/catalog/v2/${SHIP}` +
  `/categories/beverage/products?startDate=${SAIL_DATE.replace(/-/g, '')}` +
  `&endDate=${SAIL_DATE.replace(/-/g, '')}&currentPage=0&pageSize=25&currencyIso=USD&regionCode=ALCAN`,
  {
    method: 'POST',
    headers: commerceHeaders(session),
    body: JSON.stringify({ textSearch: null, sortKey: 'rRank-asc', filterFacets: null }),
  });

console.log('\ncapture complete — review the fixtures before committing.');
