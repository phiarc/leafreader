import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { ChromeState } from '../bridge/ChromeState';
import { ImmersiveChrome } from '../components/ImmersiveChrome';
import { webview } from '@kit.ArkWeb';
import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { NativeBridge } from '../bridge/NativeBridge';
import { isLocalReaderUrl, localResourceResponse, LOCAL_READER_URL } from '../bridge/LocalResources';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  @State private chrome: ChromeState = new ChromeState();
  @State private nativeEnabled: boolean = false;
  @State private preferencesVisible: boolean = false;
  private bridge: NativeBridge = new NativeBridge(this.controller,
    (state: ChromeState) => { this.chrome = state; this.updateSystemBars(); }, () => { this.preferencesVisible = true; });

  private lastBarStyle: string = '';
  private themeBackground(): string {
    if (this.chrome.mode === 'reader') {
      return this.chrome.theme === 'night' ? '#242b26' : this.chrome.theme === 'sepia' ? '#f4ecd9' : '#f9f8f4';
    }
    return this.chrome.theme === 'night' ? '#222725' : this.chrome.theme === 'sepia' ? '#f0e8d8' : '#f7f6f2';
  }
  private updateSystemBars(): void {
    const style = `${this.chrome.mode}/${this.chrome.theme}`;
    if (this.lastBarStyle === style) return;
    this.lastBarStyle = style;
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const ink = this.chrome.theme === 'night' ? '#d5ddce' : '#343a32';
    const background = this.themeBackground();
    window.getLastWindow(context).then((main: window.Window) => {
      try { main.setWindowBackgroundColor(background); } catch (_) {}
      main.setWindowSystemBarProperties({ statusBarColor: background, navigationBarColor: background, statusBarContentColor: ink, navigationBarContentColor: ink }).catch(() => {});
    }).catch(() => {});
  }
  aboutToAppear(): void { this.nativeEnabled = typeof deviceInfo.apiAvailable === 'function' && deviceInfo.apiAvailable('26.0.0'); }
  onBackPress(): boolean {
    if (this.preferencesVisible) { this.preferencesVisible = false; return true; }
    if (this.nativeEnabled && this.chrome.mode === 'reader' && !this.chrome.blocked) {
      this.bridge.sendAction('back'); return true;
    }
    return false;
  }
  @State private loadError: string = '';

  private checkPage(): void {
    this.controller.runJavaScript("Boolean(document.querySelector('#app .app-shell'))")
      .then((result: string) => {
        this.loadError = result === 'true' ? '' : '阅读界面未能启动，请点下方按钮重试。';
      })
      .catch(() => { this.loadError = '阅读界面加载失败，请重试。'; });
  }

  @Builder private webSurface() {
    Web({ src: LOCAL_READER_URL, controller: this.controller })
      .javaScriptOnDocumentStart([{ script: this.nativeEnabled ?
        "window.__leafNativeChrome=true;window.__leafNativePlatform='harmony';" : '',
        scriptRules: ['https://leaf-reader.invalid'] }])
      .javaScriptAccess(true)
      .domStorageAccess(true)
      .databaseAccess(true)
      .fileAccess(true)
      .onInterceptRequest((event) => {
        if (!event) return null;
        return localResourceResponse(event.request.getRequestUrl());
      })
      .onPageEnd(() => this.checkPage())
      .onErrorReceive((event) => {
        if (event?.request.isMainFrame()) this.loadError = '本机阅读资源加载失败，请重试。';
      })
      .javaScriptProxy({ object: this.bridge, name: 'LeafNative', methodList: ['postMessage'], controller: this.controller })
      .onShowFileSelector((event) => {
        if (!event) return false;
        const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
        const documentPicker = new picker.DocumentViewPicker(context);
        documentPicker.select({ maxSelectNumber: 10, fileSuffixFilters: ['电子书|.txt,.pdf'] })
          .then((uris: string[]) => event.result.handleFileList(uris))
          .catch(() => event.result.handleFileList([]));
        return true;
      })
      .onOverrideUrlLoading((request) => {
        const url = request.getRequestUrl();
        return !isLocalReaderUrl(url) && url !== 'about:blank';
      })
      .width('100%')
      .height('100%')
  }

  build() {
    Stack() {
      Rect().width('100%').height('100%').fill(this.themeBackground()).hitTestBehavior(HitTestMode.None)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      if (this.nativeEnabled) {
        ImmersiveChrome({ state: this.chrome, preferencesVisible: $preferencesVisible,
          content: () => { this.webSurface(); }, onAction: (action: string, value: Object | null) => this.bridge.sendAction(action, value) })
      } else { this.webSurface() }
      if (this.loadError) {
        Column({ space: 18 }) {
          Text('暂时无法打开书架').fontSize(20).fontColor('#52664d')
          Text(this.loadError).fontSize(14).fontColor('#727b68').textAlign(TextAlign.Center)
          Button('重新加载').backgroundColor('#52664d').onClick(() => {
            this.loadError = '';
            this.controller.refresh();
          })
        }
        .padding(30)
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#f7f6f2')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.themeBackground())
  }
}
