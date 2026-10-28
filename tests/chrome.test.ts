import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(globalThis, { window: {} });
const { parseChromeAction, publishChrome } = await import('../src/chrome');
test('native UI actions reject malformed and unknown operations', () => {
  for (const input of [null, 'seek', {action: 3}, {action: 'cloudRequest'}, {action: 'getSecret'}]) assert.equal(parseChromeAction(input), undefined);
  assert.deepEqual(parseChromeAction({action: 'seek', value: .5}), {action: 'seek', value: .5});
  assert.deepEqual(parseChromeAction({action: 'preferences', value: {theme: 'night'}}), {action: 'preferences', value: {theme: 'night'}});
});
test('previews without native UI capability do not invoke the native chrome bridge', () => {
  assert.doesNotThrow(() => publishChrome({mode:'library',theme:'paper',fontSize:20,animation:'slide',pageMargin:0,bookCount:0,bookmarkCount:0,bookmarkView:false,search:'',syncState:'',busy:false,blocked:false,reader:null}));
});
