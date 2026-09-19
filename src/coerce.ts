/**
 * Coercion at the JSON boundary.
 *
 * Royal's payloads carry numbers as strings, strings as numbers, and absent
 * fields as `null`, `""` or a missing key, with no consistency between
 * endpoints. Every domain module used to carry its own copy of these helpers
 * under its own name; this is the one home, so the semantics cannot drift.
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
