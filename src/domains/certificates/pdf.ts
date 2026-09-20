import { DEFAULT_CONFIG, type RcConfig } from '../../config.ts';
import { RcError, RcUnavailableError } from '../../errors.ts';

/**
 * The raw bytes of a campaign or tier PDF. Parsing is the caller's; this
 * library carries no PDF dependency.
 *
 * Uses a bare `fetch` rather than `request()`, which reads bodies as text. It
 * is given the same timeout, and its failures are the same typed errors.
 */
export async function downloadPdf(url: string, config: RcConfig = DEFAULT_CONFIG): Promise<Uint8Array> {
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': config.userAgent, accept: 'application/pdf,*/*' },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    throw new RcError(`Network failure fetching PDF: ${(err as Error).message}`, { url });
  }
  if (!r.ok) {
    if (r.status === 429 || r.status === 503) {
      // Numeric Retry-After only; this CDN hasn't been observed sending the
      // HTTP-date form that http.ts's private retryAfterMs() also handles.
      const raw = r.headers.get('retry-after');
      const secs = raw === null ? NaN : Number(raw);
      throw new RcUnavailableError(`PDF temporarily unavailable (${r.status})`, {
        status: r.status, url, retryAfterMs: Number.isFinite(secs) ? secs * 1000 : null,
      });
    }
    throw new RcError(`HTTP ${r.status} fetching PDF`, { status: r.status, url });
  }
  try {
    return new Uint8Array(await r.arrayBuffer());
  } catch (err) {
    // A connection reset mid-body reaches here even though the connect (and
    // the status check above) already succeeded — it must not escape as a
    // bare TypeError just because it happened after `r.ok`.
    throw new RcError(`Network failure reading PDF: ${(err as Error).message}`, { url });
  }
}
