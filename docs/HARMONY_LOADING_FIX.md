# HarmonyOS 0.1.1：离线界面加载修复

原版本通过 `resource://rawfile` 加载 Vite 生成的页面，其中入口为带 `crossorigin` 的 ES module。ArkWeb 对本地 resource/file 协议的跨域请求有限制，因此这种入口方式会阻止主界面脚本加载，出现白屏。

修复采用华为文档建议的离线资源映射方式：

- 页面入口改为保留域名 `https://leaf-reader.invalid/reader/index.html`。
- `onInterceptRequest` 根据构建时生成的文件清单返回应用包内资源，不访问此域名的网络服务器。
- JS、CSS、PDF Worker、Wasm 和字体的 MIME 类型由构建清单统一生成。
- 未知本地地址返回 404；页面导航仍只允许本应用离线来源。
- 页面脚本未启动或主资源加载失败时，显示错误提示与重试按钮。

这次只进行了本机构建与资源映射回归测试，没有重新安装，也没有启动或调试设备上的应用。

官方说明：https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/web-cross-origin
