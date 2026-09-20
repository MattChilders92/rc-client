/**
 * Keys whose values never reach a committed fixture.
 *
 * Shared by the capture script, which replaces them on the way in, and the
 * fixture gate test, which fails if one ever slips through — the two cannot
 * disagree about what counts as identifying.
 */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  'firstname', 'lastname', 'middlename', 'email', 'emailaddress',
  'phone', 'phonenumber', 'mobilenumber',
  'address', 'addressline', 'addressline1', 'addressline2', 'addressone', 'addresstwo',
  'postalcode', 'zipcode', 'birthdate', 'dateofbirth',
  'accountid', 'consumerid', 'vdsid', 'vdsids',
  'crownandanchorid', 'casinoloyaltyid', 'cruiseloyaltyid', 'loyaltyid',
  'captainsclubid', 'venetiansocietyid', 'clubroyaleid',
  'reservationid', 'bookingid', 'passengerid',
  'access_token', 'id_token', 'accesstoken', 'tokenid', 'playerofferid',
  // `city`/`state` only ever appear in this codebase's fixtures inside a
  // guest's own contact/address object (account.json, casino-loyalty.json).
  // Every departure port this library maps (RcOfferSailing.departurePort,
  // RcItineraryPorts.departurePort) is `{ code, name }` — no city/state
  // fields exist on a port anywhere in the mapped shapes or the raw
  // fixtures — so there is no port to false-positive on and these are safe
  // to redact unscoped. If a future fixture ever adds a port city/state,
  // re-check this comment before assuming it's personal.
  'city', 'state',
  // Not identifying alone, but personal, and nothing reads it.
  'gender',
]);
