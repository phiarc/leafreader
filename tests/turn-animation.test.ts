import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, ref, watch } from 'vue';
import { restartTurnAnimation } from '../src/core/turn-animation';
test('a running turn removes its class in a Vue flush before restarting', async () => {
  const active = ref(true); let renderedClass = true; const observed: boolean[] = [];
  const stop = watch(active, value => { renderedClass = value; observed.push(value); }, { flush: 'post' });
  assert.equal(await restartTurnAnimation(active, nextTick, () => true, () => assert.equal(renderedClass, false)), true);
  await nextTick(); assert.deepEqual(observed, [false, true]); stop();
});
test('a discarded page cannot restart an animation after its asynchronous flush', async () => {
  const active = ref(true);
  assert.equal(await restartTurnAnimation(active, nextTick, () => false, () => assert.fail('stale layout')), false);
  assert.equal(active.value, false);
});
