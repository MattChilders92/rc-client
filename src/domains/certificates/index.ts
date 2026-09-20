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
 * Three steps, three modules:
 *
 *   discover.ts  generate the candidate codes for the months around now and
 *                HEAD each URL — discovery is by asking
 *   pdf.ts       fetch the bytes
 *   parse.ts     read the campaign and tier pages
 *
 * Parsing works on text positions the caller extracted (this library carries no
 * PDF dependency), because every cell of the tier table is its own text item
 * and column membership is a matter of where it sits under the header. An
 * earlier parser split rows on tab characters, which depended on the
 * extractor's join behaviour. Positions do not.
 */
export {
  INSTANT_PDF_BASE, INSTANT_SUFFIXES, DEFAULT_TIERS, campaignCode, campaignPdfUrl, tierPdfUrl,
  splitOfferCode, candidateCampaigns, discoverInstantCampaigns, tierTradeInValue,
  type InstantSuffix, type CandidateCampaign,
} from './discover.ts';
export { downloadPdf } from './pdf.ts';
export {
  parseCampaignPage, parseTierPages, normalizeSailDate, instantSailingKey, roomTypeOf,
  type InstantTier, type InstantSailing, type TierParse, type TextCell, type TextLine, type PageLines,
} from './parse.ts';
