import { RcAuthError, RcShapeError } from '../errors.ts';
import { RC_APPKEY, USER_AGENT, request } from '../http.ts';

/**
 * Sign-in, exactly as Royal's own web client does it.
 *
 * This is a two-step OpenAM flow, **not** the OAuth2 password grant that also
 * exists at `/auth/oauth2/access_token`. The password grant does return a usable
 * token for some APIs, but it is a different grant type, and at least the casino
 * merged-offers endpoint does not accept it. Use this flow; there is no reason
 * to prefer the other one.
 *
 *   1. POST /auth/json/authenticate   with x-openam-username / x-openam-password
 *                                     → tokenId (an OpenAM session)
 *   2. POST /v1/oauth2-authorize/...  with { client, tokenId } + appkey
 *                                     → access_token, id_token, expires_in
 *
 * The id_token carries `sub` (the account id every other API wants) and
 * sometimes `vdsid`.
 */

const AUTHENTICATE_URL = 'https://www.royalcaribbean.com/auth/json/authenticate';
const AUTHORIZE_URL =
  'https://aws-prd.api.rccl.com/v1/oauth2-authorize/en/royal/web/v1/authorize';

export interface RcSession {
  accessToken: string;
  /** Account uuid, from the id_token `sub` claim. */
  accountId: string;
  vdsId?: string;
  expiresAt: Date;
}

export interface Credentials {
  username: string;
  password: string;
}

/** Decode a JWT payload without verifying it; only the claims are needed. */
function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new RcShapeError('id_token was not a JWT', { url: AUTHORIZE_URL });
  const normalised = part.replace(/-/g, '+').replace(/_/g, '/');
  // atob + TextDecoder are available on every target runtime; Buffer would tie
  // this library to Node, and atob alone mangles any non-ASCII claim.
  const bytes = Uint8Array.from(atob(normalised), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function signIn(credentials: Credentials): Promise<RcSession> {
  const { username, password } = credentials;

  // Step 1 — OpenAM session. Credentials travel as headers, and the body is
  // genuinely empty; sending one makes this fail.
  const auth = await request<{ tokenId?: string }>(AUTHENTICATE_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-api-version': 'resource=2.0, protocol=1.0',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'content-type': 'application/x-www-form-urlencoded',
      pragma: 'no-cache',
      'x-openam-username': username,
      'x-openam-password': password,
      referer: 'https://www.royalcaribbean.com/account/signin',
    },
    // A rejected password is final; retrying it only risks a lockout.
    retries: 0,
  }).catch((err) => {
    if (err instanceof RcAuthError) throw err;
    throw err;
  });

  const tokenId = auth.data?.tokenId;
  if (!tokenId) {
    throw new RcAuthError('Sign-in succeeded but returned no tokenId', {
      status: auth.status, url: AUTHENTICATE_URL, body: auth.data, permanent: true,
    });
  }

  // Step 2 — exchange the session for an OAuth2 access token.
  const authorized = await request<{
    access_token?: string; id_token?: string; expires_in?: number;
  }>(AUTHORIZE_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      appkey: RC_APPKEY,
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      pragma: 'no-cache',
      referer: 'https://www.royalcaribbean.com/',
      'user-agent': USER_AGENT,
    },
    body: { client: 'login-component', tokenId },
  });

  const { access_token, id_token, expires_in } = authorized.data;
  if (!access_token || !id_token || typeof expires_in !== 'number') {
    throw new RcShapeError('Authorize response was missing a token', {
      status: authorized.status, url: AUTHORIZE_URL, body: authorized.data,
    });
  }

  const claims = decodeJwt(id_token);
  const accountId = typeof claims.sub === 'string' ? claims.sub : '';
  if (!accountId) {
    throw new RcShapeError('id_token carried no subject claim', {
      url: AUTHORIZE_URL, body: claims,
    });
  }

  const vdsId = typeof claims.vdsid === 'string' && claims.vdsid ? claims.vdsid : undefined;

  return {
    accessToken: access_token,
    accountId,
    ...(vdsId ? { vdsId } : {}),
    // A minute of slack, so a token is never spent in its final seconds.
    expiresAt: new Date(Date.now() + (expires_in - 60) * 1000),
  };
}

export const isExpired = (session: RcSession): boolean => session.expiresAt <= new Date();
