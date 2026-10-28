import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
export class MemoryStore {
  constructor() { this.records = new Map(); }
  async read(user, book) { const value = this.records.get(`${user}/${book}`); return value ? structuredClone(value) : null; }
  async compareAndSwap(user, book, etag, doc) {
    const key = `${user}/${book}`; const current = this.records.get(key);
    if (current?.etag !== etag) return false;
    this.records.set(key, { doc:structuredClone(doc), etag:String(Number(current?.etag || 0) + 1) }); return true;
  }
}
export class FileStore extends MemoryStore {
  constructor(directory) { super(); this.directory = directory; this.queue = Promise.resolve(); }
  async load() {
    await mkdir(this.directory, {recursive:true, mode:0o700});
    try { this.records = new Map(JSON.parse(await readFile(join(this.directory,'progress.json'),'utf8'))); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
    return this;
  }
  compareAndSwap(user, book, etag, doc) {
    const result = this.queue.then(async () => {
      const saved = await super.compareAndSwap(user,book,etag,doc); if (!saved) return false;
      const target = join(this.directory,'progress.json'); const temp = `${target}.tmp`;
      await writeFile(temp, JSON.stringify([...this.records]), {mode:0o600}); await rename(temp,target); return true;
    });
    this.queue = result.catch(() => {}); return result;
  }
}
