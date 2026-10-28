type Reply = { id: string; result?: unknown; error?: string };
declare global {
  interface Window {
    webkit?: { messageHandlers: { leaf?: { postMessage: (message: string) => void } } };
    LeafNative?: { postMessage: (message: string) => void };
    __leafTrackpadPhases?: boolean;
    __leafNativeChrome?: boolean;
    __leafNativePlatform?: 'macos' | 'harmony';
    __leafReply?: (reply: Reply) => void;
  }
}
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
window.__leafReply = reply => {
  const item = pending.get(reply.id); if (!item) return;
  clearTimeout(item.timer); pending.delete(reply.id);
  reply.error ? item.reject(new Error(reply.error)) : item.resolve(reply.result);
};
export function hasNative() { return !!(window.webkit?.messageHandlers.leaf || window.LeafNative); }
export function nativeCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('系统操作超时，请重试')); }, 60000);
    pending.set(id, { resolve, reject, timer });
    const message = JSON.stringify({ id, method, args });
    if (window.webkit?.messageHandlers.leaf) window.webkit.messageHandlers.leaf.postMessage(message);
    else if (window.LeafNative) window.LeafNative.postMessage(message);
    else { clearTimeout(timer); pending.delete(id); reject(new Error('此功能需要原生客户端')); }
  });
}
export async function getToken(): Promise<string> {
  return hasNative() ? nativeCall<string>('getSecret') : sessionStorage.getItem('leaf-sync-token') || '';
}
export async function setToken(token: string): Promise<void> {
  if (hasNative()) await nativeCall('setSecret', { token }); else sessionStorage.setItem('leaf-sync-token', token);
}
export async function cloudRequest(endpoint: string, token: string, method: string, path: string, body?: unknown) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('同步地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('同步地址不能包含账号、查询参数或片段');
  if (hasNative()) return nativeCall<{ status: number; data: any }>('cloudRequest', { endpoint, token, method, path, body: body ?? null });
  const response = await fetch(`${endpoint.replace(/\/$/, '')}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  return { status: response.status, data: await response.json() };
}
