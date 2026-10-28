import { toRaw } from 'vue';
import { cloudRequest, getToken } from './bridge';
import { cloneBook, deviceId, saveBook } from './storage';
import type { Book, Conflict, RemoteProgress } from './types';
export async function syncBooks(books: Book[], endpoint: string, suspended: ReadonlySet<string> = new Set()): Promise<{ updated: Book[]; conflicts: Conflict[] }> {
  const token = await getToken();
  if (!endpoint || !token) throw new Error('请先连接同步空间');
  const updated: Book[] = []; const conflicts: Conflict[] = [];
  for (const entry of books) {
    if (entry.cloudRemoved || suspended.has(entry.id) || (entry.missingFile && !entry.cloudAvailable)) continue;
    const book = cloneBook(entry);
    const path = `/v1/books/${encodeURIComponent(book.id)}/progress`;
    if (book.dirty) {
      book.pendingOperationId ||= crypto.randomUUID();
      await saveBook(book);
      const response = await cloudRequest(endpoint, token, 'PUT', path, {
        locatorVersion: 1, locator: book.locator, progress: book.progress,
        baseRevision: book.revision, deviceId: deviceId(), operationId: book.pendingOperationId
      });
      if (response.status === 409) { conflicts.push({ bookId: book.id, local: book, remote: response.data.current }); continue; }
      if (response.status !== 200) throw new Error(response.data.error || `同步失败（${response.status}）`);
      // Mark clean only if the local reader did not move while the request was in flight.
      updated.push({ ...book, revision: response.data.revision, dirty: false, pendingOperationId: undefined });
    } else {
      const response = await cloudRequest(endpoint, token, 'GET', path);
      if (response.status === 404) continue;
      if (response.status !== 200) throw new Error(response.data.error || `同步失败（${response.status}）`);
      const remote: RemoteProgress = response.data;
      if (remote.revision > book.revision) {
        const changed = JSON.stringify(remote.locator) !== JSON.stringify(book.locator);
        if (changed && book.missingFile && book.cloudAvailable) updated.push({ ...book, locator:remote.locator, progress:remote.progress, revision:remote.revision });
        else if (changed) conflicts.push({ bookId: book.id, local: book, remote });
        else updated.push({ ...book, revision: remote.revision });
      }
    }
  }
  return { updated, conflicts };
}
