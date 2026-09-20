import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDACT_KEYS } from '../src/redaction.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.local.json'));

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * A scrubbed uuid: the capture script's blanket rule zeroes the first four
 * groups and the last group too (00000000-0000-0000-0000-000000000000), but
 * `DISTINCT_KEYS` values (see scripts/capture.ts) get a stable per-value
 * surrogate in that last group instead, so two different grants stay
 * distinguishable — e.g. 00000000-0000-0000-0000-000000000001, …0002. Either
 * shape is fine; only the first four groups have to be all zeros.
 */
const SCRUBBED_UUID = /^0{8}-0{4}-0{4}-0{4}-[0-9a-f]{12}$/i;

/**
 * Values under redacted keys may be REDACTED, empty, null, a scrubbed uuid
 * (shared zero or a distinct surrogate), an @example.com email, or the `0`
 * the capture script writes in place of a redacted number.
 */
const isScrubbed = (v: unknown): boolean =>
  v === null || v === '' || v === 'REDACTED' || v === 0 ||
  (typeof v === 'string' && SCRUBBED_UUID.test(v)) ||
  (typeof v === 'string' && v.endsWith('@example.com'));

function* walk(node: unknown, trail: string[] = []): Generator<{ key: string; value: unknown; trail: string[] }> {
  if (Array.isArray(node)) { for (const [i, v] of node.entries()) yield* walk(v, [...trail, String(i)]); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      yield { key: k, value: v, trail: [...trail, k] };
      yield* walk(v, [...trail, k]);
    }
  }
}

test('there is at least one fixture to check', () => { assert.ok(files.length > 0); });

for (const file of files) {
  test(`${file} carries nothing identifying`, () => {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    assert.doesNotMatch(text, JWT, 'a JWT-shaped token');
    for (const m of text.match(EMAIL) ?? []) assert.ok(m.endsWith('@example.com'), `email ${m}`);
    for (const m of text.match(UUID) ?? []) assert.match(m, SCRUBBED_UUID, `uuid ${m}`);
    const leaks: string[] = [];
    for (const { key, value, trail } of walk(JSON.parse(text))) {
      if (REDACT_KEYS.has(key.toLowerCase()) && typeof value !== 'object' && !isScrubbed(value)) {
        leaks.push(`${trail.join('.')} = ${JSON.stringify(value)}`);
      }
    }
    assert.deepEqual(leaks, [], `unscrubbed values:\n  ${leaks.join('\n  ')}`);
  });
}
