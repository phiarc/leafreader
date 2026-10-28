import { ChromeState, ChromeAction } from './ChromeState';
import { isLocalReaderUrl } from './LocalResources';
import { webview } from '@kit.ArkWeb';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

class BridgeArgs {
  url: string = '';
  data: string = '';
  start: number = 0;
  length: number = 0;
  state: ChromeState | null = null;
  token: string = '';
  endpoint: string = '';
  method: string = '';
  path: string = '';
  body: Object | null = null;
}
class BridgeRequest {
  id: string = '';
  method: string = '';
  args: BridgeArgs = new BridgeArgs();
}

export class NativeBridge {
  private controller: webview.WebviewController;
  private alias: Uint8Array = new util.TextEncoder().encodeInto('leaf-personal-space');
  private onChrome: (state: ChromeState) => void;
  private onPreferences: () => void;
  constructor(controller: webview.WebviewController,
    onChrome: (state: ChromeState) => void = () => {},
    onPreferences: () => void = () => {}) {
    this.controller = controller; this.onChrome = onChrome; this.onPreferences = onPreferences;
  }

  sendAction(action: string, value: Object | null = null): void {
    const payload = new ChromeAction(); payload.action = action; payload.value = value;
    this.controller.runJavaScript(`window.dispatchEvent(new CustomEvent('leaf-native-action', {detail:${JSON.stringify(payload)}}))`).catch(() => {});
  }

  postMessage(message: string): void {
    try {
      if (!isLocalReaderUrl(this.controller.getUrl())) return;
      const request = JSON.parse(message) as BridgeRequest;
      if (!request.id || request.id.length > 100) return;
      this.handle(request).catch((error: BusinessError) => this.reply(request.id, '', error.message || '系统操作失败'));
    } catch (_) { /* Ignore malformed messages from the packaged page. */ }
  }

  private reply(id: string, resultJson: string, error: string = ''): void {
    const payload = error ? `{"id":${JSON.stringify(id)},"error":${JSON.stringify(error)}}` : `{"id":${JSON.stringify(id)},"result":${resultJson}}`;
    this.controller.runJavaScript(`window.__leafReply(${payload})`).catch(() => {});
  }

  private async handle(request: BridgeRequest): Promise<void> {
    if (request.method === 'updateChrome') {
      const state = request.args.state;
      if (!state || (state.mode !== 'library' && state.mode !== 'reader') ||
        !['paper', 'sepia', 'night'].includes(state.theme) || typeof state.blocked !== 'boolean') {
        this.reply(request.id, '', '界面状态无效'); return;
      }
      this.onChrome(state); this.reply(request.id, 'true'); return;
    }
    if (request.method === 'showPreferences') { this.onPreferences(); this.reply(request.id, 'true'); return; }
    if (request.method === 'getSecret') {
      const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.alias); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      let token: string = '';
      try {
        const values = await asset.query(query);
        if (values.length > 0) { const bytes = values[0].get(asset.Tag.SECRET) as Uint8Array; token = new util.TextDecoder().decodeToString(bytes); }
      } catch (error) { if ((error as BusinessError).code !== 24000002) throw new Error((error as BusinessError).message); }
      this.reply(request.id, JSON.stringify(token)); return;
    }
    if (request.method === 'setSecret') {
      const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.alias);
      if (!request.args.token) {
        try { await asset.remove(query); } catch (error) { if ((error as BusinessError).code !== 24000002) throw new Error((error as BusinessError).message); }
      } else {
        const values: asset.AssetMap = new Map(); values.set(asset.Tag.ALIAS, this.alias);
        values.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(request.args.token));
        values.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
        values.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
        await asset.add(values);
      }
      this.reply(request.id, 'true'); return;
    }
    if (request.method === 'blobTransfer') { await this.blobTransfer(request); return; }
    if (request.method === 'cloudRequest') { await this.cloudRequest(request); return; }
    this.reply(request.id, '', '未知的系统请求');
  }

  private async blobTransfer(request: BridgeRequest): Promise<void> {
    const args = request.args;
    if (!/^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/leaf-books\/[A-Za-z0-9/_-]+\?[^#]+$/.test(args.url) ||
      !/[?&]sig=/.test(args.url) || !['GET', 'PUT'].includes(args.method)) throw new Error('文件传输地址无效');
    const base64 = new util.Base64Helper();
    const client = http.createHttp();
    try {
      if (args.method === 'PUT') {
        if (args.data.length > 349528 || !/[?&]comp=block(?:&|$)/.test(args.url)) throw new Error('上传分块无效');
        const bytes = base64.decodeSync(args.data);
        if (!bytes.length || bytes.length > 262144) throw new Error('上传分块无效');
        const result = await client.request(args.url, { method: http.RequestMethod.PUT,
          header: { 'Content-Type': 'application/octet-stream', 'x-ms-version': '2023-11-03' }, extraData: bytes.buffer,
          connectTimeout: 10000, readTimeout: 45000, usingCache: false, maxRedirects: 0 });
        this.reply(request.id, JSON.stringify({ status: result.responseCode, data: '' }));
      } else {
        if (!Number.isInteger(args.start) || args.start < 0 || args.start > 104857600 || !Number.isInteger(args.length) || args.length <= 0 || args.length > 262144) throw new Error('下载分块无效');
        const result = await client.request(args.url, { method: http.RequestMethod.GET,
          header: { 'Range': `bytes=${args.start}-${args.start + args.length - 1}`, 'x-ms-version': '2023-11-03' },
          expectDataType: http.HttpDataType.ARRAY_BUFFER, maxLimit: 262144,
          connectTimeout: 10000, readTimeout: 45000, usingCache: false, maxRedirects: 0 });
        const bytes = new Uint8Array(result.result as ArrayBuffer);
        this.reply(request.id, JSON.stringify({ status: result.responseCode, data: result.responseCode === 206 ? base64.encodeToStringSync(bytes) : '' }));
      }
    } finally { client.destroy(); }
  }

  private async cloudRequest(request: BridgeRequest): Promise<void> {
    const args = request.args;
    // A native network request avoids granting arbitrary origins access to cloud credentials.
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:\/[A-Za-z0-9/_-]*)?$/.test(args.endpoint) ||
      !/^\/v1\/[A-Za-z0-9/_-]+$/.test(args.path) || !['GET', 'PUT', 'DELETE'].includes(args.method)) {
      this.reply(request.id, '', '同步地址或请求无效'); return;
    }
    const client = http.createHttp();
    try {
      const result = await client.request(args.endpoint.replace(/\/$/, '') + args.path, {
        method: args.method === 'GET' ? http.RequestMethod.GET : args.method === 'DELETE' ? http.RequestMethod.DELETE : http.RequestMethod.PUT,
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${args.token}` },
        extraData: args.method === 'PUT' ? JSON.stringify(args.body) : '',
        connectTimeout: 10000, readTimeout: 20000,
        usingCache: false, maxRedirects: 0
      });
      const data = result.result as string;
      // Validate before inserting the response as a JavaScript JSON value.
      const parsed = JSON.parse(data) as Object;
      this.reply(request.id, `{"status":${result.responseCode},"data":${JSON.stringify(parsed)}}`);
    } finally { client.destroy(); }
  }
}
