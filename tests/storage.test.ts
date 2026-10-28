import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import type { Book } from '../src/types';
Object.assign(globalThis,{indexedDB});
const original:Book={id:'f'.repeat(64),title:'迁移测试',fileName:'迁移测试.txt',format:'txt',size:12,importedAt:'2026-10-27T00:00:00.000Z',color:0,locator:{type:'txt',offset:2},progress:.2,revision:3,dirty:true,content:new Blob(['保留原始正文']),bookmarks:[{id:'bookmark-001',locator:{type:'txt',offset:1},label:'保留书签',createdAt:'2026-10-27T00:00:00.000Z'}]};
await new Promise<void>((resolve,reject)=>{
  const request=indexedDB.open('leaf-reader',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('books',{keyPath:'id'});
  request.onsuccess=()=>{const database=request.result;const tx=database.transaction('books','readwrite');tx.objectStore('books').put(original);tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
});
const storage=await import('../src/storage');
test('v1 book migration preserves its original bytes, position, bookmarks and cloud revision',async()=>{
  const books=await storage.listBooks();assert.equal(books.length,1);assert.equal(await books[0].content.text(),'保留原始正文');assert.deepEqual(books[0].locator,{type:'txt',offset:2});assert.equal(books[0].revision,3);assert.equal(books[0].bookmarks[0].label,'保留书签');
});
test('progress-only updates preserve file bytes and keep binary data out of book metadata',async()=>{
  const [book]=await storage.listBooks();await storage.saveBook({...book,locator:{type:'txt',offset:5},progress:.5});const [saved]=await storage.listBooks();assert.deepEqual(saved.locator,{type:'txt',offset:5});assert.equal(await saved.content.text(),'保留原始正文');
  const meta=await new Promise<any>((resolve,reject)=>{const open=indexedDB.open('leaf-reader',2);open.onsuccess=()=>{const database=open.result;const request=database.transaction('books').objectStore('books').get(book.id);request.onsuccess=()=>{resolve(request.result);database.close();};request.onerror=()=>reject(request.error);};});assert.equal(meta.content,undefined);assert.equal(meta.bookmarks.length,1);
});
test('one missing file leaves other books accessible and reimport restores its metadata', async () => {
  const healthy = {...original, id: 'e'.repeat(64), title: '完好书籍'};
  await storage.saveBook(healthy);
  const [saved] = (await storage.listBooks()).filter(b => b.id === original.id);
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('leaf-reader', 2);
    open.onsuccess = () => { const database = open.result; const tx = database.transaction('files', 'readwrite'); tx.objectStore('files').delete(original.id); tx.oncomplete = () => { database.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  });
  const books = await storage.listBooks();
  assert.equal(books.length, 2); assert.equal(books.find(b => b.id === healthy.id)?.missingFile, false);
  const missing = books.find(b => b.id === original.id)!; assert.equal(missing.missingFile, true);
  await storage.saveBook(missing); // metadata-only writes must never create a fake empty file
  assert.equal((await storage.listBooks()).find(b => b.id === original.id)?.missingFile, true);
  await storage.saveBook({...missing, content: original.content, missingFile: false});
  const restored = (await storage.listBooks()).find(b => b.id === original.id)!;
  assert.equal(restored.missingFile, false); assert.equal(await restored.content.text(), await original.content.text());
  assert.deepEqual(restored.locator, saved.locator); assert.deepEqual(restored.bookmarks, saved.bookmarks); assert.equal(restored.revision, saved.revision);
});
