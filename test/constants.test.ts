import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOM_CLASSES, ROOM_CLASS_NAMES, ROOM_CLASS_BRAND, PROMO_KINDS,
  BRANDS, BRAND_NAMES, SORT_FIELDS, PRODUCT_CATEGORIES,
  classifyPromo, type RcRoomClass, type RcPromoKind,
} from '../src/index.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The members of `export type X = 'a' | 'b'`, however it is line-wrapped. */
function unionMembers(file: string, name: string): string[] {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const at = src.indexOf(`export type ${name} =`);
  assert.ok(at >= 0, `${name} is declared in ${file}`);
  const body = src.slice(at, src.indexOf(';', at));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

test('every room class in the type has a constant, a name and a brand', () => {
  const declared = unionMembers('domains/catalogue.ts', 'RcRoomClass');
  assert.deepEqual([...ROOM_CLASSES].sort(), declared.sort(), 'ROOM_CLASSES covers the type');
  for (const c of ROOM_CLASSES) {
    assert.ok(ROOM_CLASS_NAMES[c], `${c} has a display name`);
    assert.ok(c in ROOM_CLASS_BRAND, `${c} says which brand sells it`);
  }
});

test('Concierge and AquaClass are marked Celebrity-only; the four shared ones are not', () => {
  assert.equal(ROOM_CLASS_BRAND.CONCIERGE, 'C');
  assert.equal(ROOM_CLASS_BRAND.AQUA, 'C');
  for (const c of ['INTERIOR', 'OCEANVIEW', 'BALCONY', 'SUITE'] as RcRoomClass[]) {
    assert.equal(ROOM_CLASS_BRAND[c], null, `${c} is sold by both brands`);
  }
});

test('every promo kind in the type has a constant, and classifyPromo only returns those', () => {
  const declared = unionMembers('domains/catalogue.ts', 'RcPromoKind');
  assert.deepEqual([...PROMO_KINDS].sort(), declared.sort());
  const labels = ['Kids Sail Free', '60% off 2nd guest', '$100 onboard credit', '$300 off', 'Something else'];
  for (const l of labels) {
    assert.ok(PROMO_KINDS.includes(classifyPromo(l) as RcPromoKind), `${l} classifies to a listed kind`);
  }
});

test('every brand in the type has a constant and a name', () => {
  const declared = unionMembers('brand.ts', 'Brand');
  assert.deepEqual([...BRANDS].sort(), declared.sort());
  for (const b of BRANDS) assert.ok(BRAND_NAMES[b]);
});

test('the other public lists are non-empty and free of duplicates', () => {
  for (const [name, list] of [['SORT_FIELDS', SORT_FIELDS], ['PRODUCT_CATEGORIES', PRODUCT_CATEGORIES]] as const) {
    assert.ok(list.length > 0, `${name} is non-empty`);
    assert.equal(new Set(list).size, list.length, `${name} has no duplicates`);
  }
});
