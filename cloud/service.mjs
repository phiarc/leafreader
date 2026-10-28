import { createHash, timingSafeEqual } from 'node:crypto';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
function authenticate(header, config) {
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header || '')?.[1];
  if (!token || !/^[a-f0-9]{64}$/.test(config.tokenHash || '')) return false;
  return timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(config.tokenHash, 'hex'));
}
function validate(body) {
  if (!body || typeof body !== 'object' || body.locatorVersion !== 1) return false;
  if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 || !validId(body.operationId) || !validId(body.deviceId)) return false;
  if (!Number.isFinite(body.progress) || body.progress < 0 || body.progress > 1) return false;
  const p = body.locator;
  if (!p || typeof p !== 'object') return false;
  if (p.type === 'txt') return Number.isSafeInteger(p.offset) && p.offset >= 0 && p.offset <= 1e9;
  if (p.type === 'pdf') return Number.isSafeInteger(p.page) && p.page >= 0 && p.page <= 1e7 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1;
  return false;
}
function publicRecord(doc) {
  return { bookId: doc.bookId, locatorVersion: 1, locator: doc.locator, progress: doc.progress, revision: doc.revision, updatedAt: doc.updatedAt, deviceId: doc.deviceId, operationId: doc.operationId };
}
function fingerprint(body) {
  return tokenHash(JSON.stringify({ locator: body.locator.type === 'txt' ? { type:'txt',offset:body.locator.offset } : {type:'pdf',page:body.locator.page,y:body.locator.y}, progress:body.progress, baseRevision:body.baseRevision, deviceId:body.deviceId }));
}
export function createService(store, config) {
  const rate = new Map();
  return async function handle({ method, path, authorization, body }) {
    const respond = (status, data) => ({ status, data });
    if (!authenticate(authorization, config)) return respond(401, { error: '连接码无效或服务尚未配置' });
    const userId = config.userId || 'owner';
    const minute = Math.floor(Date.now() / 60000); const recent = rate.get(userId);
    const count = recent?.minute === minute ? recent.count + 1 : 1; rate.set(userId, { minute, count });
    if (count > 180) return respond(429, { error: '请求过于频繁，请稍后重试' });
    if (method === 'GET' && path === '/v1/health') return respond(200, { ok:true, service:'leaf-reader-sync', version:1 });
    const match = /^\/v1\/books\/([a-f0-9]{64})\/progress$/.exec(path);
    if (!match) return config.library ? config.library({ userId, method, path, body }) : respond(404, { error:'接口不存在' });
    const bookId = match[1];
    if (!['GET','PUT'].includes(method)) return respond(405, { error:'不支持此请求方法' });
    if (method === 'PUT' && !validate(body)) return respond(400, { error:'阅读位置或版本数据无效' });
    try {
      const existing = await store.read(userId, bookId);
      if (method === 'GET') return existing ? respond(200, publicRecord(existing.doc)) : respond(404, { error:'暂无云端进度' });
      const digest = fingerprint(body);
      const checkOperation = doc => {
        const receipt = doc?.receipts?.find(item => item.id === body.operationId);
        if (!receipt) return null;
        return receipt.digest === digest ? respond(200, receipt.result) : respond(409, { error:'操作编号已经用于不同的更新', current:publicRecord(doc) });
      };
      const prior = checkOperation(existing?.doc); if (prior) return prior;
      const revision = existing?.doc.revision || 0;
      if (body.baseRevision !== revision) return respond(409, { error:'阅读进度发生冲突', current: existing ? publicRecord(existing.doc) : null });
      const locator = body.locator.type === 'txt' ? {type:'txt',offset:body.locator.offset} : {type:'pdf',page:body.locator.page,y:body.locator.y};
      const doc = { id:bookId, bookId, userId, locatorVersion:1, locator, progress:body.progress, revision:revision + 1,
        updatedAt:new Date().toISOString(), deviceId:body.deviceId, operationId:body.operationId };
      doc.receipts = [...(existing?.doc.receipts || []), {id:body.operationId,digest,result:publicRecord(doc)}].slice(-32);
      const stored = await store.compareAndSwap(userId, bookId, existing?.etag, doc);
      if (!stored) {
        const current = await store.read(userId, bookId); const duplicate = checkOperation(current?.doc);
        if (duplicate) return duplicate;
        return respond(409, { error:'另一台设备刚刚更新了进度', current: current ? publicRecord(current.doc) : null });
      }
      return respond(200, publicRecord(doc));
    } catch (err) {
      if (err.code === 429 || err.statusCode === 429) return respond(429, { error:'同步服务繁忙，请稍后重试' });
      return respond(503, { error:'同步暂时不可用，进度仍保存在本机' });
    }
  };
}
