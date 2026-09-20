import {
  RcAuthError, RcError, RcRequestError, RcRouteGoneError, RcUnavailableError,
} from './errors.ts';
import { DEFAULT_CONFIG, type RcConfig } from './config.ts';

/**
 * The single place a request leaves this library.
 *
 * Uses only `fetch` and standard web APIs, so the same source runs unchanged on
 * Node, Deno (Supabase Edge Functions), Bun and workers — which is what lets one
 * client replace the near-duplicate Node and Deno copies that exist today.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** Serialised as JSON unless it is already a string. */
  body?: unknown;
  timeoutMs?: number;
  /** Statuses to return rather than throw, so callers can interpret them. */
  allowStatus?: number[];
  retries?: number;
  signal?: AbortSignal;
  /** Defaults for timeout, retries and user agent. Explicit `timeoutMs`/`retries` win. */
  config?: RcConfig;
}

/** What `request()` returns for a status it did not throw on. */
export interface RcResponse<T> {
  /** The HTTP status, which may be one the caller allowed via `allowStatus`. */
  status: number;
  /** The body, JSON-parsed when it parsed, else the raw text. */
  data: T;
  /** Response headers, for `retry-after` and the like. */
  headers: Headers;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/**
 * Perform one request, translating Royal's ambiguous statuses into typed errors.
 *
 * 404 deliberately throws `RcRouteGoneError` by default. Endpoints where a 404
 * legitimately means "this account has no such data" must opt in via
 * `allowStatus`, which forces that decision to be made explicitly at the call
 * site instead of being assumed.
 */
export async function request<T = unknown>(
  url: string,
  opts: RequestOptions = {},
): Promise<RcResponse<T>> {
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const {
    method = 'GET', headers = {}, body,
    timeoutMs = cfg.timeoutMs, allowStatus = [], retries = cfg.retries, signal,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'user-agent': cfg.userAgent, ...headers },
        body: body === undefined ? undefined
          : typeof body === 'string' ? body : JSON.stringify(body),
        redirect: 'follow',
        signal: composed,
      });
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new RcError(`Network failure: ${(err as Error).message}`, { url });
    }

    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try { data = JSON.parse(text); } catch { /* keep the raw text */ }
    }

    if (res.ok || allowStatus.includes(res.status)) {
      return { status: res.status, data: data as T, headers: res.headers };
    }

    if (RETRYABLE.has(res.status) && attempt < retries) {
      const wait = retryAfterMs(res.headers) ?? 500 * 2 ** attempt;
      await sleep(wait);
      continue;
    }

    throw toTypedError(res, url, data, text);
  }

  throw new RcError(`Request failed: ${String(lastError)}`, { url });
}

function toTypedError(res: Response, url: string, data: unknown, text: string): RcError {
  const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
  const common = { status: res.status, url, body: data };

  switch (res.status) {
    case 400:
    case 401:
      return new RcAuthError(`Authentication rejected (${res.status}): ${snippet}`, {
        ...common, permanent: true,
      });
    case 403:
      return new RcAuthError(`Forbidden (403): ${snippet}`, common);
    case 422:
      // Royal answers 422 for a well-formed request carrying the wrong auth
      // header — the casino API even names the header it wanted.
      return new RcRequestError(
        `Request rejected as unprocessable (422) — usually the wrong auth header for this API: ${snippet}`,
        common,
      );
    case 404:
      return new RcRouteGoneError(
        `Not found (404). If this endpoint can legitimately have no data, pass allowStatus: [404]: ${snippet}`,
        common,
      );
    case 429:
    case 503:
      return new RcUnavailableError(`Temporarily unavailable (${res.status})`, {
        ...common, retryAfterMs: retryAfterMs(res.headers),
      });
    default:
      return new RcError(`HTTP ${res.status}: ${snippet}`, common);
  }
}
