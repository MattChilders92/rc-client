/**
 * Keys whose values never reach a committed fixture.
 *
 * Shared by the capture script, which replaces them on the way in, and the
 * fixture gate test, which fails if one ever slips through — the two cannot
 * disagree about what counts as identifying.
 */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  'firstname', 'lastname', 'middlename', 'email', 'emailaddress',
  'phone', 'mobilenumber', 'address', 'addressline1', 'addressline2',
  'postalcode', 'zipcode', 'birthdate', 'dateofbirth',
  'accountid', 'consumerid', 'vdsid', 'vdsids',
  'crownandanchorid', 'casinoloyaltyid', 'cruiseloyaltyid', 'loyaltyid',
  'captainsclubid', 'reservationid', 'bookingid', 'passengerid',
  'access_token', 'id_token', 'accesstoken', 'tokenid', 'playerofferid',
]);
