import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';
import { fixture } from '../cloud/test/helpers/library-fixture.mjs';
import type { Book } from '../src/types';
Object.assign(globalThis,{window:{},indexedDB});
const bridge=await import('../src/bridge');
const {uploadBook,downloadBook,listCloudBooks,libraryRequest,CHUNK_SIZE}=await import('../src/library');
const f=fixture();let failOneBlock=true;let corruptDownload=false;let maxChunk=0;
const fakeWindow=window as any;
fakeWindow.LeafNative={postMessage:async(raw:string)=>{
 const message=JSON.parse(raw);const a=message.args;
 try {
  let result;
  if(message.method==='getSecret')result='library-test-only-not-a-real-token-000000000000';
  else if(message.method==='cloudRequest')result=await f.request(a.method,a.path,a.body);
  else if(message.method==='blobTransfer') {
   const url=new URL(a.url);const path=url.pathname.slice('/leaf-books/'.length);
   if(a.method==='PUT') {if(failOneBlock){failOneBlock=false;throw new Error('simulated dropped connection');}const bytes=Buffer.from(a.data,'base64');maxChunk=Math.max(maxChunk,bytes.length);f.chunks.set(`${path}/${url.searchParams.get('blockid')}`,bytes);result={status:201,data:''};}
   else {const bytes=Buffer.from(f.frozen.get(`${path}/${url.searchParams.get('snapshot')}`)!.subarray(a.start,a.start+a.length));if(corruptDownload)bytes[0]^=1;result={status:206,data:bytes.toString('base64')};}
  }
  fakeWindow.__leafReply({id:message.id,result});
 }catch(error){fakeWindow.__leafReply({id:message.id,error:(error as Error).message});}
}};
const content=new Blob(['第一章 书名\n'+'完整正文😀'.repeat(25000)]);const bytes=await content.arrayBuffer();
const book:Book={id:createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),title:'跨设备测试',fileName:'测试.txt',format:'txt',size:content.size,color:1,importedAt:new Date().toISOString(),locator:{type:'txt',offset:0},progress:0,revision:0,dirty:false,content,bookmarks:[]};
const endpoint='https://fixture.azurewebsites.net/api';
test('real client uploads bounded chunks with retry, another client discovers and downloads exact bytes',async()=>{
 await uploadBook(book,endpoint);assert.equal(maxChunk,CHUNK_SIZE);assert.ok(book.size>CHUNK_SIZE);
 const listed=await listCloudBooks(endpoint);assert.equal(listed[0].id,book.id);assert.equal(listed[0].title,book.title);
 const downloaded=await downloadBook({...book,content:new Blob(),missingFile:true},endpoint);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(bytes));
 await uploadBook(book,endpoint);assert.equal(f.frozen.size,1);
});
test('real client refuses corrupted downloaded content and cloud deletions become visible',async()=>{
 corruptDownload=true;await assert.rejects(downloadBook(book,endpoint),/校验/);corruptDownload=false;
 await libraryRequest(endpoint,'DELETE',`/v1/books/${book.id}/file`);assert.equal((await listCloudBooks(endpoint))[0].state,'deleted');
 await assert.rejects(downloadBook(book,endpoint),/不存在/);
});
