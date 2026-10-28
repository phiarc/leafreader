# 0.1.4：macOS 原生 Liquid Glass

## 实现

- `apps/macos/NativeChrome.swift` 使用 AppKit `NSGlassEffectView` 及其 `contentView` 承载侧栏、书架工具栏、阅读工具栏和进度控制；macOS 26 以下回退到 `NSVisualEffectView`。macOS 27 额外启用交互玻璃响应，均使用公开 API 和可用性检查。
- SF Symbols 图标、搜索、进度滑块、编码/缩放菜单及阅读偏好使用原生 AppKit 控件。阅读偏好使用标准 `NSPopover`，主题、字号和翻页设置与正文同步并保存。
- 窗口、原生控件及弹出面板跟随阅读主题；玻璃材质由系统处理，内容卡片减少人为反光和重阴影。
- Swift 外壳注入界面能力标识，Vue 发送精简的界面状态。原生操作通过明确的动作白名单回到共享阅读引擎；书籍二进制、凭据不进入这套界面状态。
- 隐藏原有 macOS HTML 导航，原生控件悬浮于 `WKWebView`。空白区域穿透事件，不阻挡正文翻页和双击。目录、搜索、读书设置继续与阅读栏的显隐状态联动；滑块或菜单正在操作时暂停自动隐藏。
- TXT/PDF 引擎、章节分页、文件身份、数据库和云端协议继续复用。HarmonyOS 和浏览器未声明原生界面能力时，保留现有共享界面。
- 主界面未加入文件存储政策、隐私宣告或防御性说明。侧栏及控制面板仅呈现导航、阅读操作与实际状态。

## 验证范围

- 44 项自动测试通过，包括原生界面动作校验和非 macOS 预览不调用界面桥接的检查，以及之前的存储、同步、Unicode、章节和手势测试。
- 前端类型检查、生产构建，macOS 和 HarmonyOS 构建验证。
- 在本机 macOS 27 / SDK 27 上，通过真实应用界面检查原生侧栏切换、文件选择器打开与取消、阅读偏好展开和完成关闭、主题切换、阅读引擎显示，以及工具栏自动隐藏和双击显示。没有安装或调试鸿蒙设备。
- 旧 macOS 的回退路径做可用性和编译检查，尚未在旧系统运行；尚未做开发者证书签名、公证或 Intel 构建。

## 官方资料

- https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- https://developer.apple.com/documentation/appkit/nsglasseffectview
- https://developer.apple.com/videos/play/wwdc2025/310/
