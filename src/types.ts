export type Locator = { type: 'txt'; offset: number } | { type: 'pdf'; page: number; y: number };
export interface Bookmark { id: string; locator: Locator; label: string; createdAt: string }
export interface Book {
  id: string; title: string; fileName: string; format: 'txt' | 'pdf'; size: number;
  importedAt: string; openedAt?: string; color: number; encoding?: string;
  locator: Locator; progress: number; revision: number; dirty: boolean;
  cloudAvailable?: boolean; restoreCloud?: boolean; localOnly?: boolean; cloudRemoved?: boolean; pendingOperationId?: string; missingFile?: boolean; content: Blob; bookmarks: Bookmark[];
}
export interface Chapter { title: string; offset: number }
export interface SyncConfig { endpoint: string; token: string }
export interface RemoteProgress { bookId: string; locator: Locator; progress: number; revision: number; updatedAt: string; deviceId: string; operationId: string }
export interface Conflict { bookId: string; local: Book; remote: RemoteProgress }
