# 页间 · Leaf Reader

本地优先的 TXT / PDF 阅读器。当前交付 macOS 可运行测试版、HarmonyOS 原生工程与未签名 HAP，以及可自行部署的 Azure 书库与进度同步服务。Windows 客户端尚未实现。

本仓库仅提供源码、构建模板及合成测试素材；个人同步连接码、Azure 登录缓存、设备签名与阅读数据不随源码分发。

## 运行

macOS：打开 `build/macos/页间.app`。当前二进制面向 Apple Silicon，使用本机 Swift 工具链构建并做本地临时签名，尚未公证或进行商店发布。

HarmonyOS：用 DevEco Studio 打开 `apps/harmony`。本机已使用 SDK 26.0.0 Release 编译通过，工程最低兼容配置为 `6.1.1(24)`。先在 Project Structure → Signing Configs 中为自己的设备配置调试签名，再安装运行。仓库不包含设备签名配置；真机效果需要自行构建验证。

更新：鸿蒙 0.1.13 使用独立图标资源，去掉外圈透明留白，保留圆角；macOS 仍为 0.1.12，资源未变。此前 0.1.12 将 Dock、关于面板、鸿蒙启动窗口及界面标志统一为透明圆角图标。此前鸿蒙 0.1.11 移除阅读页边缘渐变，消除与底部手势区域的色差，控件与正文布局不变。macOS 保持 0.1.10。此前 0.1.10 恢复鸿蒙系统安全区内的控件位置，只延伸背景绘制；macOS 支持每侧 0–35% 连续留白与百分比输入，详见 `docs/LAYOUT_0.1.10.md`。此前 0.1.9 支持书本文件云端同步、另一端书架自动发现和按需下载，并优化鸿蒙全屏阅读、通知位置与编码二级菜单，详见 `docs/BOOK_SYNC_0.1.9.md`。保留 macOS 持久连接、Liquid Glass、鸿蒙沉浸光感与跟手翻页。本轮未安装或调试鸿蒙设备。本机签名配置不包含在源码包中。

## 已实现

- 导入 TXT / PDF；按原始文件 SHA-256 识别同一本书，重复导入保留原进度。
- 书架、搜索书架、按格式筛选、最近阅读。
- TXT 自动检测 UTF-8、UTF-16、GB18030，可手动切换编码；章节识别、全文查找、分页阅读。
- PDF 页面渲染、页码跳转、适合页面 / 放大阅读。
- 轻盈滑动、覆盖翻页、书页翻转、直接翻页四种翻页方式；键盘及触摸翻页。
- 纸白、暖纸、夜色；TXT 字号调整。
- 按平台切换界面材质：macOS 为液态玻璃，HarmonyOS 为沉浸光感；浏览器预览保持基础纸面外观。
- 本机进度恢复、本机书签。
- 云端书本同步、另一端书目发现、按需下载、移除下载和云端删除；5 GiB 逻辑容量上限。
- 云端阅读位置同步、离线待同步记录、版本冲突选择、重复操作幂等。

书籍文件和进度元数据分开保存在本机 IndexedDB 中，更新阅读位置不会重复写入整本书。此原型尚未改用原生 SQLite。

## 同步

部署自己的 Azure 服务后，使用生成的 HTTPS API 地址，例如 `https://your-function-app.azurewebsites.net/api`。

在 macOS 左下角打开“阅读空间”，点击“导入同步配置”，选择部署脚本在本机生成的 `.cache/leaf-sync-connection.json`。该文件包含个人连接码，请勿提交仓库、放进发布包或公开分享。

其他设备填写同一个同步地址及个人空间连接码后，书目自动同步，点击下载即可接着读。

当前原型使用随机生成的个人空间连接码，尚未实现 Microsoft / Entra 用户账号登录。云端保存书籍原文件、书名及相关书目信息和阅读位置。书签仍仅在本机保存。

macOS 0.1.8 使用 Secure Enclave 和 AES-GCM 加密保存连接码，退出重开自动恢复；首次升级后连接一次即可，主动断开会删除记录。认证设置禁止弹出密码或指纹窗口，跨进程及重新编译签名恢复已通过本机测试。当前发行包面向具备 Secure Enclave 的 Apple Silicon Mac。鸿蒙端使用 Asset Store Kit 保存连接码；实际设备行为尚待验证。

