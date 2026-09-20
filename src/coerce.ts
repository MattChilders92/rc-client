/**
 * Coercion at the JSON boundary.
 *
 * Royal's payloads carry numbers as strings, strings as numbers, and absent
 * fields as `null`, `""` or a missing key, with no consistency between
 * endpoints. Every domain module used to carry its own copy of these helpers
 * under its own name; this is the one home, so the semantics cannot drift.
 *
 * `int` and `money` are exported but unused inside `src/` itself — the
 * domain files that need integer or money coercion keep their own local
 * variant on top of the shared `num` instead of calling these directly.
 * That is deliberate, not dead code: `offers.ts`'s local `int` rounds to the
 * nearest whole number rather than truncating, because Royal's own integer
 * fields there only ever carry float noise, not genuine fractions; and
 * `products.ts`/`rooms.ts`'s local `money` rounds to cents, because Royal's
 * price fields carry noise past two decimal places. `int`/`money` are kept
 * exported as the canonical, undecorated forms those variants are measured
 * against — and for a consumer whose own data does not need the rounding.
 */

/** A trimmed, non-empty string. Finite numbers are accepted and stringified. */
export function str(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A finite number, from a number or a numeric string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** An integer, truncated toward zero. */
export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/** A positive amount. Zero is "no price", not a price of nothing. */
export function money(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}
