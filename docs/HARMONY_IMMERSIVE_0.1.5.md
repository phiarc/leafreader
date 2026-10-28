# 0.1.5：HarmonyOS 原生沉浸光感

本轮仅修改工程、运行测试与编译签名，没有安装、启动或调试设备。

## 原生界面

- 顶部操作区置于 ArkUI `Navigation` 标题栏，通过标题选项的 `systemMaterial` 接入系统材质。
- 书架与书签采用底部横向 `Tabs` 悬浮导航；阅读时使用单页签自定义底栏承载进度、翻页与编码/PDF 缩放菜单，通过 `barFloatingStyle` 设置系统材质。没有在任意普通容器上叠加无效的材质属性。
- 进度 `Slider`、原生菜单和阅读偏好半模态面板使用对应的系统材质接口；阅读偏好包含主题、字号、翻页方式与完成按钮。
- 顶部与底部工具栏遵循共享阅读界面的显隐状态，双击正文唤出。拖动进度条或打开编码菜单期间暂停自动隐藏，取消拖动后恢复；偏好面板显示期间也保持控制栏可见。
- 系统返回键优先关闭偏好面板，其次关闭阅读中的目录/搜索，最后返回书架。
- 纸白、暖纸和夜色由原生 `WithTheme` 与网页主题共同呈现；无持续全屏光晕动画。主界面没有增加存储政策、隐私宣告或防御性说明。

## 结构与兼容

`components/ImmersiveChrome.ets` 承载原生界面；`bridge/ChromeState.ets` 描述状态；`NativeBridge.ets` 接收界面更新并将动作安全编码后发送回共享阅读引擎。

Web 在文档启动前仅对包内虚拟 HTTPS 来源注入界面能力标识，复用 macOS 版已有的状态/动作协议。原生桥接还校验当前页面来源，书籍内容与凭据不进入界面状态。

`Navigation` 使用 `BarStyle.STACK` 叠加标题栏，底部导航作为局部覆盖层；正文只有一个 Web 构建入口，不随书架/阅读模式切换替换 Web 实例。原生栏显隐不应改变正文可用布局；这一点仍需要运行时检查。

目标 SDK 26.0.0，最低兼容版本保持 6.1.1(24)。启动时先检查 `deviceInfo.apiAvailable` 是否存在，再判断 26.0.0 可用性；旧版本不启用新原生界面。API 26 设备通过 `uiMaterial.isImmersiveMaterialSupported()` 检查材质能力，不支持时回退普通原生控件。旧系统与不同设备的实际显示尚未验证。

## 验证

- 46 项自动测试通过，新增 Harmony 文档启动能力识别与实际 `LeafNative` 桥接的界面状态合并/传递测试；保留之前的存储、同步、Unicode、PDF、章节及手势测试。
- 共享前端类型检查与生产构建，HarmonyOS ArkTS 编译及调试签名，macOS 编译均完成检查。
- 发布包检查包括版本、资源与源码一致、原生 SVG 图标打包、工程签名配置脱敏。
- 未验证真机视觉、触控、原生材质对 ArkWeb 内容的采样表现、帧率与功耗；编译与协议测试不能代替设备运行验证。

## 官方依据

- https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/arkts-immersive-light-sense-enable
- https://developer.huawei.com/consumer/cn/doc/harmonyos-references/arkts-apis-uimaterial

接口签名及可用版本以本机 SDK 26.0.0 的 ArkUI、ArkWeb 和 deviceInfo 声明为准。
