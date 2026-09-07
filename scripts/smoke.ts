/**
 * Live smoke test: exercise every domain against a real account.
 *
 * Credentials come from RC_USERNAME / RC_PASSWORD in the environment — they are
 * never written to disk here, and nothing personal is printed beyond what is
 * needed to see that a call worked.
 *
 *   RC_USERNAME=… RC_PASSWORD=… node scripts/smoke.ts
 */
import { RcClient } from '../src/index.ts';

const username = process.env.RC_USERNAME;
const password = process.env.RC_PASSWORD;
if (!username || !password) {
  console.error('Set RC_USERNAME and RC_PASSWORD.');
  process.exit(1);
}

const line = (label: string, detail: string) =>
  console.log(`  ${label.padEnd(18)} ${detail}`);

const rc = new RcClient({ username, password });

console.log('\n— auth —');
const verified = await rc.verify();
line('signIn', verified.ok ? `ok, account ${verified.accountId}` : `FAILED: ${verified.reason}`);
if (!verified.ok) process.exit(1);

const session = await rc.session();
line('token expires', session.expiresAt.toLocaleTimeString());
line('vdsId', session.vdsId ? 'present' : 'absent');

console.log('\n— account —');
const account = await rc.account();
line('name', `${account.firstName ?? '?'} ${account.lastName ?? ''}`.trim());
line('crown & anchor', `${account.crownAndAnchorTier ?? 'none'} (${account.crownAndAnchorPoints} pts)`);
line('club royale', `${account.clubRoyaleTier ?? 'none'} (${account.clubRoyalePoints} pts)`);
line('loyalty id', account.crownAndAnchorId ? 'present' : 'MISSING');

console.log('\n— casino loyalty —');
const loyalty = await rc.casinoLoyalty();
line('tier', loyalty ? `${loyalty.tier} (${loyalty.individualPoints} pts)` : 'no casino profile');
if (loyalty) line('period', `${loyalty.periodStart} → ${loyalty.periodEnd}`);

console.log('\n— offers —');
const offers = await rc.offers();
line('outcome', `${offers.outcome} · ${offers.offers.length} of ${offers.totalOffers}`);
for (const o of offers.offers.slice(0, 8)) {
  line(o.offerCode, [
    o.campaignName ?? '',
    o.freePlay ? `$${o.freePlay} FP` : '',
    o.tradeInValue ? `$${o.tradeInValue} trade-in` : '',
    o.bookBy ? `book by ${o.bookBy}` : '',
  ].filter(Boolean).join(' · '));
}
// Every offer currently comes back with an empty `sailings`; say so plainly
// rather than leaving a silent zero that looks like a mapping bug.
line('sailings', offers.offers.some((o) => o.sailings.length > 0)
  ? 'populated'
  : 'none — this API version exposes no sailings route');

console.log('\n— bookings —');
const bookings = await rc.bookings();
line('count', String(bookings.length));
for (const b of bookings.slice(0, 5)) {
  line(b.bookingId, b.enriched
    ? `${b.shipName ?? b.shipCode ?? '?'} ${b.sailDate ?? ''} ${b.packageCode ?? ''}`.trim()
    : `link only (${b.linkType ?? 'unknown'}) — enrichment returned nothing`);
}

// Prefer a real booking, but fall back to a known on-sale sailing so the
// pricing domains are still exercised on an account with nothing linked.
const target = bookings.find((b) => b.enriched && b.packageCode && b.sailDate) ?? {
  shipCode: process.env.SMOKE_SHIP ?? 'LE',
  packageCode: process.env.SMOKE_PACKAGE ?? 'LE08D147',
  sailDate: process.env.SMOKE_SAIL_DATE ?? '2026-11-14',
} as { shipCode: string; packageCode: string; sailDate: string };

console.log('\n— rooms —');
if (target) {
  const rooms = await rc.allRooms({ packageCode: target.packageCode!, sailDate: target.sailDate! });
  line('categories', `${rooms.length} across ${new Set(rooms.map((r) => r.occupancy.adults)).size} occupancies`);
  for (const r of rooms.slice(0, 5)) {
    line(r.categoryCode, `${r.allIn === null ? 'unpriced' : '$' + r.allIn} ${r.name ?? ''}`);
  }
}

console.log('\n— products —');
if (target) {
  const end = new Date(new Date(target.sailDate! + 'T00:00:00Z').getTime() + 14 * 864e5)
    .toISOString().slice(0, 10);
  const { products, failed } = await rc.products({
    shipCode: target.shipCode!, startDate: target.sailDate!, endDate: end,
  });
  line('products', `${products.length} (${failed.length} categories failed)`);
  for (const f of failed) line(`  ${f.category}`, f.reason.slice(0, 70));
  for (const p of products.slice(0, 4)) {
    line(p.category, `$${p.price ?? '?'}${p.msrp && p.msrp !== p.price ? ` (was $${p.msrp})` : ''} ${p.title ?? ''}`);
  }
}

console.log('\n— search (no auth) —');
const search = await RcClient.search({ limit: 3 });
line('total', String(search.total));
for (const c of search.cruises.slice(0, 3)) {
  line(c.shipCode ?? '?', `${c.nights ?? '?'}n ${c.itineraryName ?? ''}`.slice(0, 70));
}

console.log('\ndone.\n');
