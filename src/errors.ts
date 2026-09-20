/**
 * Typed failures.
 *
 * Royal's APIs are unusually bad at saying what went wrong: a malformed auth
 * header returns 422, a moved route returns a bare 404, and an account with no
 * data returns the same 404 as a route that no longer exists. Every one of those
 * has cost real debugging time, so each is a distinct class here rather than a
 * string to be pattern-matched at the call site.
 */

/**
 * Base of every failure this library throws. `status` and `url` are always
 * set; `body` is Royal's own error envelope when there was one.
 */
export class RcError extends Error {
  readonly status: number | null;
  readonly url: string;
  /** Royal's own error envelope, when it sent one. */
  readonly body: unknown;

  constructor(message: string, opts: { status?: number | null; url: string; body?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? null;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/** Credentials rejected, or a token that is no longer accepted. */
export class RcAuthError extends RcError {
  /** True when re-trying with the same credentials cannot succeed. */
  readonly permanent: boolean;

  constructor(
    message: string,
    opts: { status?: number | null; url: string; body?: unknown; permanent?: boolean },
  ) {
    super(message, opts);
    this.permanent = opts.permanent ?? false;
  }
}

/**
 * The request was shaped wrongly — almost always the wrong auth header for the
 * API being called. Royal answers 422 for this, never 401.
 *
 * @see docs/endpoints.md for which header each API expects.
 */
export class RcRequestError extends RcError {}

/**
 * The route itself is gone. Distinguished from "no data" because Royal has
 * moved endpoints twice without notice, and treating the two alike is how an
 * offer sync can silently report zero offers for months.
 */
export class RcRouteGoneError extends RcError {}

/** Royal is rate limiting or briefly unavailable. Retryable. */
export class RcUnavailableError extends RcError {
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    opts: { status?: number | null; url: string; body?: unknown; retryAfterMs?: number | null },
  ) {
    super(message, opts);
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** The response parsed but did not contain what the caller needs. */
export class RcShapeError extends RcError {}
