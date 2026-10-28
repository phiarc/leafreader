import { readFile,writeFile } from 'node:fs/promises';
import { createHash,randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const {endpoint,token}=JSON.parse(await readFile('.cache/leaf-sync-connection.json','utf8'));
const checks=[];
const native = process.argv.includes('--native');
async function blobRequest(url,options) {
 if (!native) return fetch(url,options);
 const method=options.method || 'GET';
 const range=options.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
 const args={url:String(url),method,...(method==='PUT'?{data:Buffer.from(options.body).toString('base64')}:{start:Number(range[1]),length:Number(range[2])-Number(range[1])+1})};
 const output=JSON.parse(execFileSync('build/tests/native-transfer/check',{input:JSON.stringify(args),encoding:'utf8',timeout:60000}));
 if(output.error) throw new Error(output.error);
 return {status:output.status,arrayBuffer:async()=>Buffer.from(output.data,'base64')};
}
async function request(method,path,body,auth=true) {
 const result=await fetch(`${endpoint}${path}`,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 return {status:result.status,data:await result.json()};
}
const step=(label)=>{checks.push(label);console.log(label+' passed');};
assert.equal((await request('GET','/v1/library',undefined,false)).status,401);step('Unauthorized library request rejected');
const library=await request('GET','/v1/library');assert.equal(library.status,200,JSON.stringify(library));assert.equal(library.data.quota,5*1024**3);step('Cloud library and 5 GiB quota');
for(const format of ['txt','pdf']) {
 const bytes=format==='txt'?Buffer.from(`第一章 同步验证 ${randomUUID()}\n`+'测试正文😀'.repeat(24000)):await readFile('tests/fixtures/阅读器验证.pdf');
 const id=createHash('sha256').update(bytes).digest('hex');const path=`/v1/books/${id}`;
 try {
  const info={title:'自动同步验证（临时）',fileName:`verification.${format}`,format,size:bytes.length,color:0,restore:true};
  const start=await request('PUT',path+'/upload',info);assert.equal(start.status,200,JSON.stringify(start));
  assert.equal(start.data.ready,undefined,'test must use a fresh verification document');
  for(let offset=0,index=0;offset<bytes.length;offset+=262144,index++) {
   const url=new URL(start.data.url);url.searchParams.set('comp','block');url.searchParams.set('blockid',Buffer.from(String(index).padStart(6,'0')).toString('base64'));
   const result=await blobRequest(url,{method:'PUT',headers:{'x-ms-version':'2023-11-03','Content-Type':'application/octet-stream'},body:bytes.subarray(offset,offset+262144),redirect:'error',signal:AbortSignal.timeout(45000)});
   assert.equal(result.status,201,`${format} block response ${result.status}`);
  }
  const done=await request('PUT',path+'/complete',{session:start.data.session});assert.equal(done.status,200,JSON.stringify(done));step(`${format.toUpperCase()} direct block upload, commit and SHA-256 verification`);
  assert.equal((await request('PUT',path+'/complete',{session:start.data.session})).status,200);step(`${format.toUpperCase()} completion retry`);
  const listed=await request('GET','/v1/library');assert.ok(listed.data.books.some(b=>b.id===id && b.state==='ready'));step(`${format.toUpperCase()} discoverable from another client`);
  const download=await request('GET',path+'/download');assert.equal(download.status,200,JSON.stringify(download));
  const unauthenticated=new URL(download.data.url);unauthenticated.search='';assert.equal((await fetch(unauthenticated,{signal:AbortSignal.timeout(30000)})).ok,false);step(`${format.toUpperCase()} anonymous Blob access blocked`);
  const chunks=[];
  for(let offset=0;offset<bytes.length;offset+=262144) {
   const result=await blobRequest(download.data.url,{headers:{Range:`bytes=${offset}-${Math.min(bytes.length,offset+262144)-1}`},signal:AbortSignal.timeout(45000),redirect:'error'});assert.equal(result.status,206);chunks.push(Buffer.from(await result.arrayBuffer()));
  }
  assert.deepEqual(Buffer.concat(chunks),bytes);step(`${format.toUpperCase()} ranged download exactly matches original`);
  const deleted=await request('DELETE',path+'/file');assert.equal(deleted.status,200,JSON.stringify(deleted));assert.equal((await request('GET',path+'/download')).status,404);step(`${format.toUpperCase()} cloud deletion`);
 } finally { await request('DELETE',path+'/file').catch(()=>{}); }
}
await writeFile('build/cloud/library-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),endpoint,nativeMacTransport:native,checks,privateContentUploaded:false,fixturesDeleted:true},null,2));
console.log('Live book synchronization verified; synthetic fixtures deleted.');
