import { randomUUID } from 'node:crypto';
export const CHUNK_SIZE = 256 * 1024;
export const QUOTA = 5 * 1024 ** 3;
const idPattern = /^[a-f0-9]{64}$/;
export const blockId = index => Buffer.from(String(index).padStart(6, '0')).toString('base64');
function metadata(body, id) {
  if (!body || !['txt','pdf'].includes(body.format) || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > (body.format === 'txt' ? 30 : 100) * 1024 ** 2) return null;
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 150 || typeof body.fileName !== 'string' || body.fileName.length > 240) return null;
  return { id, title:body.title, fileName:body.fileName, format:body.format, size:body.size, color:Number.isInteger(body.color) ? Math.max(0,Math.min(5,body.color)) : 0,
    encoding:['auto','utf-8','gb18030','utf-16le','utf-16be','big5'].includes(body.encoding) ? body.encoding : 'auto', importedAt:new Date().toISOString() };
}
function exposed(book) {
  if (book.state==='deleted') return {id:book.id,state:'deleted',updatedAt:book.updatedAt};
  const { blob, session, expiresAt, snapshot, ...info } = book;
  return info;
}
class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }
export function createLibrary(store, files, quota = QUOTA) {
  const read = async user => await store.read(user,'library-v1');
  const booksOf = record => record?.doc.books || {};
  async function change(user, fn) {
    for (let attempt=0;attempt<8;attempt++) {
      const prior=await read(user); const books=structuredClone(booksOf(prior));
      const result=fn(books);
      if (await store.compareAndSwap(user,'library-v1',prior?.etag,{id:'library-v1',userId:user,books})) return result;
    }
    throw new ApiError(409,'书库正在更新，请重试');
  }
  return async ({userId,method,path,body}) => {
    try {
      if (path === '/v1/library' && method === 'GET') {
        // Retry cleanup after a lost DELETE response or transient storage failure.
        const pending=Object.values(booksOf(await read(userId))).filter(b=>b.state==='deleted' && b.blob).slice(0,10);
        for (const deleted of pending) {
          try {
            await files.remove(deleted);
            await change(userId,books=>{ if(books[deleted.id]?.state==='deleted' && books[deleted.id]?.session===deleted.session) books[deleted.id]={id:deleted.id,state:'deleted',updatedAt:deleted.updatedAt}; });
          } catch { /* Keep the tombstone and retry at the next library refresh. */ }
        }
        const books=Object.values(booksOf(await read(userId)));
        return {status:200,data:{books:books.filter(b=>b.state !== 'uploading').map(exposed),quota,used:books.filter(b=>b.state==='ready').reduce((n,b)=>n+b.size,0),chunkSize:CHUNK_SIZE}};
      }
      const match=/^\/v1\/books\/([a-f0-9]{64})\/(upload|complete|download|file)$/.exec(path);
      if (!match) return {status:404,data:{error:'接口不存在'}};
      const [,id,operation]=match;
      if (!idPattern.test(id)) throw new ApiError(400,'书籍编号无效');
      if (operation === 'upload' && method === 'PUT') {
        const info=metadata(body,id); if (!info) throw new ApiError(400,'书籍信息或大小无效');
        const session=randomUUID(); const now=Date.now();
        const book=await change(userId,books=>{
          const current=books[id];
          if (current?.state === 'ready') return current;
          if (current?.state === 'deleted' && body.restore !== true) throw new ApiError(409,'这本书已从书库删除');
          if (current?.state==='deleted' && current.blob) throw new ApiError(409,'书籍正在删除，请稍后重新导入');
          const reserved=Object.values(books).filter(b=>b.id!==id && (b.state==='ready' || (b.state==='uploading' && b.expiresAt>now) || (b.state==='deleted' && b.blob))).reduce((n,b)=>n+b.size,0);
          if (reserved+info.size>quota) throw new ApiError(413,'书库空间已满');
          if (!current && Object.keys(books).length>=500) throw new ApiError(413,'书库书目数量已达上限');
          if (current?.state==='uploading' && current.expiresAt>now && current.size===info.size) return current;
          return books[id]={...info,state:'uploading',session,blob:`${userId}/${id}/${session}`,expiresAt:now+60*60*1000};
        });
        if (book.state==='ready') return {status:200,data:{book:exposed(book),ready:true}};
        return {status:200,data:{session:book.session,url:await files.authorize(book,'write'),chunkSize:CHUNK_SIZE}};
      }
      const book=booksOf(await read(userId))[id];
      if (book?.state==='deleted' && operation==='file' && method==='DELETE') { if (book.blob) { await files.remove(book); await change(userId,books=>{ if(books[id]?.state==='deleted' && books[id]?.session===book.session) books[id]={id,state:'deleted',updatedAt:book.updatedAt}; }); } return {status:200,data:{ok:true}}; }
      if (!book || book.state==='deleted') throw new ApiError(404,'书籍已不存在');
      if (operation==='complete' && method==='PUT') {
        if (body?.session !== book.session) throw new ApiError(409,'上传已过期，请重试');
        if (book.state==='ready') return {status:200,data:{book:exposed(book)}};
        if (book.expiresAt<Date.now()) throw new ApiError(409,'上传已过期，请重试');
        const blocks=Array.from({length:Math.ceil(book.size/CHUNK_SIZE)},(_,i)=>blockId(i));
        // Verify a frozen snapshot: an unexpired upload URL cannot mutate published content.
        const snapshot=await files.complete(book,blocks);
        const ready=await change(userId,books=>{
          const current=books[id];
          if (current?.session!==book.session || current.state==='deleted') throw new ApiError(409,'书籍状态已改变');
          if (current.state==='ready') return current;
          return books[id]={...book,state:'ready',snapshot,updatedAt:new Date().toISOString()};
        });
        return {status:200,data:{book:exposed(ready)}};
      }
      if (operation==='download' && method==='GET' && book.state==='ready') return {status:200,data:{url:await files.authorize(book,'read'),size:book.size,chunkSize:CHUNK_SIZE}};
      if (operation==='file' && method==='DELETE') {
        await change(userId,books=>{
          const current=books[id];
          if (current?.session!==book.session) throw new ApiError(409,'书籍刚刚更新，请刷新后重试');
          books[id]={id,blob:book.blob,size:book.size,session:book.session,state:'deleted',updatedAt:new Date().toISOString()};
        });
        // Deletion is durable before cleanup; retrying DELETE also retries storage cleanup.
        await files.remove(book);
        await change(userId,books=>{ if(books[id]?.state==='deleted' && books[id]?.session===book.session) books[id]={id,state:'deleted',updatedAt:books[id].updatedAt}; });
        return {status:200,data:{ok:true}};
      }
      throw new ApiError(405,'不支持此请求方法');
    } catch (error) { return {status:error.status || 503,data:{error:error.status ? error.message : '书库同步暂时不可用，请重试'}}; }
  };
}
