import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateCampaigns, campaignPdfUrl, splitOfferCode, parseCampaignPage, parseTierPages,
  normalizeSailDate, roomTypeOf, tierTradeInValue, type PageLines,
} from '../src/domains/certificates/index.ts';

// These fixtures are transcribed from the public 2609A campaign and 2609A04
// tier PDFs. They are Royal's marketing documents, not anyone's data.

test('candidate codes cover the months around now, one per region suffix', () => {
  const c = candidateCampaigns({ now: new Date('2026-09-07T00:00:00Z') });
  const codes = c.map((x) => x.code);
  assert.equal(codes.length, 4 * 7);                        // −1 … +2 months × 7 suffixes
  assert.ok(codes.includes('2608A') && codes.includes('2609CHN') && codes.includes('2611D'));
  assert.equal(campaignPdfUrl('2609A'),
    'https://www.royalcaribbean.com/content/dam/royal/resources/pdf/casino/offers/2609A.pdf');
});

test('an offer code splits into campaign and tier, including VIP and lettered tiers', () => {
  assert.deepEqual(splitOfferCode('2609A04'), { campaignCode: '2609A', tier: '04' });
  assert.deepEqual(splitOfferCode('2609AVIP1'), { campaignCode: '2609A', tier: 'VIP1' });
  assert.deepEqual(splitOfferCode('2609A02A'), { campaignCode: '2609A', tier: '02A' });
  assert.deepEqual(splitOfferCode('2609CHN03'), { campaignCode: '2609CHN', tier: '03' });
  assert.equal(splitOfferCode('26BAF304'), null);           // a player offer, not a certificate
});

test('the campaign page yields one tier per linked PDF, with points read from the text', () => {
  const lines: PageLines = [
    { y: 700, cells: [{ x: 50, str: 'To view eligible sailings for each offer code,' }] },
    { y: 660, cells: [{ x: 50, str: '2609AVIP1' }] }, { y: 645, cells: [{ x: 50, str: '70,000 Points' }] },
    { y: 620, cells: [{ x: 50, str: '2609A04' }] }, { y: 605, cells: [{ x: 50, str: '3,000 Points' }] },
    { y: 580, cells: [{ x: 50, str: '2609A10' }] }, { y: 565, cells: [{ x: 50, str: '400 Points' }] },
  ];
  const base = 'https://www.royalcaribbean.com/content/dam/royal/resources/pdf/casino/offers/';
  // Royal's page carries every link twice.
  const links = ['2609AVIP1', '2609AVIP1', '2609A04', '2609A04', '2609A10', '2609A10'].map((c) => base + c + '.pdf');
  const tiers = parseCampaignPage('2609A', lines, links);
  assert.deepEqual(tiers.map((t) => [t.offerCode, t.tier, t.points, t.tradeInValue]), [
    ['2609AVIP1', 'VIP1', 70000, null], ['2609A04', '04', 3000, 750], ['2609A10', '10', 400, null],
  ]);
});

test('a campaign page with no readable links falls back to the known tier list', () => {
  const tiers = parseCampaignPage('2609C', [], []);
  assert.equal(tiers.length, 14);
  assert.equal(tiers[0]!.offerCode, '2609CVIP1');
  assert.equal(tiers.find((t) => t.tier === '04')!.points, 3000);
});

const header = { y: 750, cells: [
  { x: 40, str: 'Offer Code' }, { x: 110, str: 'Ship' }, { x: 220, str: 'Departure Port' }, { x: 330, str: 'Sail Date' },
  { x: 420, str: 'Itinerary' }, { x: 560, str: 'Stateroom Type' }, { x: 650, str: 'Offer Type' },
  { x: 750, str: 'Next Cruise Bonus' }, { x: 840, str: 'Next Cruise OBC' },
] };
const row = (y: number, cells: [number, string][]) => ({ y, cells: cells.map(([x, str]) => ({ x, str })) });

test('tier rows are read by column position, so a split itinerary stays one cell', () => {
  const page: PageLines = [
    header,
    row(730, [[40, '2609A04'], [110, 'Spectrum Of The Seas®'], [220, 'Shanghai (Baoshan), China'], [330, 'September 1, 2026'],
      [420, '5 Night Fukuoka &'], [470, 'Nagasaki Cruise'], [560, 'Balcony - GTY'], [650, 'Cruise Fare For 2 Guests'],
      [750, '$250 FreePlay'], [840, '$50']]),
    row(710, [[40, '2609A04'], [110, 'Utopia Of The Seas®'], [220, 'Port Canaveral, Florida'], [330, 'September 11, 2026'],
      [420, '3 Night Bahamas & Perfect Day Cruise'], [560, 'Oceanview - GTY'], [650, 'Cruise Fare For 1 Guest'],
      [750, '$250 FreePlay'], [840, '$25']]),
    row(690, [[40, 'JUST PAY TAXES AND FEES, ENJOY A COMPLIMENTARY CRUISE FOR TWO']]),
    row(670, [[40, 'Contact your Club Royale reservation center:']]),
  ];
  const { sailings, description } = parseTierPages([page]);
  assert.equal(sailings.length, 2);
  const [a, b] = sailings;
  assert.equal(a!.shipName, 'Spectrum Of The Seas');
  assert.equal(a!.itinerary, '5 Night Fukuoka & Nagasaki Cruise');
  assert.equal(a!.nights, 5);
  assert.equal(a!.sailDate, '2026-09-01');
  assert.equal(a!.roomType, 'BALCONY');
  assert.equal(a!.isGuarantee, true);
  assert.equal(a!.secondGuestPays, false);
  assert.equal(a!.freePlay, 250);
  assert.equal(a!.onboardCredit, 50);
  assert.equal(b!.roomType, 'OCEANVIEW');
  assert.equal(b!.secondGuestPays, true);
  assert.equal(b!.onboardCredit, 25);
  assert.match(description ?? '', /JUST PAY TAXES/);
});

