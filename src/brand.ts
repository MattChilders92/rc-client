/**
 * The two brands this library speaks to, spelled as their own APIs spell them.
 *
 * `R` and `C` are what the wire carries — the cruise-search `brand` header, the
 * bookings query parameter — so they are what the library uses, rather than a
 * third spelling that would need translating at every call site.
 *
 * Brand is a *host* decision, not a path one: each brand's anonymous and casino
 * APIs live on its own consumer site, while sign-in, the guest account and the
 * product catalogue are shared and are reached through Royal's host for both.
 */

/** `R` Royal Caribbean, `C` Celebrity Cruises. */
export type Brand = 'R' | 'C';

/** Every brand, for callers that need to iterate them. */
export const BRANDS: readonly Brand[] = ['R', 'C'];

/** Display names, for a caller building a label. */
export const BRAND_NAMES: Record<Brand, string> = {
  R: 'Royal Caribbean',
  C: 'Celebrity Cruises',
};

const HOSTS: Record<Brand, string> = {
  R: 'www.royalcaribbean.com',
  C: 'www.celebritycruises.com',
};

/**
 * The consumer site a brand's anonymous and casino APIs are served from, bare —
 * no scheme, no trailing slash — because callers compose it into paths.
 *
 * Throws rather than defaulting, so a bad brand surfaces here instead of as a
 * 404 from whichever site the default happened to be.
 */
export function brandHost(brand: Brand): string {
  const host = HOSTS[brand];
  if (!host) throw new TypeError(`Unknown brand: ${String(brand)}`);
  return host;
}
