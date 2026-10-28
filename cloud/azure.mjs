import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';
import { createLibrary } from './library.mjs';
import { azureFiles } from './blob-store.mjs';
import { createService } from './service.mjs';
let handle;
function service() {
  if (handle) return handle;
  if (!process.env.COSMOS_CONNECTION_STRING) throw new Error('Missing Cosmos configuration');
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  const container = client.database('leaf-reader').container('progress');
  const store = {
    async read(user, book) {
      try { const {resource} = await container.item(book,user).read(); return resource ? {doc:resource,etag:resource._etag} : null; }
      catch (err) { if (err.code === 404) return null; throw err; }
    },
    async compareAndSwap(user, book, etag, doc) {
      try {
        if (etag === undefined) await container.items.create(doc);
        else await container.item(book,user).replace(doc,{accessCondition:{type:'IfMatch',condition:etag}});
        return true;
      } catch (err) { if ([409,412].includes(err.code)) return false; throw err; }
    }
  };
  handle = createService(store,{tokenHash:process.env.SYNC_TOKEN_HASH,userId:process.env.SYNC_USER_ID || 'owner',library:process.env.BOOK_STORAGE_ACCOUNT ? createLibrary(store,azureFiles(process.env.BOOK_STORAGE_ACCOUNT)) : undefined}); return handle;
}
app.http('progress',{
  methods:['GET','PUT','POST','DELETE'],authLevel:'anonymous',route:'v1/{*path}',
  handler:async request => {
    if (Number(request.headers.get('content-length') || 0) > 8192) return {status:413,jsonBody:{error:'请求过大'}};
    let body;
    if (request.method === 'PUT' || request.method === 'POST') {
      const text = await request.text(); if (Buffer.byteLength(text) > 8192) return {status:413,jsonBody:{error:'请求过大'}};
      try { body = JSON.parse(text); } catch { return {status:400,jsonBody:{error:'请求格式无效'}}; }
    }
    try {
      const result = await service()({method:request.method,path:`/v1/${request.params.path || ''}`,authorization:request.headers.get('authorization'),body});
      return {status:result.status,jsonBody:result.data,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}};
    } catch { return {status:503,jsonBody:{error:'同步服务尚未完成配置'}}; }
  }
});
