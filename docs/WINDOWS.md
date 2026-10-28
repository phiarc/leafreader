# Windows 版本

Windows 外壳使用 .NET 10 WPF + Microsoft Edge WebView2，复用现有 Vue/TXT/PDF 阅读引擎。面向 Windows 11 x64 和 ARM64，其他系统兼容性以微软 .NET 10 / WebView2 支持范围为准。

## 运行

完整解压对应架构的 ZIP，打开 `LeafReader.exe`；保留同目录的 `web`、DLL 及运行文件。发布包包含 .NET 运行时。WebView2 Runtime 需已安装，Windows 11 通常预装；缺少时会提示微软官方下载地址。当前为未做代码签名的测试版本。

## 功能

- TXT/PDF 原生文件选择、拖放导入，分页、章节、搜索、书签、阅读主题及正文留白。
- 键盘左右键/空格翻页、翻页动画、双击唤出工具栏和自动隐藏。
- 沿用同一阅读空间连接码，支持配置 JSON 导入、Azure 书本上传/按需下载和阅读位置同步。
- 使用 Windows DPAPI CurrentUser 保存连接码，退出重开自动恢复；主动断开连接删除记录。连接码不保存为明文。
- 使用 Windows 原生标题栏，共享界面工具栏，不套用 macOS/HarmonyOS 原生控件或系统安全区处理。

持久数据位置通过 Windows LocalApplicationData 获取，位于当前用户的 LeafReader 目录。WebView2 的 IndexedDB、配置和阅读进度保存在独立持久用户目录，页面固定使用 `https://leaf-reader.invalid` 虚拟主机加载本机资源，无需占用本机端口。单会话只允许打开一个实例。

原生桥接验证消息来源、方法和参数；API 请求和文件传输不跟随重定向，256 KiB 分块传输沿用现有协议。尚未实现 Windows 专属触控板跟手翻页控制器；当前支持键盘、页边按钮及 Chromium 提供的基础手势输入。

## 构建

安装 Node.js 24、.NET 10 SDK 和 PowerShell：

```powershell
npm ci
npm run windows:build
# ARM64:
pwsh -File scripts/build-windows.ps1 -Runtime win-arm64
```

输出目录 `build/windows/<runtime>`，ZIP 在 `build/releases`。不把发布包、bin/obj、用户配置、签名或凭据提交到源码仓库。

`.github/workflows/windows.yml` 在 Windows 构建机发布 x64/ARM64 包。x64 使用真实 WebView2/WPF 执行原生检查：安全来源限制、DPAPI 保存恢复/清除、TXT 原生文件导入、翻页、重开恢复、双击工具栏、PDF Worker/渲染，以及合成本机同步服务的原生网络读写。ARM64 在 x64 构建机交叉发布，不声称已经在 ARM64 硬件运行验证。

检查使用隔离临时用户目录和合成 TXT/PDF，不读取个人书库或现有 Azure 配置。源码中的 Windows 检查由 `--smoke-test` 显式启用，正常启动不运行。

官方参考：

- https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/wpf
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
- https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata
- https://dotnet.microsoft.com/en-us/platform/support/policy
