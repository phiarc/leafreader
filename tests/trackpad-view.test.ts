import test from 'node:test';
import assert from 'node:assert/strict';
import { dragFrames } from '../src/core/trackpad-view';
test('adjacent sheets move by exactly the same physical pixel distance', () => {
  assert.deepEqual(dragFrames(40, 740, false), {current:-40, adjacent:700});
  assert.deepEqual(dragFrames(-40, 740, true), {current:40, adjacent:-700});
});
test('moving back toward the origin retracts both sheets without changing page geometry', () => {
  const start=dragFrames(60,740,false), retracted=dragFrames(20,740,false);
  assert.equal(retracted.current-start.current,40); assert.equal(retracted.adjacent-start.adjacent,40);
  assert.deepEqual(dragFrames(0,740,false),{current:0,adjacent:740});
});
test('book boundaries resist with a small elastic displacement rather than expose a blank page', () => {
  assert.deepEqual(dragFrames(400,740,false,true),{current:-26,adjacent:714});
  assert.deepEqual(dragFrames(-400,740,true,true),{current:26,adjacent:-714});
});
