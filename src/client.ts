import { isExpired, signIn, type Credentials, type RcSession } from './auth/index.ts';
import { fetchAccount, loyaltyIdFor, type RcAccount } from './domains/account.ts';
import { fetchCasinoLoyalty, type CasinoLoyalty } from './domains/casino.ts';
import { fetchOfferDetail, listOffers, type OffersResult, type RcOfferDetail } from './domains/offers.ts';
import {
  COVERAGE_OCCUPANCIES, fetchRooms, sweepOccupancy,
  type RcRoom, type RoomQuery,
} from './domains/rooms.ts';
import type { Brand } from './brand.ts';
import {
  fetchProducts, type ProductQuery, type ProductsResult,
} from './domains/products.ts';
import { listBookings, type ListBookingsOptions, type RcBooking } from './domains/bookings.ts';
import {
  fetchItineraryPorts, searchCruises,
  type RcItineraryPorts, type SearchParams, type SearchResult,
} from './domains/search.ts';
import { RcAuthError } from './errors.ts';
import { resolveConfig, type RcConfig } from './config.ts';

/**
 * One entry point for Royal Caribbean's APIs.
 *
 * Holds credentials, signs in on demand, and reuses the token until it expires.
 * Callers never handle tokens or headers — which matters, because each API wants
 * the token presented differently and getting it wrong fails obscurely.
 *
 * ```ts
 * const rc = new RcClient({ username, password }, { timeoutMs: 15_000 });
 * const account = await rc.account();
 * const { offers } = await rc.offers();          // loyalty id resolved for you
 * const rooms = await rc.allRooms({ packageCode, sailDate });
 * ```
 *
 * Search needs no account, so it is also exported standalone.
 */
export class RcClient {
  #credentials: Credentials | null;
  #session: RcSession | null = null;
  #account: RcAccount | null = null;
  /** Concurrent callers share one sign-in rather than racing several. */
  #pending: Promise<RcSession> | null = null;
  readonly #config: RcConfig;
  /** Which brand's casino host `offers`/`offerDetail` call, and which loyalty programme they resolve. Defaults to `'R'`. */
  readonly #brand: Brand;

  constructor(
    init: Credentials | { session: RcSession },
    options: Partial<RcConfig> & { brand?: Brand } = {},
  ) {
    const { brand = 'R', ...config } = options;
    this.#config = resolveConfig(config);
    this.#brand = brand;
    if ('session' in init) {
      this.#credentials = null;
      this.#session = init.session;
    } else {
      this.#credentials = init;
    }
  }

