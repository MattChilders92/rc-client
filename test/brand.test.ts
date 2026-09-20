import test from 'node:test';
import assert from 'node:assert/strict';
import { brandHost, BRANDS, BRAND_NAMES, type Brand } from '../src/brand.ts';

test('each brand maps to its own consumer site', () => {
  assert.equal(brandHost('R'), 'www.royalcaribbean.com');
  assert.equal(brandHost('C'), 'www.celebritycruises.com');
});

test('every brand has a host and a name, and there are no others', () => {
  assert.deepEqual([...BRANDS], ['R', 'C']);
  for (const b of BRANDS) {
    assert.ok(brandHost(b).endsWith('.com'), `${b} has a host`);
    assert.ok(BRAND_NAMES[b].length > 0, `${b} has a name`);
  }
});

test('the host is bare — no scheme, no trailing slash — so callers compose it', () => {
  for (const b of BRANDS) {
    assert.doesNotMatch(brandHost(b), /^https?:|\/$/);
  }
});

test('an unknown brand is rejected rather than silently treated as Royal', () => {
  assert.throws(() => brandHost('X' as Brand), /brand/i);
});
