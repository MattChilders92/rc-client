/**
 * Everything a consumer might legitimately need to change, in one place.
 *
 * These were module constants. A pinned Chrome version in the user agent goes
 * stale; Royal could rotate its public app key; a serverless caller wants a
 * shorter timeout. Each is now a field on `RcConfig`, resolved once by
 * `RcClient` and threaded through every call, with today's values as defaults
 * so a caller who passes nothing gets exactly the previous behaviour.
 */

/**
 * Royal's **public** web app key — the value their own site sends from public
 * JavaScript on every request, and required for sign-in. It is a client
 * identifier, not a secret: it grants nothing on its own and is visible to
 * anyone who opens the site's network tab. Override it via `RcConfig.appKey`
 * if Royal rotates it before this library does.
 */
export const RC_PUBLIC_APP_KEY = 'hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm';

/** @deprecated Use `RC_PUBLIC_APP_KEY`. Kept so existing imports keep working. */
export const RC_APPKEY = RC_PUBLIC_APP_KEY;

/** A current desktop Chrome user agent; Royal's edge rejects obviously non-browser ones. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/** Everything a call can override; resolved once by `RcClient` and threaded through every request. */
export interface RcConfig {
  /** Sent as `appkey` on guest, commerce and sign-in requests. */
  appKey: string;
  /** Sent on every request. */
  userAgent: string;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Retries for network failures and 429/5xx, on top of the first attempt. */
  retries: number;
}

/** Today's values for every `RcConfig` field — what a caller who passes nothing gets. */
export const DEFAULT_CONFIG: Readonly<RcConfig> = Object.freeze({
  appKey: RC_PUBLIC_APP_KEY,
  userAgent: USER_AGENT,
  timeoutMs: 45_000,
  retries: 2,
});

/** Fill in whatever the caller did not supply. */
export function resolveConfig(partial: Partial<RcConfig> = {}): RcConfig {
  // Field by field, not a spread: `{ appKey: process.env.RC_APP_KEY }` with the
  // variable unset is an explicit `undefined`, which a spread would copy over
  // the default and send to Royal as the header value "undefined".
  return {
    appKey: partial.appKey ?? DEFAULT_CONFIG.appKey,
    userAgent: partial.userAgent ?? DEFAULT_CONFIG.userAgent,
    timeoutMs: partial.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    retries: partial.retries ?? DEFAULT_CONFIG.retries,
  };
}
