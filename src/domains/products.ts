import type { RcSession } from '../auth/index.ts';
import { commerceHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { num } from '../coerce.ts';
import { DEFAULT_CONFIG, type RcConfig } from '../config.ts';

/**
 * Onboard products: shore excursions, drink packages, dining and internet.
 *
 * Requires a signed-in account — an anonymous request returns
 * `401 COMMONS-0001 "The API key header is required"` even with the appkey, so
 * there is no unauthenticated path to this data.
 */

const BASE = 'https://aws-prd.api.rccl.com/en/royal/web/commerce-api/catalog/v2';

/** Every category this endpoint serves; `fetchProducts` queries all of them unless told otherwise. */
export const PRODUCT_CATEGORIES = ['beverage', 'shorex', 'internet', 'dining'] as const;
/** A catalogue Royal sells onboard products under; each is fetched separately. */
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** One onboard product: an excursion, drink package, dining reservation or internet plan. */
export interface RcProduct {
  code: string;
  category: ProductCategory;
  title: string | null;
  description: string | null;
  /** What a guest pays today. */
  price: number | null;
  /** List price it is discounted from. Frequently much higher. */
  msrp: number | null;
  currency: string;
  raw: unknown;
}

/** What sailing (and which categories) to fetch the catalogue for. */
export interface ProductQuery {
  shipCode: string;
  /** Sailing date, `YYYY-MM-DD`. Converted to Royal's compact form internally. */
  startDate: string;
  endDate: string;
  categories?: readonly ProductCategory[];
  currency?: string;
  /** Catalogue region; `ALCAN` is what the US site sends. */
  regionCode?: string;
}

const PAGE_SIZE = 25;

// Rounds to cents — unlike the shared `money` — because Royal's price fields
// carry float noise past two decimal places.
const money = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? Math.round(n * 100) / 100 : null;
};

function pageUrl(q: ProductQuery, category: ProductCategory, page: number): string {
  const u = new URL(`${BASE}/${q.shipCode}/categories/${category}/products`);
  // This API wants compact dates; every other Royal endpoint wants ISO.
  u.searchParams.set('startDate', q.startDate.replace(/-/g, ''));
  u.searchParams.set('endDate', q.endDate.replace(/-/g, ''));
  u.searchParams.set('currentPage', String(page));
  u.searchParams.set('pageSize', String(PAGE_SIZE));
  u.searchParams.set('currencyIso', q.currency ?? 'USD');
  u.searchParams.set('regionCode', q.regionCode ?? 'ALCAN');
  return u.toString();
}

function mapProduct(p: any, category: ProductCategory): RcProduct {
  return {
    code: String(p?.id ?? p?.code ?? p?.productCode ?? ''),
    category,
    title: p?.title ?? p?.name ?? null,
    description: p?.promoDescription ?? p?.shortDescription ?? p?.description ?? null,
    // `lowestAdultPrice` is the real price; there is no `price.value` field,
    // and reading `msrpAdultPrice` as the price overstates everything.
    price: money(p?.lowestAdultPrice) ?? money(p?.msrpAdultPrice),
    msrp: money(p?.msrpAdultPrice),
    currency: p?.currency ?? 'USD',
    raw: p,
  };
}

/** Every product in one category, following pagination. */
export async function fetchCategory(
  session: RcSession,
  query: ProductQuery,
  category: ProductCategory,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<RcProduct[]> {
  const headers = commerceHeaders(session, config);
  const body = { textSearch: null, sortKey: 'rRank-asc', filterFacets: null };

  const page = async (n: number) => {
    const res = await request<any>(pageUrl(query, category, n), {
      method: 'POST', headers, body, config,
    });
    const products: any[] = res.data?.products ?? res.data?.payload?.products ?? [];
    const total = Number(
      res.data?.pagination?.totalResults ?? res.data?.totalResults ?? products.length,
    ) || products.length;
    return { products, total };
  };

  const first = await page(0);
  const all = [...first.products];
  const pages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));

  for (let n = 1; n < pages; n++) {
    all.push(...(await page(n)).products);
  }

  return all.map((p) => mapProduct(p, category)).filter((p) => p.code);
}

/** What `fetchProducts` returns: everything that loaded, plus which categories didn't. */
export interface ProductsResult {
  products: RcProduct[];
  /** Categories that failed, so a partial result is never mistaken for a full one. */
  failed: { category: ProductCategory; reason: string }[];
}

/** All categories for a sailing, isolating per-category failures. */
export async function fetchProducts(
  session: RcSession,
  query: ProductQuery,
  config: RcConfig = DEFAULT_CONFIG,
): Promise<ProductsResult> {
  const categories = query.categories ?? PRODUCT_CATEGORIES;
  const products: RcProduct[] = [];
  const failed: ProductsResult['failed'] = [];

  for (const category of categories) {
    try {
      products.push(...(await fetchCategory(session, query, category, config)));
    } catch (err) {
      // One category failing must not cost the others.
      failed.push({ category, reason: (err as Error).message });
    }
  }

  return { products, failed };
}
