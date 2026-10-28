import { deviceInfo } from '@kit.BasicServicesKit';
import { uiMaterial } from '@kit.ArkUI';
import { ChromeState, PreferencesValue } from '../bridge/ChromeState';

@Component
export struct ImmersiveChrome {
  @Prop @Watch('stateChanged') state: ChromeState = new ChromeState();
  @Link preferencesVisible: boolean;
  @BuilderParam content: () => void = this.emptyContent;
  onAction: (action: string, value: Object | null) => void = () => {};
  @State private supported: boolean = false;
  @State private selectedTab: number = 0;
  @State private dragging: boolean = false;
  @State private dragProgress: number = 0;
  private immersive: uiMaterial.ImmersiveMaterial | undefined = undefined;

  aboutToAppear(): void {
    try {
      this.supported = deviceInfo.apiAvailable('26.0.0') && uiMaterial.isImmersiveMaterialSupported();
      if (this.supported) {
        this.immersive = new uiMaterial.ImmersiveMaterial({
          style: uiMaterial.ImmersiveStyle.REGULAR, interactive: true, applyShadow: true
        });
      }
    } catch (_) { this.supported = false; }
    this.stateChanged();
  }
  private stateChanged(): void {
    this.selectedTab = this.state.bookmarkView ? 1 : 0;
    if (!this.dragging) this.dragProgress = Math.min(1, Math.max(0, this.state.reader?.progress ?? 0)) * 1000;
  }
  private reading(): boolean { return this.state.mode === 'reader'; }
  private visible(): boolean { return !this.state.blocked && (!this.reading() || this.state.reader?.visible === true); }
  private ink(): string { return this.state.theme === 'night' ? '#d5ddce' : '#343a32'; }
  private muted(): string { return this.state.theme === 'night' ? '#a6b4a2' : '#727b68'; }
  private panel(): string { return this.state.theme === 'night' ? '#ed2b322d' : this.state.theme === 'sepia' ? '#edf7efdf' : '#edfffefa'; }
  private material(): uiMaterial.ImmersiveMaterial | undefined { return this.supported ? this.immersive : undefined; }
  private action(name: string, value: Object | null = null): void {
    this.onAction(name, value); this.onAction('activity', null);
  }
  private openPreferences(): void { this.preferencesVisible = true; }
  private preferences(theme: string = this.state.theme, font: number = this.state.fontSize, animation: string = this.state.animation): void {
    const value = new PreferencesValue(); value.theme = theme; value.fontSize = font; value.animation = animation;
    this.action('preferences', value);
  }
  private track(active: boolean): void { this.dragging = active; this.onAction('controlsInteracting', active); }
  private progressChanged(value: number, mode: SliderChangeMode): void {
    this.dragProgress = value;
    if (mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving) this.track(true);
    if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
      this.action('seek', Math.min(1, Math.max(0, value / 1000))); this.track(false);
    }
  }
  private readerMenu(): MenuElement[] {
    if (this.state.reader?.format === 'pdf') {
      return [
        { value: '适合页面', action: () => this.action('zoom', 1) },
        { value: '150%', action: () => this.action('zoom', 1.5) },
        { value: '200%', action: () => this.action('zoom', 2) }
      ];
    }
    return [
      { value: '自动', action: () => this.action('encoding', 'auto') },
      { value: 'UTF-8', action: () => this.action('encoding', 'utf-8') },
      { value: 'GB18030', action: () => this.action('encoding', 'gb18030') },
      { value: 'UTF-16 LE', action: () => this.action('encoding', 'utf-16le') },
      { value: 'Big5', action: () => this.action('encoding', 'big5') }
    ];
  }
  @Builder private emptyContent() {}
  @Builder private icon(name: string) {
    Image($rawfile(`chrome/${name}${this.state.theme === 'night' ? '_night' : ''}.svg`)).width(21).height(21)
  }
  @Builder private iconButton(name: string, label: string, action: string) {
    Button({ type: ButtonType.Circle }) { this.icon(name) }
      .width(36).height(36).backgroundColor(Color.Transparent).accessibilityText(label)
      .onClick(() => this.action(action))
  }
  @Builder private header() {
    Row({ space: 6 }) {
      if (this.reading()) {
        this.iconButton('back', '返回', 'back')
        Column({ space: 3 }) {
          Text(this.state.reader?.title ?? '').fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.ink()).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.state.reader?.chapter ?? '').fontSize(10).fontColor(this.muted()).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        this.iconButton('list', '目录与书签', 'contents')
        this.iconButton('search', '搜索正文', 'find')
        this.iconButton('bookmark', '添加书签', 'bookmark')
        Button({ type: ButtonType.Circle }) { this.icon('settings') }
          .width(36).height(36).backgroundColor(Color.Transparent).accessibilityText('阅读偏好')
          .onClick(() => this.openPreferences())
      } else {
        Image($r('app.media.app_icon')).width(36).height(36).borderRadius(9).accessibilityText('页间标志')
        Text('页间').fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.ink())
        Search({ value: this.state.search, placeholder: '寻找一本书…' }).layoutWeight(1).height(36)
          .onChange((value: string) => this.action('search', value))
        this.iconButton('plus', '导入书籍', 'import')
        Button({ type: ButtonType.Circle }) { this.icon('more') }
          .width(36).height(36).backgroundColor(Color.Transparent).accessibilityText('更多操作')
          .bindMenu([
            { value: '同步书库', action: () => this.action('sync') },
            { value: '阅读偏好', action: () => this.openPreferences() },
            { value: '阅读空间', action: () => this.action('connection') }
          ])
      }
    }.padding({ left: 12, right: 12 }).height(64).width('100%')
  }
  @Builder private libraryTab(name: string, title: string, count: number, selected: boolean) {
    Column({ space: 3 }) {
      this.icon(name)
      Text(`${title} ${count}`).fontSize(11).fontWeight(selected ? FontWeight.Medium : FontWeight.Regular).fontColor(this.ink())
    }.height(56).width('100%').justifyContent(FlexAlign.Center).accessibilityText(title)
  }
  @Builder private progressControls() {
    if (deviceInfo.apiAvailable('26.0.0')) {
      Row({ space: 5 }) {
        this.iconButton('back', '上一页', 'previous')
        Slider({ value: this.dragProgress, min: 0, max: 1000, step: 1 }).layoutWeight(1)
          .systemMaterial(this.material()).selectedColor('#708365').accessibilityText('阅读进度')
          .onChange((value: number, mode: SliderChangeMode) => this.progressChanged(value, mode))
          .onTouch((event: TouchEvent) => { if (event.type === TouchType.Cancel) { this.track(false); this.stateChanged(); } })
        Text(`${Math.round(this.dragProgress / 10)}%`).fontSize(11).fontColor(this.muted()).width(36)
        this.iconButton('next', '下一页', 'next')
      }.padding({ left: 6, right: 6 }).height(64).width('100%').enabled(this.state.reader?.loading !== true)
    }
  }
  @Builder private bottomBar() {
    if (deviceInfo.apiAvailable('26.0.0')) {
      if (this.visible()) {
        if (this.reading()) {
          Column() { this.progressControls() }
            .width('94%').height(64).constraintSize({ maxWidth: 620 }).borderRadius(32)
            .backgroundColor(this.panel()).systemMaterial(this.material()).margin({ bottom: 12 })
        } else {
          Tabs({ barPosition: BarPosition.End, index: this.selectedTab }) {
            TabContent() {}.tabBar(this.libraryTab('books', '我的书架', this.state.bookCount, !this.state.bookmarkView))
            TabContent() {}.tabBar(this.libraryTab('bookmark', '我的书签', this.state.bookmarkCount, this.state.bookmarkView))
          }.scrollable(false).barHeight(64).barOverlap(true).barBackgroundColor(this.panel())
            .barFloatingStyle({ barSideMargin: 16, barBottomMargin: 8, maskHeight: 0, systemMaterial: this.material() })
            .onChange((index: number) => { if (index !== (this.state.bookmarkView ? 1 : 0)) this.action(index === 1 ? 'bookmarks' : 'library'); })
            .backgroundColor(Color.Transparent).height(84).width('100%').constraintSize({ maxWidth: 640 })
        }
      }
    }
  }
  @Builder private preferencesSheet() {
    if (deviceInfo.apiAvailable('26.0.0')) {
      Column({ space: 20 }) {
        Row() {
          Text('阅读偏好').fontSize(22).fontWeight(FontWeight.Medium).fontColor(this.ink()).layoutWeight(1)
          Button('完成').fontSize(14).onClick(() => { this.preferencesVisible = false; })
        }.width('100%')
        Text('书页主题').fontSize(13).fontColor(this.muted()).width('100%')
        Row({ space: 12 }) {
          ForEach(['纸白', '暖纸', '夜色'], (label: string, index: number) => {
            Button(label).layoutWeight(1).height(42)
              .backgroundColor(this.state.theme === ['paper', 'sepia', 'night'][index] ? '#708365' : Color.Transparent)
              .fontColor(this.state.theme === ['paper', 'sepia', 'night'][index] ? Color.White : this.ink())
              .onClick(() => this.preferences(['paper', 'sepia', 'night'][index]))
          })
        }.width('100%')
        Text(`正文字号 · ${this.state.fontSize}`).fontSize(13).fontColor(this.muted()).width('100%')
        Slider({ value: this.state.fontSize, min: 15, max: 32, step: 1 }).width('100%').systemMaterial(this.material())
          .onChange((value: number) => this.preferences(this.state.theme, value))
        if (this.reading()) {
          Row() {
            Text(this.state.reader?.format === 'pdf' ? '页面缩放' : '文字显示').fontSize(13).fontColor(this.muted()).layoutWeight(1)
            Button(this.state.reader?.format === 'pdf' ? '调整缩放' : '调整文字编码').fontSize(13).fontColor(this.ink())
              .backgroundColor(Color.Transparent).bindMenu(this.readerMenu(), { systemMaterial: this.material() })
          }.width('100%')
        }
        Row() {
          Text('翻页方式').fontSize(13).fontColor(this.muted()).layoutWeight(1)
          Select([{ value: '轻盈滑动' }, { value: '覆盖翻页' }, { value: '书页翻转' }, { value: '直接翻页' }])
            .selected(Math.max(0, ['slide', 'cover', 'flip', 'none'].indexOf(this.state.animation)))
            .value(['轻盈滑动', '覆盖翻页', '书页翻转', '直接翻页'][Math.max(0, ['slide', 'cover', 'flip', 'none'].indexOf(this.state.animation))])
            .systemMaterial(this.material()).menuSystemMaterial(this.material())
            .onSelect((index: number) => this.preferences(this.state.theme, this.state.fontSize, ['slide', 'cover', 'flip', 'none'][index]))
        }.width('100%')
      }.padding(24).width('100%')
    }
  }
  build() {
    if (deviceInfo.apiAvailable('26.0.0')) {
      WithTheme({ colorMode: this.state.theme === 'night' ? ThemeColorMode.DARK : ThemeColorMode.LIGHT }) {
        Stack({ alignContent: Alignment.Bottom }) {
          Navigation() { this.content() }
            .mode(NavigationMode.Stack).hideBackButton(true).hideToolBar(true)
            .title({ builder: this.header, height: 64 }, { barStyle: BarStyle.STACK, backgroundColor: this.panel(), systemMaterial: this.material() })
            .hideTitleBar(!this.visible(), true).width('100%').height('100%')
          this.bottomBar()
        }.width('100%').height('100%')
          .bindSheet($$this.preferencesVisible, this.preferencesSheet, {
            height: 480, showClose: false, dragBar: true, systemMaterial: this.material(),
            onAppear: () => this.onAction('preferencesVisible', true),
            onDisappear: () => { this.preferencesVisible = false; this.onAction('preferencesVisible', false); }
          })
      }
    }
  }

}
