import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLibrary,CHUNK_SIZE,blockId } from '../library.mjs';
import { fixture } from './helpers/library-fixture.mjs';
const token='library-test-only-not-a-real-token-000000000000';
const bytes=Buffer.from('第一章 春天\n正文内容。'); const id=createHash('sha256').update(bytes).digest('hex');
const info={title:'测试书',fileName:'测试书.txt',format:'txt',size:bytes.length,color:2};
async function upload(f,data=bytes,meta=info) {
  const bookId=createHash('sha256').update(data).digest('hex');const start=await f.request('PUT',`/v1/books/${bookId}/upload`,meta);assert.equal(start.status,200);
  const blob=new URL(start.data.url).pathname.slice('/leaf-books/'.length);
  for(let i=0;i<Math.ceil(data.length/CHUNK_SIZE);i++) f.chunks.set(`${blob}/${blockId(i)}`,data.subarray(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));
  const done=await f.request('PUT',`/v1/books/${bookId}/complete`,{session:start.data.session});return {start,done,bookId};
}
test('unauthenticated clients cannot enumerate files or obtain transfer URLs',async()=>{const f=fixture();for(const [method,path]of[['GET','/v1/library'],['PUT',`/v1/books/${id}/upload`],['GET',`/v1/books/${id}/download`]])assert.equal((await f.request(method,path,info,false)).status,401);});
test('only verified completed uploads appear in the cloud library; uploads deduplicate',async()=>{
 const f=fixture();const pending=await f.request('PUT',`/v1/books/${id}/upload`,info);assert.equal(pending.status,200);assert.equal((await f.request('GET','/v1/library')).data.books.length,0);
 const {done}=await upload(f);assert.equal(done.status,200);assert.equal((await f.request('GET','/v1/library')).data.used,bytes.length);
 const ready=await f.request('PUT',`/v1/books/${id}/upload`,info);assert.equal(ready.data.ready,true);assert.equal(ready.data.url,undefined);
 assert.equal((await f.request('GET',`/v1/books/${id}/download`)).status,200);
 assert.equal(done.data.book.blob,undefined);assert.equal(done.data.book.session,undefined);
});
test('session and completion retries are idempotent across process-like requests',async()=>{
 const f=fixture();const {start,done}=await upload(f);assert.equal(done.status,200);
 assert.equal((await f.request('PUT',`/v1/books/${id}/complete`,{session:start.data.session})).status,200);
 assert.equal((await f.request('PUT',`/v1/books/${id}/complete`,{session:'stale'})).status,409);
});
test('incomplete or corrupted uploads cannot publish or download',async()=>{const f=fixture();const r=await f.request('PUT',`/v1/books/${id}/upload`,info);assert.equal((await f.request('PUT',`/v1/books/${id}/complete`,{session:r.data.session})).status,422);assert.equal((await f.request('GET',`/v1/books/${id}/download`)).status,405);assert.deepEqual((await f.request('GET','/v1/library')).data.books,[]);});
test('quota reservations prevent concurrent first uploads from overspending capacity',async()=>{
 const f=fixture(bytes.length);const other='a'.repeat(64);const result=await Promise.all([f.request('PUT',`/v1/books/${id}/upload`,info),f.request('PUT',`/v1/books/${other}/upload`,info)]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,413]);
});
test('file type, size, and paths are validated before any upload URL is issued',async()=>{const f=fixture();for(const invalid of[{...info,size:0},{...info,size:31*1024**2},{...info,format:'exe'},{...info,title:''}])assert.equal((await f.request('PUT',`/v1/books/${id}/upload`,invalid)).status,400);assert.equal((await f.request('PUT','/v1/books/../../upload',info)).status,404);});
test('cloud deletion is durable, retries cleanup, and refuses resurrection from stale clients',async()=>{
 const f=fixture();await upload(f);f.setCleanupFailure(true);assert.equal((await f.request('DELETE',`/v1/books/${id}/file`)).status,503);
 assert.equal((await f.request('GET',`/v1/books/${id}/download`)).status,404);assert.equal((await f.request('GET','/v1/library')).data.books[0].state,'deleted');
 assert.equal((await f.request('PUT',`/v1/books/${id}/upload`,info)).status,409);
 f.setCleanupFailure(false);assert.equal((await f.request('DELETE',`/v1/books/${id}/file`)).status,200);assert.equal(f.frozen.size,0);
 assert.equal((await f.request('PUT',`/v1/books/${id}/upload`,{...info,restore:true})).status,200);
});
test('a snapshot remains immutable after an upload URL is used to replace staging bytes',async()=>{
 const f=fixture();const {start}=await upload(f);const url=new URL(start.data.url);const blob=url.pathname.slice('/leaf-books/'.length);f.chunks.set(`${blob}/${blockId(0)}`,Buffer.from('修改正文'));
 const download=await f.request('GET',`/v1/books/${id}/download`);assert.equal(download.status,200);const snapshot=new URL(download.data.url).searchParams.get('snapshot');assert.deepEqual(f.frozen.get(`${blob}/${snapshot}`),bytes);
});
