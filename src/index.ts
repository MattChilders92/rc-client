/**
 * rc-client — a documented client for Royal Caribbean's web APIs.
 *
 * Start with `RcClient`. Everything below it is also exported, for callers who
 * manage their own session or want one piece without the rest.
 *
 * @see docs/endpoints.md for every endpoint, its auth style, and its quirks.
 */

/* ── The client ──────────────────────────────────────────────────────────── */
export { RcClient } from './client.ts';
export { signIn, isExpired, type Credentials, type RcSession } from './auth/index.ts';
export { DEFAULT_CONFIG, resolveConfig, type RcConfig } from './config.ts';

/* ── Errors ──────────────────────────────────────────────────────────────── */
export {
  RcError, RcAuthError, RcRequestError, RcRouteGoneError, RcUnavailableError, RcShapeError,
} from './errors.ts';

/* ── Brand ───────────────────────────────────────────────────────────────── */
export { brandHost, BRANDS, BRAND_NAMES, type Brand } from './brand.ts';

/* ── Domain functions and types ──────────────────────────────────────────── */
export { fetchAccount, type RcAccount } from './domains/account.ts';
export { fetchCasinoLoyalty, type CasinoLoyalty } from './domains/casino.ts';
export {
  listOffers, fetchOfferDetail, freePlayFrom, mapOffer, SORT_FIELDS,
  type RcOffer, type RcOfferDetail, type RcOfferSailing, type RcPerk, type OffersResult,
  type ListOffersParams, type OfferDetailParams, type OfferSortField,
} from './domains/offers.ts';
export {
  fetchRooms, sweepOccupancy, roomKey, COVERAGE_OCCUPANCIES,
  type RcRoom, type RoomQuery,
} from './domains/rooms.ts';
export {
  fetchProducts, fetchCategory, PRODUCT_CATEGORIES,
  type RcProduct, type ProductQuery, type ProductCategory, type ProductsResult,
} from './domains/products.ts';
export { listBookings, type RcBooking, type ListBookingsOptions } from './domains/bookings.ts';
export {
  searchCruises, fetchItineraryPorts, parseItineraryPorts,
  type RcCruise, type RcSailingSummary, type SearchParams, type SearchResult,
  type RcItineraryPorts, type RcItineraryDay,
} from './domains/search.ts';

/* ── Instant Reward certificates: public PDFs, no session ────────────────── */
export {
  INSTANT_PDF_BASE, INSTANT_SUFFIXES, DEFAULT_TIERS, campaignCode, campaignPdfUrl, tierPdfUrl,
  splitOfferCode, candidateCampaigns, discoverInstantCampaigns, downloadPdf,
  parseCampaignPage, parseTierPages, normalizeSailDate, tierTradeInValue, instantSailingKey,
  roomTypeOf,
  type InstantSuffix, type CandidateCampaign, type InstantTier, type InstantSailing, type TierParse,
  type TextCell, type TextLine, type PageLines,
} from './domains/certificates/index.ts';

/* ── Transport, for callers who manage their own session ─────────────────── */
export { request, type RcResponse, type RequestOptions } from './http.ts';
export { anonymousHeaders, casinoHeaders, commerceHeaders, guestHeaders } from './headers.ts';
export { RC_PUBLIC_APP_KEY, RC_APPKEY, USER_AGENT } from './config.ts';