每次翻页先保存本机；前台阅读期间，约每 30 秒尝试合并同步变动。打开应用、网络恢复及手动操作也会尝试同步。云端发生冲突时由用户选择位置，阅读中不会自动跳页。

## 开发

环境：Node.js 22+；macOS 构建需要 Swift / Xcode Command Line Tools；鸿蒙构建需要匹配的 DevEco Studio SDK、JDK、ohpm 与 Hvigor。

```sh
npm ci
npm run dev
npm test
npm run mac:build
npm run harmony:build
```

`npm run build` 会把 PDF.js 的字体、字符映射和 Wasm 资源打入本地包，并将共享界面复制到鸿蒙 `rawfile/reader` 目录。运行时不从 CDN 下载阅读资源。

macOS 外壳使用 Swift + WKWebView，并以只监听 `127.0.0.1:17643` 的本地静态资源服务加载打包界面。该服务只暴露应用资源，不提供书籍内容或凭据接口。当前只允许启动一个实例。

## Azure

部署脚本默认使用独立开发资源组和 Southeast Asia 区域，可通过环境变量配置。仓库不包含现有订阅、账号或已部署资源的地址与标识。

- Cosmos DB：显式启用 Free Tier、单区域、数据库共享手动吞吐量 400 RU/s，分区键 `/userId`。
- Functions：Windows Consumption Y1、Node.js 22、单实例扩展限制、HTTPS。
- Storage Account：Standard LRS；禁用 Blob 匿名公开访问。
- Application Insights：关闭。

数据库免费层不代表整套资源零账单。函数运行存储、网络等可能消耗 Azure 学生额度。订阅到期或额度用尽可能中断同步，本地阅读不依赖云端。

书本同步的部署扩展脚本为 `node cloud/deploy-library.mjs`，真实读写验证为 `node scripts/verify-library-cloud.mjs`。详见上述版本文档。

后端源码在 `cloud`。Azure CLI 登录后，可先运行 `node cloud/deploy.mjs` 生成清单，确认后再使用 `--apply`。脚本拒绝在已有其他 Cosmos DB 免费层账户时自动创建收费数据库，默认也拒绝部署到非学生订阅。

```sh
npm ci --prefix cloud
node scripts/package-cloud.mjs
node cloud/deploy.mjs
node cloud/deploy.mjs --apply
node scripts/verify-cloud.mjs
```

部署工具使用的 Azure 身份凭据和服务配置保存在被忽略的 `.cache` 目录。它们不属于可公开交付的源码。

## 当前限制

- HarmonyOS 的 ArkWeb PDF Worker、文件导入及安全存储仍需在目标设备上验证。
- macOS 测试版支持持久连接，尚未做开发者证书签名、公证、自动更新和 Intel 打包。
- PDF 暂无文本选择、正文搜索、OCR 或加密文档解锁。
- 书签仅本机保存；暂不支持 EPUB、批注、仿真纸张卷曲。
- 单文件上限：TXT 30 MB、PDF 100 MB。10 / 30 MiB 文本已完成桌面 Node 核心处理测量；不代表鸿蒙真机导入、排版与峰值内存已验证，超大书库尚未压力测试。
- 本机数据依赖应用 WebView 的存储，清除应用数据会删除本机书架；请保留原始书籍文件。

## 验证

`npm test` 覆盖文本规范化、编码、Unicode 定位、PDF 解析、实际客户端同步模块、请求丢失重试、并发写入、过期更新冲突及反向阅读。

运行云端验证脚本后，报告保存在被忽略的 `build/cloud/` 中，报告不会包含在仓库中。macOS 已通过界面操作验证导入、TXT/PDF 翻页、书签和重启后进度恢复。鸿蒙编译通过不等于已完成运行验证。

## 工程目录

```text
src/                 共享 Vue / TypeScript 阅读界面与同步客户端
src/core/            文本解码、规范化与目录识别
apps/macos/          原生 macOS 外壳
apps/harmony/        ArkTS / ArkUI / ArkWeb 工程
cloud/               Azure Functions 与 Cosmos DB 同步服务
scripts/             构建、打包、部署及云端验证
tests/               端侧核心与同步集成测试
```

PDF.js 使用 Apache-2.0 许可，Vue 使用 MIT 许可；发布时应保留依赖附带的许可证文件。附带的《山间来信》《让阅读慢下来》为本项目演示内容。
