import {
  RcAuthError, RcError, RcRequestError, RcRouteGoneError, RcUnavailableError,
} from './errors.ts';
import { resolveConfig, type RcConfig } from './config.ts';

/**
 * The single place a request leaves this library.
 *
 * Uses only `fetch` and standard web APIs, so the same source runs unchanged on
 * Node, Deno (Supabase Edge Functions), Bun and workers — which is what lets one
 * client replace the near-duplicate Node and Deno copies that exist today.
 */

/**
 * Options for one `request()`. Everything is optional; the defaults come from
 * `config`, and an explicit `timeoutMs` or `retries` here always wins over it.
 */
export interface RequestOptions {
  /** Defaults to `GET`. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Merged over a default `user-agent`. Build these with the header helpers. */
  headers?: Record<string, string>;
  /** Serialised as JSON unless it is already a string. */
  body?: unknown;
  /** Per attempt, not for the whole call including retries. */
  timeoutMs?: number;
  /**
   * Statuses to return rather than throw, so callers can interpret them. A 404
   * throws `RcRouteGoneError` unless it is listed here — the deliberate opt-in
   * for endpoints where 404 means "this account has none".
   */
  allowStatus?: number[];
  /** Extra attempts after the first, for network failures and 429/5xx. `0` disables. */
  retries?: number;
  /** Aborts the call, in addition to the per-attempt timeout. */
  signal?: AbortSignal;
  /** Defaults for timeout, retries and user agent. Explicit `timeoutMs`/`retries` win. */
  config?: Partial<RcConfig>;
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

/**
 * Statuses worth another attempt. A 5xx is a server hiccup; retrying is
 * ordinary. A 429 is different — see `waitFor` below — and a 403 is never
 * here, so an outright block surfaces at once instead of being hammered.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** A rate-limited retry waits at least this long, even if Royal says sooner. */
const MIN_THROTTLE_WAIT_MS = 10_000;

/**
 * How long to wait before retrying a retryable status.
 *
 * `Retry-After` wins when Royal sends one. Otherwise a 5xx backs off briefly,
 * but a 429 waits a floor of ten seconds with jitter: these APIs are reported
 * to rate-limit by IP and to ban repeat offenders, so answering a "slow down"
 * with two more requests inside a second is how a client earns a block. When
 * the floor is longer than the budget a caller wants to spend, they are better
 * served by the `RcUnavailableError` and can decide for themselves.
 */
function waitFor(status: number, headers: Headers, attempt: number): number {
  const stated = retryAfterMs(headers);
  if (stated !== null) return stated;
  if (status !== 429) return 500 * 2 ** attempt;
  // Jittered, so several clients throttled at once do not return in lockstep.
  return MIN_THROTTLE_WAIT_MS * 2 ** attempt * (1 + Math.random() * 0.25);
}

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
  const cfg = resolveConfig(opts.config);
  const {
    method = 'GET', headers = {}, body,
    timeoutMs = cfg.timeoutMs, allowStatus = [], retries = cfg.retries, signal,
  } = opts;

  let lastError: unknown;

  /**
   * Decide whether a network-level failure (a failed connect, or a body that
   * stopped arriving mid-read) gets another attempt. Both burn the same
   * budget and use the same backoff — a reset mid-body is not meaningfully
   * different from one that never connected. An already-aborted `signal`
   * stops immediately rather than sleeping first: honouring the caller's
   * cancellation matters more than spending the rest of the retry budget on
   * a call that is already dead.
   */
  async function retryOrThrow(attempt: number, err: unknown): Promise<void> {
    if (attempt < retries) {
      if (signal?.aborted) throw new RcError('Request aborted', { url });
      await sleep(300 * 2 ** attempt);
      return;
    }
    throw new RcError(`Network failure: ${(err as Error).message}`, { url });
  }

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
      await retryOrThrow(attempt, err);
      continue;
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      // A connection reset mid-body (e.g. undici's bare `TypeError:
      // terminated`) reaches here — it must not escape untyped just because
      // the connect itself succeeded.
      lastError = err;
      await retryOrThrow(attempt, err);
      continue;
    }

    let data: unknown = text;
    if (text) {
      try { data = JSON.parse(text); } catch { /* keep the raw text */ }
    }

    if (res.ok || allowStatus.includes(res.status)) {
      return { status: res.status, data: data as T, headers: res.headers };
    }

    if (RETRYABLE.has(res.status) && attempt < retries) {
      if (signal?.aborted) throw new RcError('Request aborted', { url });
      await sleep(waitFor(res.status, res.headers, attempt));
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
