import type { RcSession } from './auth/index.ts';
import { RC_APPKEY, USER_AGENT } from './http.ts';

/**
 * Royal presents the same access token three different ways depending on which
 * API you are calling. This is not documented anywhere, is not guessable, and
 * getting it wrong returns 422 or a bare 404 rather than 401 — so it is encoded
 * here once and nowhere else.
 *
 *   guest        `access-token` + appkey            → guestAccounts
 *   commerce     `access-token` + appkey + account-id → catalog, bookings
 *   casino       `authorization: Bearer` + x-account-id → /api/casino/**
 *   anonymous    no auth at all                     → itinerary + search
 *
 * @see docs/endpoints.md
 */

const BASE = {
  accept: 'application/json',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
  referer: 'https://www.royalcaribbean.com/',
};

/** guestAccounts. Sends the token bare, under `access-token`. */
export function guestHeaders(session: RcSession): Record<string, string> {
  return {
    ...BASE,
    accept: '*/*',
    'access-token': session.accessToken,
    appkey: RC_APPKEY,
    'content-type': 'application/json',
  };
}

/** Commerce APIs — product catalog, bookings. Adds the account id. */
export function commerceHeaders(session: RcSession): Record<string, string> {
  return {
    ...BASE,
    'access-token': session.accessToken,
    'account-id': session.accountId,
    appkey: RC_APPKEY,
    'content-type': 'application/json',
    'req-app-id': 'Royal.Web.PlanMyCruise',
    'x-requested-with': 'XMLHttpRequest',
  };
}

/**
 * The casino guest hub. Uses `Bearer`, and `x-account-id` rather than
 * `account-id`. The merged-offers endpoint additionally wants `x-loyalty-id`,
 * which is the Crown & Anchor number — not the account uuid, and not the
 * casino profile id.
 */
export function casinoHeaders(
  session: RcSession,
  opts: { loyaltyId?: string | null } = {},
): Record<string, string> {
  return {
    ...BASE,
    authorization: `Bearer ${session.accessToken}`,
    'content-type': 'application/json',
    'x-account-id': session.accountId,
    ...(opts.loyaltyId ? { 'x-loyalty-id': opts.loyaltyId } : {}),
    adrum: 'isAjax:true',
    origin: 'https://www.royalcaribbean.com',
    'x-requested-with': 'XMLHttpRequest',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    referer: 'https://www.royalcaribbean.com/club-royale/offers?country=USA',
  };
}

/** Itinerary and search APIs, which take no credentials at all. */
export function anonymousHeaders(): Record<string, string> {
  return {
    ...BASE,
    accept: 'application/json, text/plain, */*',
  };
}
