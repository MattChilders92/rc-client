/**
 * rc-client — a documented client for Royal Caribbean's web APIs.
 *
 * Start with `RcClient`; the domain functions are exported for callers that
 * already manage their own session.
 *
 * @see docs/endpoints.md for every endpoint, its auth style, and its quirks.
 */

export { RcClient } from './client.ts';

export { signIn, isExpired, type Credentials, type RcSession } from './auth/index.ts';

export {
  RcError, RcAuthError, RcRequestError, RcRouteGoneError, RcUnavailableError, RcShapeError,
} from './errors.ts';

export { RC_APPKEY, USER_AGENT, request, type RcResponse, type RequestOptions } from './http.ts';

export { anonymousHeaders, casinoHeaders, commerceHeaders, guestHeaders } from './headers.ts';

export { fetchAccount, type RcAccount } from './domains/account.ts';
export { fetchCasinoLoyalty, type CasinoLoyalty } from './domains/casino.ts';
export {
  listOffers, fetchOfferDetail, freePlayFrom, mapOffer, SORT_FIELDS,
  type RcOffer, type RcOfferDetail, type RcOfferSailing, type RcPerk, type OffersResult,
  type ListOffersParams, type OfferDetailParams, type OfferSortField,
} from './domains/offers.ts';
export {
  fetchRooms, sweepOccupancy, roomKey, COVERAGE_OCCUPANCIES,
  type RcRoom, type RoomQuery, type Brand,
} from './domains/rooms.ts';
export {
  fetchProducts, fetchCategory, PRODUCT_CATEGORIES,
  type RcProduct, type ProductQuery, type ProductCategory, type ProductsResult,
} from './domains/products.ts';
export { listBookings, type RcBooking, type ListBookingsOptions } from './domains/bookings.ts';
export {
  INSTANT_PDF_BASE, INSTANT_SUFFIXES, DEFAULT_TIERS, campaignCode, campaignPdfUrl, tierPdfUrl,
  splitOfferCode, candidateCampaigns, discoverInstantCampaigns, downloadPdf,
  parseCampaignPage, parseTierPages, normalizeSailDate, tierTradeInValue,
  type InstantSuffix, type CandidateCampaign, type InstantTier, type InstantSailing, type TierParse,
  type TextCell, type TextLine, type PageLines,
} from './domains/certificates.ts';
export {
  searchCruises, type RcCruise, type RcSailingSummary, type SearchParams, type SearchResult,
} from './domains/search.ts';
