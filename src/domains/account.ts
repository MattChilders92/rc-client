import type { RcSession } from '../auth/index.ts';
import { guestHeaders } from '../headers.ts';
import { request } from '../http.ts';
import { RcShapeError } from '../errors.ts';
import { num, str } from '../coerce.ts';
import { resolveConfig, type RcConfig } from '../config.ts';
import type { Brand } from '../brand.ts';

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

  /** Celebrity's core loyalty programme. The offers API keys casino offers off this. */
  captainsClubId: string | null;
  captainsClubTier: string | null;
  captainsClubNextTier: string | null;
  captainsClubPoints: number;
  captainsClubRelationshipPoints: number;
  /** Null once there is no next tier to progress toward, not a missing field. */
  captainsClubRemainingPoints: number | null;

  /** Celebrity's casino programme. Royal exposes points only — no id, no tier. */
  blueChipPoints: number;
  blueChipRelationshipPoints: number;

  /** Silversea's loyalty programme, surfaced because it rides the same payload. */
  venetianSocietyId: string | null;
  venetianSocietyTier: string | null;
  venetianSocietyNextTier: string | null;
  venetianSocietyPoints: number;
  venetianSocietyRelationshipPoints: number;

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
    captainsClubNextTier: nn(loyalty.captainsClubNextTier),
    captainsClubPoints: num(loyalty.captainsClubLoyaltyIndividualPoints) ?? 0,
    captainsClubRelationshipPoints: num(loyalty.captainsClubLoyaltyRelationshipPoints) ?? 0,
    captainsClubRemainingPoints: num(loyalty.captainsClubRemainingPoints),

    blueChipPoints: num(loyalty.celebrityBlueChipLoyaltyIndividualPoints) ?? 0,
    blueChipRelationshipPoints: num(loyalty.celebrityBlueChipLoyaltyRelationshipPoints) ?? 0,

    venetianSocietyId: nn(loyalty.venetianSocietyId),
    venetianSocietyTier: nn(loyalty.venetianSocietyLoyaltyTier),
    venetianSocietyNextTier: nn(loyalty.venetianSocietyNextTier),
    // Royal drops the `Loyalty` infix from Venetian Society's point keys only
    // — its tier key keeps it (venetianSocietyLoyaltyTier above). Verified
    // against the live fixture; not a typo to "fix".
    venetianSocietyPoints: num(loyalty.venetianSocietyIndividualPoints) ?? 0,
    venetianSocietyRelationshipPoints: num(loyalty.venetianSocietyRelationshipPoints) ?? 0,

    raw: p,
  };
}

/**
 * The loyalty number the offers API keys casino offers off: Crown & Anchor
 * for Royal, Captain's Club for Celebrity. Null when the account has not
 * enrolled in that brand's programme, rather than throwing.
 */
export function loyaltyIdFor(account: RcAccount, brand: Brand): string | null {
  return brand === 'R' ? account.crownAndAnchorId : account.captainsClubId;
}
