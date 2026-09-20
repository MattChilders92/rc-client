/**
 * Instant Reward certificates: the public PDFs Royal publishes per campaign.
 *
 * Three steps, three modules: discover which campaign PDFs exist, download one,
 * parse its pages. Parsing takes positioned text the caller extracted — this
 * library carries no PDF dependency.
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
