import test from 'node:test';
import assert from 'node:assert/strict';
import { tapZone } from '../src/core/tap-zone.mjs';
test('side taps turn pages and the middle keeps the existing double-tap gesture', () => {
  assert.equal(tapZone(100, 100, 600), 'previous');
  assert.equal(tapZone(280, 100, 600), 'previous');
  assert.equal(tapZone(281, 100, 600), 'center');
  assert.equal(tapZone(519, 100, 600), 'center');
  assert.equal(tapZone(520, 100, 600), 'next');
  assert.equal(tapZone(700, 100, 600), 'next');
});
test('taps outside the page are ignored', () => {
  assert.equal(tapZone(99, 100, 600), 'none');
  assert.equal(tapZone(701, 100, 600), 'none');
  assert.equal(tapZone(100, 100, 0), 'none');
  assert.equal(tapZone(NaN, 100, 600), 'none');
});
