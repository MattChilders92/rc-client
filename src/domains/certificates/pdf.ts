import { USER_AGENT } from '../../http.ts';

/**
 * Instant Reward PDF download.
 *
 * Fetches the raw bytes of a campaign or tier PDF. Parsing is the caller's;
 * this library carries no PDF dependency.
 */

export async function downloadPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
