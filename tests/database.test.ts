import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseOpener } from '../src/core/database';
function harness() {
  const requests: any[] = []; let invalidations = 0;
  const open = createDatabaseOpener(() => { const request: any = {}; requests.push(request); return request; }, () => invalidations++);
  return { open, requests, invalidations: () => invalidations };
}
test('a failed database open is retried instead of caching its rejection', async () => {
  const h = harness(); const first = h.open();
  h.requests[0].error = new Error('temporary'); h.requests[0].onerror();
  await assert.rejects(first, /temporary/);
  const second = h.open(); assert.equal(h.requests.length, 2);
  const connection = { close() {} }; h.requests[1].result = connection; h.requests[1].onsuccess();
  assert.equal(await second, connection); assert.equal(h.open(), second);
});
test('blocked requests close late connections and cannot replace a successful retry', async () => {
  const h = harness(); const first = h.open(); h.requests[0].onblocked(); await assert.rejects(first, /关闭其他/);
  const second = h.open(); let closed = false;
  h.requests[0].result = { close() { closed = true; } }; h.requests[0].onsuccess(); assert.equal(closed, true);
  const connection = { close() {} }; h.requests[1].result = connection; h.requests[1].onsuccess();
  assert.equal(await second, connection); assert.equal(h.open(), second);
});
test('version changes close the connection and invalidate the cached handle', async () => {
  const h = harness(); const first = h.open(); let closed = false;
  const connection: any = { close() { closed = true; } }; h.requests[0].result = connection; h.requests[0].onsuccess(); await first;
  connection.onversionchange(); assert.equal(closed, true); assert.equal(h.invalidations(), 1);
  const next = h.open(); assert.equal(h.requests.length, 2);
  h.requests[1].result = { close() {} }; h.requests[1].onsuccess(); await next;
});
