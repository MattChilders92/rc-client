import test from 'node:test';
import assert from 'node:assert/strict';
import { str, num, int, money } from '../src/coerce.ts';

test('str keeps non-empty strings and finite numbers, trimmed', () => {
  assert.equal(str(' LE '), 'LE');
  assert.equal(str(7), '7');
  assert.equal(str(''), null);
  assert.equal(str('   '), null);
  assert.equal(str(null), null);
  assert.equal(str(undefined), null);
  assert.equal(str(NaN), null);
  assert.equal(str({}), null);
  assert.equal(str(true), null);
});

test('num accepts numbers and numeric strings, else null', () => {
  assert.equal(num(3.5), 3.5);
  assert.equal(num('3.5'), 3.5);
  assert.equal(num('0'), 0);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(null), null);
  assert.equal(num(Infinity), null);
});

test('int truncates toward zero and rejects non-numbers', () => {
  assert.equal(int(7.9), 7);
  assert.equal(int('-2.5'), -2);
  assert.equal(int('x'), null);
  assert.equal(int(undefined), null);
});

test('money is a positive amount or null — a zero price is not a price', () => {
  assert.equal(money(1234.5), 1234.5);
  assert.equal(money('1234.5'), 1234.5);
  assert.equal(money(0), null);
  assert.equal(money(-1), null);
  assert.equal(money(null), null);
});
