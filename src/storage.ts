import { toRaw } from 'vue';
import type { Book } from './types';
import { createDatabaseOpener } from './core/database';
const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const knownFiles = new Set<string>();
// Keep large binary files out of Vue/structuredClone and progress-only writes.
export function cloneBook(book: Book): Book {
  const { content, ...metadata } = toRaw(book);
  return { ...JSON.parse(JSON.stringify(metadata)), content } as Book;
}
const db = createDatabaseOpener(() => {
    const r = indexedDB.open('leaf-reader', 2);
    r.onupgradeneeded = () => {
      const database = r.result;
      if (!database.objectStoreNames.contains('books')) database.createObjectStore('books', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('files')) database.createObjectStore('files', { keyPath: 'id' });
      const books = r.transaction!.objectStore('books'); const files = r.transaction!.objectStore('files');
      const cursor = books.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result; if (!item) return;
        const { content, ...metadata } = item.value;
        if (content) { files.put({ id: metadata.id, content }); item.update(metadata); }
        item.continue();
      };
    };
    return r;
}, () => knownFiles.clear());
export async function listBooks(): Promise<Book[]> {
  const database = await db(); const tx = database.transaction(['books', 'files']);
  const [metadata, records] = await Promise.all([request(tx.objectStore('books').getAll()), request(tx.objectStore('files').getAll())]);
  const files = new Map<string, Blob>();
  knownFiles.clear();
  for (const record of records) {
    if (!(record.content instanceof Blob) && !(record.content instanceof ArrayBuffer)) continue;
    const content = record.content instanceof Blob ? record.content : new Blob([record.content]);
    if (!content.size) continue;
    files.set(record.id, content); knownFiles.add(record.id);
  }
  return metadata.map(item => { const content = files.get(item.id); return { ...item, content: content || new Blob(), missingFile: !content } as Book; });
}
export async function saveBook(book: Book): Promise<void> {
  const database = await db();
  const { content, missingFile, ...metadata } = cloneBook(book);
  const bytes = missingFile || knownFiles.has(book.id) ? undefined : await content.arrayBuffer();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['books', 'files'], 'readwrite');
    if (bytes) tx.objectStore('files').put({ id: book.id, content: bytes });
    tx.objectStore('books').put(metadata);
    tx.oncomplete = () => { if (!missingFile) knownFiles.add(book.id); resolve(); };
    tx.onerror = () => reject(tx.error || new Error('本机数据库写入失败'));
    tx.onabort = () => reject(tx.error || new Error('本机数据库写入已中止'));
  });
}
export async function removeBook(id: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['books', 'files'], 'readwrite'); tx.objectStore('books').delete(id); tx.objectStore('files').delete(id);
    tx.oncomplete = () => { knownFiles.delete(id); resolve(); }; tx.onerror = () => reject(tx.error);
  });
}
export async function fileHash(bytes: ArrayBuffer) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''); }
export function deviceId(): string { let id = localStorage.getItem('leaf-device'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('leaf-device', id); } return id; }

export async function removeDownload(id: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('files', 'readwrite'); tx.objectStore('files').delete(id);
    tx.oncomplete = () => { knownFiles.delete(id); resolve(); }; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
