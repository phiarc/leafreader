import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackpadPager } from '../src/core/trackpad.mjs';
const wheel = (x, y = 0, extra = {}) => ({deltaX:x, deltaY:y, deltaMode:0, ...extra});
test('the first small delta updates sheet progress without turning a page', () => {
  const pager = new TrackpadPager(); pager.begin(0);
  const result = pager.handle(wheel(20), 1, 400);
  assert.equal(result.distance, 20); assert.equal(result.progress, .05); assert.equal(result.turn, null);
});
test('crossing the distance threshold commits immediately without waiting for release', () => {
  const pager = new TrackpadPager(); pager.begin(0);
  assert.equal(pager.handle(wheel(35), 10, 400).turn, null);
  assert.equal(pager.handle(wheel(40), 20, 400).turn, 'next'); assert.equal(pager.active, true);
});
test('lifting short of the threshold requests rollback and leaves the gesture uncommitted', () => {
  const pager = new TrackpadPager(); pager.begin(0); pager.handle(wheel(30), 1, 740);
  assert.deepEqual(pager.end(), {commit:false, distance:30});
});
test('reverse movement retracts the existing distance before opening the opposite page', () => {
  const pager = new TrackpadPager(); pager.begin(0);
  pager.handle(wheel(40), 1, 400); assert.equal(pager.handle(wheel(-20), 2, 400).distance, 20);
  assert.equal(pager.handle(wheel(-60), 3, 400).turn, null);
  assert.equal(pager.handle(wheel(-40), 4, 400).turn, 'previous');
});
test('one physical gesture commits once and its momentum cannot advance another page', () => {
  const pager = new TrackpadPager(); pager.begin(0);
  assert.equal(pager.handle(wheel(120), 1).turn, 'next'); pager.end();
  for (let time=10; time<1000; time+=20) assert.equal(pager.handle(wheel(200), time).turn, null);
});
test('a fresh native gesture can commit immediately even during the prior inertia window', () => {
  const pager = new TrackpadPager(); pager.begin(0); pager.handle(wheel(120), 1); pager.end();
  pager.begin(15); assert.equal(pager.handle(wheel(-120), 16).turn, 'previous');
  assert.equal(pager.end(true).commit, false);
});
test('browser fallback suppresses late tail events and accepts a new gesture after idle', () => {
  const pager = new TrackpadPager(); assert.equal(pager.handle(wheel(120), 0).turn, 'next'); pager.end();
  for (let time=100; time<800; time+=100) assert.equal(pager.handle(wheel(60),time).turn,null);
  assert.equal(pager.handle(wheel(120),1000).turn,'next');
});
test('vertical scroll, diagonal noise, pinch and non-finite input remain unconsumed', () => {
  const pager = new TrackpadPager();
  for (const event of [wheel(0,90), wheel(20,40), wheel(80,0,{ctrlKey:true}), wheel(80,0,{metaKey:true}), wheel(NaN)]) assert.equal(pager.handle(event, 0).consume, false);
  assert.equal(pager.handle(wheel(8,0,{deltaMode:1}),10).turn,'next');
});
