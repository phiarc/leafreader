import { createHash } from 'node:crypto';
import { createLibrary } from '../../library.mjs';
import { createService,tokenHash } from '../../service.mjs';
import { MemoryStore } from '../../stores.mjs';
const token='library-test-only-not-a-real-token-000000000000';
export function fixture(quota) {
  const store=new MemoryStore();const frozen=new Map();const chunks=new Map();let cleanupFails=false;
  const files={
    async authorize(book,access) { return `https://fixture.blob.core.windows.net/leaf-books/${book.blob}?sig=fixture&access=${access}${book.snapshot?'&snapshot='+book.snapshot:''}`; },
    async complete(book,blocks) {
      const value=Buffer.concat(blocks.map(key=>chunks.get(`${book.blob}/${key}`)||Buffer.alloc(0)));
      if(value.length!==book.size || createHash('sha256').update(value).digest('hex')!==book.id) {const error=new Error('文件校验失败');error.status=422;throw error;}
      const snapshot=String(frozen.size);frozen.set(`${book.blob}/${snapshot}`,value);return snapshot;
    },
    async remove(book) { if(cleanupFails) throw new Error('temporary cleanup failure');for(const key of frozen.keys())if(key.startsWith(book.blob+'/'))frozen.delete(key); }
  };
  const handle=createService(store,{tokenHash:tokenHash(token),userId:'owner',library:createLibrary(store,files,quota)});
  const request=(method,path,body,authorized=true)=>handle({method,path,body,authorization:authorized?`Bearer ${token}`:''});
  return {request,store,chunks,frozen,setCleanupFailure:value=>cleanupFails=value};
}