  /** A valid session, signing in or refreshing only when needed. */
  async session(): Promise<RcSession> {
    if (this.#session && !isExpired(this.#session)) return this.#session;
    if (this.#pending) return this.#pending;

    if (!this.#credentials) {
      throw new RcAuthError('Session expired and no credentials were supplied', {
        url: 'rc-client', permanent: true,
      });
    }

    this.#pending = signIn(this.#credentials, this.#config)
      .then((s) => {
        this.#session = s;
        // Identity may have changed; force the cached account to reload.
        this.#account = null;
        return s;
      })
      .finally(() => { this.#pending = null; });

    return this.#pending;
  }

  /** Verify the credentials without needing anything else. Never throws on bad passwords. */
  async verify(): Promise<{ ok: boolean; accountId?: string; reason?: string }> {
    try {
      const s = await this.session();
      return { ok: true, accountId: s.accountId };
    } catch (err) {
      if (err instanceof RcAuthError) return { ok: false, reason: err.message };
      throw err;
    }
  }

  /** The guest account. Cached for the life of the session. */
  async account(force = false): Promise<RcAccount> {
    if (this.#account && !force) return this.#account;
    this.#account = await fetchAccount(await this.session(), this.#config);
    return this.#account;
  }

  /**
   * Casino loyalty tier and points for this client's brand — Club Royale for
   * Royal Caribbean, Blue Chip for Celebrity — or `null` when the account has
   * no casino profile with that brand.
   */
  async casinoLoyalty(): Promise<CasinoLoyalty | null> {
    return fetchCasinoLoyalty(await this.session(), { ...this.#config, brand: this.#brand });
  }

  /**
   * Casino offers, for this client's brand. The loyalty number — Crown &
   * Anchor for Royal, Captain's Club for Celebrity — is resolved from the
   * account automatically via `loyaltyIdFor`; passing the account id or
   * casino profile id instead returns nothing. When the account has no
   * number for this brand, returns the empty/`'none'` shape without making a
   * request — there is nothing a wrong-brand call could return but a
   * confusing 401.
   *
   * Throws `RcRouteGoneError` if the endpoint has moved again, rather than
   * reporting an empty list. There is no `offerSailings` companion: this API
   * version exposes no route for an offer's eligible sailings.
   */
  async offers(loyaltyId?: string): Promise<OffersResult> {
    const id = loyaltyId ?? loyaltyIdFor(await this.account(), this.#brand);
    const player = { firstName: null, lastName: null, loyaltyId: null };
    if (!id) return { offers: [], outcome: 'none', totalOffers: 0, player };
    return listOffers(await this.session(), { loyaltyId: id, brand: this.#brand }, this.#config);
  }

  /**
   * One grant with its eligible sailings — ship, departure port, sail date,
   * itinerary, nights, and the room categories the offer covers on it. This is
   * the detail call the hub makes when an offer is opened. Bearer only.
   * Follows this client's brand the same way `offers` does, and returns
   * `null` without a request when there is no loyalty number for it.
   */
  async offerDetail(offerCode: string, playerOfferId: string, loyaltyId?: string): Promise<RcOfferDetail | null> {
    const id = loyaltyId ?? loyaltyIdFor(await this.account(), this.#brand);
    if (!id) return null;
    return fetchOfferDetail(
      await this.session(), { loyaltyId: id, offerCode, playerOfferId, brand: this.#brand }, this.#config,
    );
  }

  /** Current and past reservations on the account. */
  async bookings(opts?: ListBookingsOptions): Promise<RcBooking[]> {
    return listBookings(await this.session(), opts, this.#config);
  }

  /** Onboard product catalogue and prices for a ship and date window. */
  async products(query: ProductQuery): Promise<ProductsResult> {
    return fetchProducts(await this.session(), query, this.#config);
  }

  /** Cabins at one occupancy. Needs no credentials, but is here for symmetry. */
  async rooms(query: RoomQuery): Promise<RcRoom[]> {
    return fetchRooms(query, this.#config);
  }

  /**
   * Every cabin category on a sailing.
   *
   * Royal only returns cabins that sleep the party you ask for, so this sweeps
   * several occupancies and merges — a single request always omits categories.
   */
  async allRooms(
    query: Omit<RoomQuery, 'adults' | 'children'>,
    occupancies = COVERAGE_OCCUPANCIES,
  ): Promise<RcRoom[]> {
    return [...(await sweepOccupancy(query, occupancies, this.#config)).values()];
  }

  /**
   * Public cruise search. Static because it needs no session — which also means
   * it cannot see an instance's options, so pass `config` here to override the
   * user agent, timeout or retries.
   */
  static search(params?: SearchParams, config?: Partial<RcConfig>): Promise<SearchResult> {
    return searchCruises(params, resolveConfig(config));
  }

  /**
   * The itineraries in Royal's public catalogue with their day-by-day ports.
   * Static, like `search`: the same credential-free GraphQL, and the same
   * optional `config`.
   */
  static itineraryPorts(
    opts?: { count?: number; skip?: number },
    config?: Partial<RcConfig>,
  ): Promise<{ itineraries: RcItineraryPorts[]; total: number }> {
    return fetchItineraryPorts(opts, resolveConfig(config));
  }
}

export type { Brand, Credentials, RcSession };