test('the header repeats on every page and duplicate rows across pages collapse', () => {
  const p = (y: number): PageLines => [header,
    row(y, [[40, '2609A04'], [110, 'Wonder Of The Seas®'], [220, 'Miami, Florida'], [330, 'October 5, 2026'],
      [420, '4 Night Bahamas Cruise'], [560, 'Balcony'], [650, 'Cruise Fare For 2 Guests'], [750, '$250 FreePlay'], [840, '$50']])];
  const { sailings } = parseTierPages([p(730), p(730)]);
  assert.equal(sailings.length, 1);
  assert.equal(sailings[0]!.isGuarantee, false);
});

test('cells centred under their headers still land in the right column (real 2609C10 geometry)', () => {
  // Transcribed from the live tier-10 PDF: every cell is centred, so the ship
  // name starts left of the "Ship" header, and this tier has no FreePlay
  // column — Royal merges its label into the stateroom header.
  const page: PageLines = [
    row(1554, [[234, 'Offer Code'], [482, 'Ship'], [681, 'Departure Port'], [931, 'Sail Date'], [1234, 'Itinerary'],
      [1483, 'Next Cruise Bonus Stateroom Type'], [1896, 'Offer Type'], [2135, 'Next Cruise OBC']]),
    row(1528, [[243, ''], [243, '2609C10'], [408, 'Freedom Of The Seas®'], [684, 'Miami, Florida'], [890, 'September 5, 2026'],
      [1114, '5 Night Bahamas & Perfect Day Cruise'], [1574, 'Interior - GTY'], [1845, 'Cruise Fare For 1 Guest'], [2188, '$25']]),
    row(1484, [[243, '2609C10'], [404, 'Navigator Of The Seas®'], [652, 'Los Angeles, California'], [885, 'September 25, 2026'],
      [1122, '7 Night Ensenada, Cabo & Mazatlan'], [1574, 'Interior - GTY'], [1845, 'Cruise Fare For 1 Guest'], [2188, '$50']]),
  ];
  const { sailings } = parseTierPages([page]);
  assert.equal(sailings.length, 2);
  assert.deepEqual(sailings.map((s) => [s.shipName, s.departurePort, s.sailDate, s.nights, s.roomType, s.freePlay, s.onboardCredit]), [
    ['Freedom Of The Seas', 'Miami, Florida', '2026-09-05', 5, 'INTERIOR', null, 25],
    ['Navigator Of The Seas', 'Los Angeles, California', '2026-09-25', 7, 'INTERIOR', null, 50],
  ]);
  assert.equal(sailings[0]!.secondGuestPays, true);
});

test('a stateroom column labelled "Next Cruise Bonus Offer" is still the stateroom (real 2608D07 geometry)', () => {
  const page: PageLines = [
    row(982, [[122, 'Offer Code'], [322, 'Ship'], [523, 'Departure Port'], [759, 'Sail Date'], [1032, 'Itinerary'],
      [1261, 'Next Cruise Bonus Offer'], [1529, 'Offer Type']]),
    row(955, [[130, '2608D07'], [230, 'Enchantment Of The Seas®'], [525, 'Tampa, Florida'], [735, 'August 8, 2026'],
      [930, '7 Night Western Caribbean Cruise'], [1260, 'Oceanview - GOBO - GTY'], [1478, 'Cruise Fare For 1 Guest']]),
  ];
  const { sailings } = parseTierPages([page]);
  assert.equal(sailings.length, 1);
  assert.equal(sailings[0]!.stateroomType, 'Oceanview - GOBO - GTY');
  assert.equal(sailings[0]!.roomType, 'OCEANVIEW');
  assert.equal(sailings[0]!.offerType, 'Cruise Fare For 1 Guest');
});

test('dates and room types normalise the way the pricing side expects', () => {
  assert.equal(normalizeSailDate('September 1, 2026'), '2026-09-01');
  assert.equal(normalizeSailDate('10/5/2026'), '2026-10-05');
  assert.equal(normalizeSailDate('2026-10-05T00:00:00'), '2026-10-05');
  assert.equal(normalizeSailDate('someday'), null);
  assert.equal(roomTypeOf('Oceanview - GTY'), 'OCEANVIEW');
  assert.equal(roomTypeOf('Junior Suite'), 'SUITE');
  for (const l of ['Owners Loft', 'Sky Loft', 'Aqua Theater', 'Aquatheater', 'Crown Loft']) assert.equal(roomTypeOf(l), 'SUITE', l);
  assert.equal(tierTradeInValue('02A'), 1500);
  assert.equal(tierTradeInValue('VIP1'), null);
});
