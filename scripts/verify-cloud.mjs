import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const {endpoint,token}=JSON.parse(await readFile('.cache/leaf-sync-connection.json','utf8'));
const bookId=createHash('sha256').update(`leaf-cloud-verification/${randomUUID()}`).digest('hex');
async function request(method,path,body,authenticated=true){
  const response=await fetch(`${endpoint}${path}`,{method,headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  return{status:response.status,data:await response.json()};
}
const path=`/v1/books/${bookId}/progress`;
assert.equal((await request('GET','/v1/health')).status,200);
assert.equal((await request('GET',path,undefined,false)).status,401);
assert.equal((await request('GET',path)).status,404);
const body={locatorVersion:1,locator:{type:'txt',offset:127},progress:.25,baseRevision:0,deviceId:'verification-device-mac',operationId:randomUUID()};
const first=await request('PUT',path,body);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.revision,1);
const read=await request('GET',path);assert.equal(read.data.locator.offset,127);
const retry=await request('PUT',path,body);assert.equal(retry.status,200);assert.equal(retry.data.revision,1);
const stale=await request('PUT',path,{...body,operationId:randomUUID(),locator:{type:'txt',offset:44}});assert.equal(stale.status,409);
const second=await request('PUT',path,{...body,baseRevision:1,operationId:randomUUID(),locator:{type:'txt',offset:3},progress:.01});assert.equal(second.status,200);assert.equal(second.data.revision,2);
const report={endpoint,verifiedAt:new Date().toISOString(),checks:['authenticated health','unauthorized request rejected','missing progress returns 404','Cosmos DB write','Cosmos DB read','idempotent retry','stale conflict rejected','intentional backward reading accepted'],testRecord:bookId};
await writeFile('build/cloud/verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
