import { isExpired, signIn, type Credentials, type RcSession } from './auth/index.ts';
import { fetchAccount, type RcAccount } from './domains/account.ts';
import { fetchCasinoLoyalty, type CasinoLoyalty } from './domains/casino.ts';
import {
  fetchOfferSailings, listOffers, type OffersResult, type RcOffer,
} from './domains/offers.ts';
import {
  COVERAGE_OCCUPANCIES, fetchRooms, sweepOccupancy,
  type Brand, type RcRoom, type RoomQuery,
} from './domains/rooms.ts';
import {
  fetchProducts, type ProductQuery, type ProductsResult,
} from './domains/products.ts';
import { listBookings, type ListBookingsOptions, type RcBooking } from './domains/bookings.ts';
import { searchCruises, type SearchParams, type SearchResult } from './domains/search.ts';
import { RcAuthError } from './errors.ts';

/**
 * One entry point for Royal Caribbean's APIs.
 *
 * Holds credentials, signs in on demand, and reuses the token until it expires.
 * Callers never handle tokens or headers — which matters, because each API wants
 * the token presented differently and getting it wrong fails obscurely.
 *
 * ```ts
 * const rc = new RcClient({ username, password });
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

  constructor(init: Credentials | { session: RcSession }) {
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

    this.#pending = signIn(this.#credentials)
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
    this.#account = await fetchAccount(await this.session());
    return this.#account;
  }

  async casinoLoyalty(): Promise<CasinoLoyalty | null> {
    return fetchCasinoLoyalty(await this.session());
  }

  /**
   * Casino offers. The Crown & Anchor number is resolved from the account
   * automatically — it is what the offers API keys on, and passing the account
   * id or casino profile id instead silently returns nothing.
   */
  async offers(loyaltyId?: string): Promise<OffersResult> {
    const id = loyaltyId ?? (await this.account()).crownAndAnchorId;
    if (!id) return { offers: [], outcome: 'none', totalOffers: 0 };
    return listOffers(await this.session(), { loyaltyId: id });
  }

  /** One offer with its eligible sailings. */
  async offerSailings(
    offerCode: string,
    opts: { playerOfferId?: string; loyaltyId?: string } = {},
  ): Promise<RcOffer | null> {
    const id = opts.loyaltyId ?? (await this.account()).crownAndAnchorId;
    if (!id) return null;
    return fetchOfferSailings(await this.session(), {
      loyaltyId: id, offerCode, ...(opts.playerOfferId ? { playerOfferId: opts.playerOfferId } : {}),
    });
  }

  async bookings(opts?: ListBookingsOptions): Promise<RcBooking[]> {
    return listBookings(await this.session(), opts);
  }

  async products(query: ProductQuery): Promise<ProductsResult> {
    return fetchProducts(await this.session(), query);
  }

  /** Cabins at one occupancy. Needs no credentials, but is here for symmetry. */
  async rooms(query: RoomQuery): Promise<RcRoom[]> {
    return fetchRooms(query);
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
    return [...(await sweepOccupancy(query, occupancies)).values()];
  }

  /** Public cruise search. Static because it needs no session. */
  static search(params?: SearchParams): Promise<SearchResult> {
    return searchCruises(params);
  }
}

export type { Brand, Credentials, RcSession };
