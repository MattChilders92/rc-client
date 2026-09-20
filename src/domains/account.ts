import type { RcSession } from '../auth/index.ts';
import { guestHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { RcShapeError } from '../errors.ts';
import { num, str } from '../coerce.ts';
import { resolveConfig, type RcConfig } from '../config.ts';

/**
 * The guest account: contact details plus every loyalty programme in one call.
 *
 * Everything of interest is under `payload`, and the loyalty fields are flat
 * with long names (`clubRoyaleLoyaltyTier`) rather than nested per programme.
 */

const URL_ = 'https://aws-prd.api.rccl.com/en/royal/web/v3/guestAccounts';

/** The guest account, flattened from `payload` — contact details plus every loyalty programme. */
export interface RcAccount {
  accountId: string;
  /** Required in the casino offers request body. */
  consumerId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;

  /** Crown & Anchor number. The casino API keys offers off this. */
  crownAndAnchorId: string | null;
  crownAndAnchorTier: string | null;
  crownAndAnchorPoints: number;
  crownAndAnchorRelationshipPoints: number;

  clubRoyaleTier: string | null;
  clubRoyalePoints: number;
  clubRoyaleRelationshipPoints: number;

  captainsClubId: string | null;
  captainsClubTier: string | null;

  /** The untouched payload, so a field added later needs no library change. */
  raw: unknown;
}

// Royal writes an absent tier as the literal string "NONE" rather than
// omitting the field, so that value is mapped to null before the shared
// `str` applies (which also trims and rejects non-string/non-number input).
const nn = (v: unknown): string | null => (v === 'NONE' ? null : str(v));

/** The signed-in guest's account: contact details plus every loyalty programme, in one call. */
export async function fetchAccount(session: RcSession, config: Partial<RcConfig> = {}): Promise<RcAccount> {
  const cfg = resolveConfig(config);
  const url = `${URL_}/${session.accountId}`;
  const res = await request<any>(url, { headers: guestHeaders(session, cfg), config: cfg });

  const p = res.data?.payload ?? res.data;
  if (!p || typeof p !== 'object') {
    throw new RcShapeError('Account response had no payload', {
      status: res.status, url, body: res.data,
    });
  }

  const loyalty = p.loyaltyInformation ?? {};
  const contact = p.contactInformation ?? {};
  const person = p.personalInformation ?? {};

  return {
    accountId: session.accountId,
    consumerId: nn(p.consumerId),
    email: nn(contact.email ?? p.email),
    firstName: nn(person.firstName),
    lastName: nn(person.lastName),

    crownAndAnchorId: nn(loyalty.crownAndAnchorId),
    crownAndAnchorTier: nn(loyalty.crownAndAnchorSocietyLoyaltyTier),
    crownAndAnchorPoints: num(loyalty.crownAndAnchorSocietyLoyaltyIndividualPoints) ?? 0,
    crownAndAnchorRelationshipPoints:
      num(loyalty.crownAndAnchorSocietyLoyaltyRelationshipPoints) ?? 0,

    clubRoyaleTier: nn(loyalty.clubRoyaleLoyaltyTier),
    clubRoyalePoints: num(loyalty.clubRoyaleLoyaltyIndividualPoints) ?? 0,
    clubRoyaleRelationshipPoints: num(loyalty.clubRoyaleLoyaltyRelationshipPoints) ?? 0,

    captainsClubId: nn(loyalty.captainsClubId),
    captainsClubTier: nn(loyalty.captainsClubLoyaltyTier),

    raw: p,
  };
}
