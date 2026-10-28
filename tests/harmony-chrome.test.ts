import test from 'node:test';
import assert from 'node:assert/strict';
const requests: any[] = [];
let received: (request: any) => void = () => {};
const fakeWindow: any = {
  __leafNativeChrome: true, __leafNativePlatform: 'harmony',
  LeafNative: { postMessage: (raw: string) => {
    const request = JSON.parse(raw); requests.push(request);
    fakeWindow.__leafReply({id: request.id, result: true}); received(request);
  } }
};
Object.assign(globalThis, {window: fakeWindow});
const chrome = await import('../src/chrome');
test('Harmony document-start capability selects its own native UI platform', () => {
  assert.equal(chrome.nativeChrome, true); assert.equal(chrome.nativeChromePlatform, 'harmony');
  assert.deepEqual(chrome.parseChromeAction({action: 'back'}), {action: 'back', value: undefined});
  assert.deepEqual(chrome.parseChromeAction({action: 'controlsInteracting', value: true}), {action: 'controlsInteracting', value: true});
});
test('Harmony publishes the latest reader state through the actual LeafNative bridge', async () => {
  const base = {mode:'library' as const,theme:'paper',fontSize:20,animation:'slide',pageMargin:0,bookCount:2,bookmarkCount:1,bookmarkView:false,search:'',syncState:'已同步',busy:false,blocked:false,reader:null};
  const posted = new Promise<any>(resolve => { received = resolve; });
  chrome.publishChrome(base);
  chrome.publishChrome({...base,mode:'reader',blocked:true,reader:{title:'演示书',chapter:'第二章',format:'txt',progress:.25,encoding:'utf-8',zoom:1,visible:true,loading:false}});
  const message = await posted; chrome.stopChromeUpdates();
  assert.equal(requests.length, 1); assert.equal(message.method, 'updateChrome');
  assert.equal(message.args.state.mode, 'reader'); assert.equal(message.args.state.blocked, true);
  assert.equal(message.args.state.reader.chapter, '第二章'); assert.equal(message.args.state.reader.progress, .25);
});
