import { nativeCall } from './bridge';
export interface ReaderChrome {
  title: string; chapter: string; format: 'txt' | 'pdf'; progress: number;
  encoding: string; zoom: number; visible: boolean; loading: boolean; gestureEnabled?: boolean;
}
export interface ChromeState {
  mode: 'library' | 'reader'; theme: string; fontSize: number; animation: string; pageMargin: number;
  bookCount: number; bookmarkCount: number; bookmarkView: boolean; search: string;
  syncState: string; busy: boolean; blocked: boolean; reader: ReaderChrome | null;
}
export interface ChromeAction { action: string; value?: unknown }
const actions = new Set(['back', 'library', 'bookmarks', 'settings', 'connection', 'import', 'sync', 'search', 'close',
  'contents', 'find', 'bookmark', 'seek', 'encoding', 'zoom', 'previous', 'next', 'preferences', 'preferencesVisible', 'controlsInteracting', 'activity']);
export function parseChromeAction(value: unknown): ChromeAction | undefined {
  if (!value || typeof value !== 'object') return;
  const action = (value as ChromeAction).action;
  if (typeof action !== 'string' || !actions.has(action)) return;
  return { action, value: (value as ChromeAction).value };
}
export const nativeChrome = window.__leafNativeChrome === true;
export const nativeChromePlatform = nativeChrome ? (window.__leafNativePlatform || (window.webkit?.messageHandlers.leaf ? 'macos' : 'harmony')) : 'none';
let timer: ReturnType<typeof setTimeout> | undefined;
export function publishChrome(state: ChromeState) {
  if (!nativeChrome && !window.LeafNative) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void nativeCall('updateChrome', { state }).catch(console.error); }, 16);
}
export function stopChromeUpdates() { clearTimeout(timer); }
