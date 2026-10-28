# 应用标志

0.1.7 采用项目所有者选定的暖纸翻页书图片。原始图保存在 `public/branding/leaf-logo.png`，保留原有背景、比例、留白和图形，没有裁切或重绘。

接入位置：

- macOS 应用 ICNS、Dock/关于面板图标，以及原生侧栏标识。
- HarmonyOS AppScope 应用图标、启动窗口图标，以及原生书架标题栏标识。
- 共享网页侧栏和浏览器 favicon。

`npm run build` 会通过 `scripts/prepare-brand.mjs` 准备资源。macOS 上使用系统工具生成各尺寸 PNG，并封装 ICNS；非 macOS 构建保留已经随工程提供的 ICNS。图标文件由 AppKit 解码检查，应用包及源码包也检查资源存在与引用一致。

本轮没有安装或调试鸿蒙设备。系统桌面或 Dock 的缓存图标可能需要应用重新启动后更新。


## 0.1.12 圆角资源

保留 `public/branding/leaf-logo.png` 原图。图像编辑生成圆角版本，输入保存为 `leaf-logo-rounded-source.png`，打包时通过 `scripts/render-icon.swift` 的向量圆角路径统一清理透明边缘，输出 1024×1024 的 `leaf-logo-rounded.png`。图标主体为 808×808，外侧保留透明留白，圆角半径 210，内部纸面保持不透明。

`prepare-brand.mjs` 从最终圆角 PNG 生成 macOS 全尺寸 ICNS、原生侧栏 PNG 和鸿蒙 app_icon PNG。鸿蒙能力的应用图标与 startWindowIcon 都引用该资源。共享标识和 favicon 也改用圆角版本。原生资源已经包含透明圆角，Dock 和启动窗口无需依赖界面控件的 borderRadius。

已检查四角透明、主体不透明、原生 PNG 透明通道及 ICNS 表示；两端构建并打包。未安装或调试鸿蒙设备。


## 鸿蒙 0.1.13 图标占位修正

鸿蒙不再直接复用 macOS 的 1024 画布/808 主体 Dock 图标。`render-icon.swift` 的 harmony 模式从最终圆角 PNG 裁取 808×808 主体并放大为 1024×1024，保留圆角，移除四周各 108 像素的透明边距。应用、启动窗口和原生标题栏继续引用独立的 `app_icon.png`。macOS 的 ICNS 和 PNG 文件哈希保持不变。

已检查鸿蒙图标 alpha 包围盒覆盖整个 1024×1024 画布、四边中点不透明、角部透明，并检查最终安装包资源。未安装或调试设备。
