import { createServer } from 'node:http';
import { createService, tokenHash } from './service.mjs';
import { FileStore } from './stores.mjs';
const token = process.env.LEAF_DEV_TOKEN;
if (!token || !/^[a-zA-Z0-9_-]{32,256}$/.test(token)) throw new Error('Set LEAF_DEV_TOKEN to a development-only token of at least 32 URL-safe characters.');
const store = await new FileStore(new URL('.local-data',import.meta.url).pathname).load();
const handle = createService(store,{tokenHash:tokenHash(token),userId:'local-owner'});
const server = createServer(async (request,response) => {
  const origin = request.headers.origin;
  const allowedOrigin = origin && /^http:\/\/(127\.0\.0\.1|localhost):(5173|17643)$/.test(origin);
  if (allowedOrigin) response.setHeader('Access-Control-Allow-Origin',origin);
  response.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type'); response.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');
  response.setHeader('Cache-Control','no-store');
  if (request.method === 'OPTIONS') { response.writeHead(allowedOrigin ? 204 : 403); response.end(); return; }
  let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 8192) { response.writeHead(413); response.end(); return; } }
  let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { response.writeHead(400,{'Content-Type':'application/json'}); response.end('{"error":"请求格式无效"}'); return; }
  const path = new URL(request.url,'http://127.0.0.1').pathname.replace(/^\/api/,'');
  const result = await handle({method:request.method,path,authorization:request.headers.authorization,body});
  response.writeHead(result.status,{'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify(result.data));
});
server.listen(7071,'127.0.0.1',()=>console.log('Local development sync API: http://127.0.0.1:7071/api (not an Azure deployment)'));
