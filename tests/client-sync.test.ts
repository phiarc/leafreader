import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { reactive, toRaw } from 'vue';
import { createService, tokenHash } from '../cloud/service.mjs';
import { MemoryStore } from '../cloud/stores.mjs';
import type { Book } from '../src/types';
const storage = new Map<string,string>();
Object.assign(globalThis,{indexedDB,localStorage:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)},window:{}});
const bridge = await import('../src/bridge');
const { syncBooks } = await import('../src/sync');
const { listBooks,saveBook } = await import('../src/storage');
const token='development-only-client-test-000000000000000000000000';
const store=new MemoryStore(); const service=createService(store,{tokenHash:tokenHash(token),userId:'owner'});
let failNextWrite=false;
const fakeWindow=globalThis.window as any;
fakeWindow.LeafNative={postMessage:async(raw:string)=>{
  const message=JSON.parse(raw);
  try {
    let result;
    if(message.method==='getSecret') result=token;
    else if(message.method==='cloudRequest'){
      if(failNextWrite && message.args.method==='PUT'){failNextWrite=false;await service({method:'PUT',path:message.args.path,authorization:`Bearer ${token}`,body:message.args.body});throw new Error('Simulated response loss');}
      result=await service({method:message.args.method,path:message.args.path,authorization:`Bearer ${token}`,body:message.args.body});
    }
    fakeWindow.__leafReply({id:message.id,result});
  }catch(error){fakeWindow.__leafReply({id:message.id,error:(error as Error).message});}
}};
function book(id:string):Book{return{id:id.repeat(64),title:'集成测试',fileName:'集成测试.txt',format:'txt',size:20,importedAt:new Date().toISOString(),color:0,locator:{type:'txt',offset:10},progress:.2,revision:0,dirty:true,pendingOperationId:crypto.randomUUID(),content:new Blob(['这是测试正文']),bookmarks:[]};}
test('reactive library books persist and synchronize through the actual client bridge',async()=>{
  const books=reactive([book('b')]);await saveBook(structuredClone(toRaw(books[0])));
  const result=await syncBooks(books,'https://example.azurewebsites.net/api');
  assert.equal(result.conflicts.length,0);assert.equal(result.updated[0].revision,1);assert.equal(result.updated[0].dirty,false);
  assert.ok((await listBooks()).find(item=>item.id==='b'.repeat(64)));
});
test('lost responses can be retried without creating a false conflict',async()=>{
  const books=reactive([book('c')]);failNextWrite=true;
  await assert.rejects(syncBooks(books,'https://example.azurewebsites.net/api'),/Simulated response loss/);
  const retry=await syncBooks(books,'https://example.azurewebsites.net/api');assert.equal(retry.updated[0].revision,1);assert.equal(retry.conflicts.length,0);
});
test('the actual client exposes a conflict rather than replacing another device location',async()=>{
  const local=book('d');await syncBooks(reactive([local]),'https://example.azurewebsites.net/api');
  const other=await service({method:'PUT',path:`/v1/books/${local.id}/progress`,authorization:`Bearer ${token}`,body:{locatorVersion:1,locator:{type:'txt',offset:999},progress:.9,baseRevision:1,deviceId:'other-device-001',operationId:'other-operation-001'}});assert.equal(other.status,200);
  const result=await syncBooks(reactive([{...local,pendingOperationId:crypto.randomUUID()}]),'https://example.azurewebsites.net/api');assert.equal(result.updated.length,0);assert.equal(result.conflicts[0].remote.locator.offset,999);
});
test('unresolved conflicts and missing files are excluded while other books still sync', async () => {
  const conflicted = book('1'); const missing = {...book('2'), missingFile: true}; const available = book('3');
  const result = await syncBooks(reactive([conflicted, missing, available]), 'https://example.azurewebsites.net/api', new Set([conflicted.id]));
  assert.deepEqual(result.updated.map(b => b.id), [available.id]);
  for (const skipped of [conflicted, missing]) {
    const remote = await service({method:'GET',path:`/v1/books/${skipped.id}/progress`,authorization:`Bearer ${token}`}); assert.equal(remote.status, 404);
  }
  const resumed = await syncBooks(reactive([conflicted]), 'https://example.azurewebsites.net/api'); assert.equal(resumed.updated.length, 1);
});
