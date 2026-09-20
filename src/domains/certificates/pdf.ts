import { USER_AGENT } from '../../http.ts';
import { RcError, RcUnavailableError } from '../../errors.ts';

/**
 * Instant Reward PDF download.
 *
 * Fetches the raw bytes of a campaign or tier PDF. Parsing is the caller's;
 * this library carries no PDF dependency.
 */

export async function downloadPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } });
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
  return new Uint8Array(await r.arrayBuffer());
}
