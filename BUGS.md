# 页间 · Leaf Reader — 缺陷清单

> 原始评审记录保留如下。2026-10-28 已完成第一批源码修复，当前状态见 [0.1.2 修复记录](docs/PRIORITY_FIXES_0.1.2.md)：STO-01、STO-02、READ-01/04、SYNC-01 及连续翻页动画已处理；其余条目不代表已修复。原评审中的 READ-02 漏读推断不成立，IMP-01 阻塞程度、CLOUD-01、HARM-01 仍需验证。
> 基线：2026-10-27 工作区快照；`npm test` 26/26 通过，`vue-tsc --noEmit` 通过。

## 说明

- 定级：**高** = 会导致功能不可用或数据不可访问；**中** = 特定平台/配置下失效或与承诺不符；**低** = 边界、体验、可维护性问题。
- 本清单没有 P0：没有发现静默丢数据、凭据泄露或远端可触发的严重安全问题。
- 每条包含：位置、现象、影响、触发条件、建议方向。**建议只是建议，均未实施。**
- 第 1–3 节是代码缺陷；第 4 节是文档/产物不一致；第 5 节是工程规范缺口（不是代码 bug）。

## 总览

| 编号 | 级别 | 标题 |
|---|---|---|
| [STO-01](#sto-01) | 高 | 一本书的文件记录缺失会导致整个书架无法加载 |
| [STO-02](#sto-02) | 高 | IndexedDB 句柄创建失败一次后，本次会话永久不可用 |
| [READ-01](#read-01) | 高 | 30 MB TXT 的内存模型与对外承诺不匹配 |
| [IMP-01](#imp-01) | 高 | 导入过程在主线程做哈希与整文件复制，大文件会卡死界面 |
| [CLOUD-01](#cloud-01) | 中 | 已部署的 Azure 服务未设置 CORS，浏览器预览连不上 |
| [HARM-01](#harm-01) | 中 | 鸿蒙本地资源响应把二进制资源也声明为 utf-8 |
| [MAC-01](#mac-01) | 中 | "单实例"只靠端口占用实现，第二个实例不会退出 |
| [SYNC-01](#sync-01) | 中 | 冲突未决时每 30 秒重复提交同一个必然 409 的请求 |
| [SYNC-02](#sync-02) | 低 | 协议版本常量定义处与使用处脱钩 |
| [PDF-01](#pdf-01) | 低 | 单页 PDF 打开即显示"已读 100%" |
| [READ-02](#read-02) | 低 | 单页文本硬上限 12,000 码点，极端窗口下会被截断且无法翻到 |
| [READ-03](#read-03) | 低 | 跨午夜的阅读时长会写回昨天的 key |
| [READ-04](#read-04) | 低 | TXT 搜索每次都对全量字符数组做 `join` |
| [TEST-01](#test-01) | 低 | XSS 测试覆盖的是一个应用从未调用过的函数 |
| [TEST-02](#test-02) | 低 | fixture `GB18030编码测试.txt` 未被任何测试引用 |
| [DEAD-01](#dead-01) | 低 | 若干未使用的导出（死代码） |
| [CLOUD-02](#cloud-02) | 低 | 幂等回执只保留 32 条，超长离线队列会退化为冲突 |
| [CLOUD-03](#cloud-03) | 低 | 限流状态是进程内 Map，仅在单实例配置下有效 |
| [MAC-02](#mac-02) | 低 | 原生桥接校验了 host/port，但没有校验 scheme |
| [REL-01](#rel-01) | 低 | 发布包内混入 `._*` AppleDouble 文件 |
| [REL-02](#rel-02) | 低 | 版本号在三处不一致 |

---

## 1. 高

### STO-01

**一本书的文件记录缺失会导致整个书架无法加载**

- **位置**：[storage.ts:37](src/storage.ts#L37)
- **现象**：`listBooks()` 对每条元数据查找 `files` 记录，任意一条缺失就 `throw new Error('《…》的本地文件缺失')`。该异常一路抛到 [App.vue:139-140](src/App.vue#L139-L140) 的 `initError`，界面只剩错误条。
- **影响**：**整库不可用**。用户既进不了书架，也没有入口移除那本坏书，只能清空应用数据（等于丢掉全部本机书架），或手动进开发者工具改 IndexedDB。
- **触发条件**：早期版本写入中断、WebView 存储被系统部分清理、`files` 与 `books` 两个 store 写入不同步（`saveBook` 在同一个事务里写两者，概率低但存在）。
- **建议方向**：`listBooks` 逐条容错，把缺失文件的书标成 `missing` 返回；UI 提供"重新导入"或"仅移除记录"的恢复动作。

### STO-02

**IndexedDB 句柄创建失败一次后，本次会话永久不可用**

- **位置**：[storage.ts:12](src/storage.ts#L12)
- **现象**：`database ??= new Promise(...)`。Promise 一旦 reject（如 `onblocked`、"请关闭其他页间窗口后重试"、升级事务被中止），这个 rejected Promise 会被永久缓存，之后每次 `db()` 都返回同一个失败结果。
- **影响**：一个瞬时的打开失败（比如用户先开了另一个窗口）会让应用在**本次进程生命周期内**再也无法读写书架，必须重启。错误提示却写着"请关闭其他窗口后重试"——重试并不会成功。
- **触发条件**：多窗口/多标签同时打开、升级过程中被阻塞。
- **建议方向**：失败时把 `database` 重置为 `undefined` 再抛错，让下一次调用能真正重试。

### READ-01

**30 MB TXT 的内存模型与对外承诺不匹配**

- **位置**：[Reader.vue:91](src/components/Reader.vue#L91)（`chars = Array.from(decoded.text)`）、[text.mjs:13](src/core/text.mjs#L13)（`text.split('\n')`）、[Reader.vue:76](src/components/Reader.vue#L76)（`chars.join('')`）
- **现象**：整本书被拆成**逐字符 string 数组**。30 MB 中文 TXT ≈ 1,000 万码点，即 1,000 万个单字符字符串对象；再叠加 `findChapters` 的全文分行副本、每次搜索的全文 `join`。
- **影响**：峰值内存估算在**数百 MB 量级**。在移动端（鸿蒙）或低配 Mac 上，很可能 OOM、页面被系统回收，或出现数秒级卡顿。README 承诺"TXT 上限 30 MB"，但代码路径只对几 MB 的文本友好。
- **触发条件**：导入并打开大体积中文 TXT；搜索时更明显。
- **建议方向**：要么把对外上限降到实测安全的量级，要么把"全量码点数组"改为惰性索引（行数组 + 行内偏移），章节与搜索在字符串上直接定位。需要先用 10/30 MB 样例实测一次再定。
- **现状**：未测。只有 12 字节的 GB18030 fixture 和一个 3 页 PDF fixture。

### IMP-01

**导入过程在主线程做哈希与整文件复制，大文件会卡死界面**

- **位置**：[App.vue:59](src/App.vue#L59)（`arrayBuffer` + `fileHash`）、[App.vue:66](src/App.vue#L66)（`new Blob([bytes])`）、[storage.ts:42](src/storage.ts#L42)（再算一次 `arrayBuffer`）
- **现象**：100 MB PDF 的读取、SHA-256 计算、Blob 构造全部在主线程串行完成；多选文件时逐个 `await`，没有进度反馈，也没有让出事件循环。
- **影响**：导入大文件时界面无响应，"正在导入…"期间用户无法取消；同时在内存里可能同时存在 `ArrayBuffer` 与 `Blob` 两份数据。
- **触发条件**：导入接近上限（PDF 100 MB / TXT 30 MB）的文件，或多选多个中等大小文件。
- **建议方向**：哈希移入 Web Worker；每处理完一个文件让出一次事件循环并更新进度；避免重复的 `arrayBuffer()` 调用。

## 2. 中

### CLOUD-01

**已部署的 Azure 服务未设置 CORS，浏览器预览连不上**

- **位置**：[azure.mjs:36](cloud/azure.mjs#L36)（只回 `Cache-Control` / `X-Content-Type-Options`），对比 [local.mjs:11](cloud/local.mjs#L11)（本地开发服务器专门加了 `Access-Control-Allow-Origin`）
- **现象**：浏览器里 `fetch` 跨域请求已部署的 `https://….azurewebsites.net/api` 会被 CORS 拦截。macOS / 鸿蒙走原生代理，不受影响。
- **影响**：`npm run dev` 的浏览器预览只能连 `cloud:dev`（127.0.0.1:7071），无法验证真实云端；README 未说明这个限制。
- **触发条件**：浏览器中打开 Vite 预览并填写真实 Azure 地址。
- **建议方向**：在 Functions 平台配置 CORS 白名单，或在 README 里写明"浏览器预览仅支持本地后端"。注：门户侧是否已另行配置，本次未验证。

### HARM-01

**鸿蒙本地资源响应把二进制资源也声明为 utf-8**

- **位置**：[LocalResources.ets:28](apps/harmony/entry/src/main/ets/bridge/LocalResources.ets#L28)
- **现象**：所有被拦截的资源（包括 `.wasm`、`.bcmap`、`.pfb`、`.ttf`）都调用 `setResponseEncoding('utf-8')`。
- **影响**：对二进制内容设置字符集理论上无意义，最坏情况下可能导致 ArkWeb 按文本解码，出现 PDF 字体/字符映射或 Wasm 加载异常。**未经真机验证**，属于风险提示而非已确认故障。
- **触发条件**：鸿蒙端打开含中日韩字体映射或图片编码的 PDF。
- **建议方向**：仅对 `text/*`、`application/json`、`application/javascript` 设置 charset；二进制保持不设置。

### MAC-01

**"单实例"只靠端口占用实现，第二个实例不会退出**

- **位置**：[main.swift:88](apps/macos/main.swift#L88)，对应 [README.md:54](README.md#L54) 的"当前只允许启动一个实例"
- **现象**：第二次启动时 `NWListener` 绑定 17643 失败，只弹一个 `NSAlert`，`applicationDidFinishLaunching` 继续执行，窗口已经创建并显示但永远不会加载内容。
- **影响**：用户看到的是一个空白窗口 + 一次错误弹窗，需要手动关窗退出；这与"只允许一个实例"的表述不符。
- **触发条件**：双击启动两次，或旧实例未完全退出时再次启动。
- **建议方向**：绑定失败即 `NSApp.terminate(nil)`；或用文件锁 / `NSRunningApplication` 做真正的单实例。

### SYNC-01

**冲突未决时每 30 秒重复提交同一个必然 409 的请求**

- **位置**：[App.vue:143](src/App.vue#L143)（30 秒定时器只看 `dirty`）、[sync.ts:19](src/sync.ts#L19)（409 时只 push 冲突、`continue`）
- **现象**：PUT 返回 409 后，本机 `dirty` 仍为 true、`pendingOperationId` 仍保留；定时器每 30 秒把同一份请求再发一次，服务端每次都回 409。只有用户在弹窗里做出选择后才会停止。
- **影响**：功能正确（不会被错误覆盖），但会持续产生无效请求与日志；若用户离开冲突弹窗，云端每分钟两次 409 会一直持续。
- **触发条件**：两台设备真实冲突且用户未处理。
- **建议方向**：冲突挂起期间把该书排除出自动同步；或记录"已进入冲突"状态，等用户操作后再恢复。

## 3. 低

### SYNC-02

**协议版本常量定义处与使用处脱钩**

- **位置**：[text.mjs:2](src/core/text.mjs#L2) 定义 `LOCATOR_VERSION`，但 [sync.ts:16](src/sync.ts#L16) 直接写死 `locatorVersion: 1`。
- **影响**：改协议版本时容易只改一处；且常量本身无任何引用（见 DEAD-01）。

### PDF-01

**单页 PDF 打开即显示"已读 100%"**

- **位置**：[Reader.vue:18](src/components/Reader.vue#L18)：`pdfPages <= 1 ? 1 : …`
- **影响**：单页文档（封面、单页说明）一打开就计入"已读完"，书架进度条与统计失真。

### READ-02

**单页文本硬上限 12,000 码点，极端窗口下会被截断且无法翻到**

- **位置**：[Reader.vue:35](src/components/Reader.vue#L35)（向后分页上界）、[Reader.vue:47](src/components/Reader.vue#L47)（向前分页下界）
- **影响**：在超大窗口 + 最小字号（15 px）组合下，一屏可容纳的文字可能超过 12,000 码点；超出的部分被 `overflow:hidden` 裁掉，翻页又永远从 `end` 继续，形成**读不到的死角**。常规窗口不会触发。

### READ-03

**跨午夜的阅读时长会写回昨天的 key**

- **位置**：[App.vue:22](src/App.vue#L22) 在 setup 时算一次 `todayKey`，[App.vue:144](src/App.vue#L144) 定时器一直用它。
- **影响**：应用跨越零点持续运行，当天阅读分钟数会统计到前一天，页脚的"今天阅读 N 分钟"不准。

### READ-04

**TXT 搜索每次都对全量字符数组做 `join`**

- **位置**：[Reader.vue:76](src/components/Reader.vue#L76)
- **影响**：每次搜索都新建一份与全文等长的字符串；大书上搜索有明显延迟，且与 READ-01 叠加放大内存压力。

### TEST-01

**XSS 测试覆盖的是一个应用从未调用过的函数**

- **位置**：[text.mjs:21](src/core/text.mjs#L21) 的 `escapeHtml` 只被 [tests/text.test.mjs:10](tests/text.test.mjs#L10) 引用，`src/` 内无任何调用。
- **影响**：`imported text cannot turn into HTML markup` 这条测试给人"XSS 已覆盖"的印象，但它测的是死代码。真实渲染路径靠 Vue 的 mustache 插值自动转义（本身是安全的），只是这条测试**证明不了**这一点。建议要么删掉，要么改成对真实渲染路径的断言。

### TEST-02

**fixture `GB18030编码测试.txt` 未被任何测试引用**

- **位置**：[tests/fixtures/GB18030编码测试.txt](tests/fixtures/GB18030编码测试.txt)；`text.test.mjs` 用的是内联字节数组。
- **影响**：一个看似"有测试数据"的文件实际未被使用，容易误导后续维护者。

### DEAD-01

**若干未使用的导出（死代码）**

- `escapeHtml`（[text.mjs:21](src/core/text.mjs#L21)）
- `LOCATOR_VERSION`（[text.mjs:2](src/core/text.mjs#L2)）
- `SyncConfig`（[types.ts:10](src/types.ts#L10)）

### CLOUD-02

**幂等回执只保留 32 条，超长离线队列会退化为冲突**

- **位置**：[service.mjs:56](cloud/service.mjs#L56) `slice(-32)`
- **影响**：某设备离线积压的待同步操作，如果在重试前云端已被其他设备推进了 32 次以上，该操作号不再有回执，重试会得到 409 而不是原来的成功结果，用户会看到一次本可避免的冲突选择。当前产品规模下概率很低。

### CLOUD-03

**限流状态是进程内 Map，仅在单实例配置下有效**

- **位置**：[service.mjs:27](cloud/service.mjs#L27)、[:34](cloud/service.mjs#L34)
- **影响**：目前靠 `functionAppScaleLimit=1`（[deploy.mjs](cloud/deploy.mjs)）保证近似全局；一旦放开扩缩容，限流按实例各自计数，实际阈值成倍放大。属设计约束，需在扩容前改成共享存储。

### MAC-02

**原生桥接校验了 host/port，但没有校验 scheme**

- **位置**：[main.swift:109](apps/macos/main.swift#L109)（`message.frameInfo.request.url?.host == "127.0.0.1"` 与端口检查）
- **影响**：当前页面来源只可能是 `http://127.0.0.1:17643`，实际风险为零；但若将来该端口上出现别的 scheme 或本地服务，校验就不完整。与 [main.swift:101](apps/macos/main.swift#L101) 的导航校验（那里查了 scheme）不一致。

### REL-01

**发布包内混入 `._*` AppleDouble 文件**

- **位置**：[package-release.mjs:5](scripts/package-release.mjs#L5)、[:13](scripts/package-release.mjs#L13) 使用 `/usr/bin/ditto` 打包，扩展属性被一并带入。
- **影响**：`页间-完整工程.zip` 里能看到 `leaf-reader/apps/harmony/._build-profile.template.json5` 之类条目，解压后污染目录、也让包体略大。属观感问题。

### REL-02

**版本号在三处不一致**

- `0.1.0`：[package.json](package.json)、[apps/macos/Info.plist](apps/macos/Info.plist)
- `0.1.1`：[apps/harmony/AppScope/app.json5](apps/harmony/AppScope/app.json5)、[README.md](README.md)
- 已安装的 HAP 是 `0.1.0`（见 `build/releases/鸿蒙安装记录.json`），而新构建的签名 HAP 是 `0.1.1`

---

## 4. 文档与产物不一致

### DOC-01

**README 说鸿蒙"尚未签名、安装"，但产物里有签名 HAP 和安装记录**

- 位置：[README.md:82](README.md#L82)"HarmonyOS 尚未签名、安装或真机验证"
- 实际：`build/releases/` 中有 `页间-HarmonyOS-0.1.1-signed.hap`、`页间-HarmonyOS-device-signed.hap`；`鸿蒙安装记录.json` 记录 0.1.0 在 HUAWEI Pura 70 Pro+ 上 `installerReportedSuccess: true`、`launchedByAssistant: false`、`debuggedByAssistant: false`。
- 准确表述应为：**已配置调试签名并成功安装过 0.1.0；0.1.1 修复版未重装；从未启动或调试过。**

### DOC-02

**README 内部自相矛盾**

- [README.md:11](README.md#L11) 说"已为连接的设备配置本地调试签名"，[README.md:82](README.md#L82) 说"尚未签名"。

### DOC-03

**"30 MB TXT"承诺缺少实测支撑**

- 位置：[README.md:85](README.md#L85)、[App.vue:58](src/App.vue#L58)
- 现状：仓库内最大的 TXT fixture 只有 12 字节，没有任何大文件性能或内存验证记录；结合 READ-01，这个上限目前是**未经验证的产品声明**。

## 5. 工程规范缺口（不是代码缺陷）

| 项 | 现状 | 影响 |
|---|---|---|
| 版本控制 | 根目录**没有 `.git`**，但有 `.gitignore` | 无历史、无 diff、无回滚；所有评审只能靠通读全文 |
| Lint / 格式化 | 无 ESLint、Prettier、EditorConfig | [App.vue](src/App.vue) 最长单行 1,897 字符，[style.css](src/style.css) 单行 13,345 字符，改动与 review 成本很高 |
| CI | 无 `.github/` 或等价配置 | 26 个测试只能靠人工记得跑 |
| 许可证 | 无项目级 `LICENSE` | 对外发布源码时授权不明；第三方许可已随包附带（`dist/licenses`、`dist/pdf/*/LICENSE*`） |
| 构建产物 | `dist/`、鸿蒙 `rawfile/reader/`、`build/` 都在工作区且被 `.gitignore` 忽略 | 目前无 git，所以"忽略"不生效，产物与源码混在一起，无法判断哪份是源头 |

## 6. 已确认没问题的部分

供对照，避免本清单被误读为"整体不可用"：

- 同步协议：`baseRevision` 乐观并发 + `operationId` 幂等回执 + ETag 条件更新，丢包重试不产生假冲突、并发首写不会互相覆盖、反向阅读合法——均有测试覆盖。
- 凭据处理：Token 不进 IndexedDB、不进构建产物、不进源码发布包；macOS 只存进程内存，鸿蒙用 Asset Store Kit；扫描 `dist/`、`public/`、`rawfile/`、`.app` 未发现明文连接码。
- 原生桥接：路径前缀白名单、方法白名单、禁止跟随重定向、响应先解析再注入。
- 离线资源：PDF.js 的 cmaps / standard_fonts / wasm 全部本地化，构建时生成 MIME 清单并有测试校验入口资源齐全。
- 存储迁移：v1→v2 保留原始字节、阅读位置、书签与云端版本，有测试。
- 依赖面：运行时只有 Vue 与 PDF.js 两个包。

## 7. 建议的处理顺序

1. **STO-01 / STO-02** — 改动小、收益直接，避免"一本书坏了整个书架打不开"。
2. **READ-01** — 先拿 10 MB / 30 MB 真实样本书实测，再决定"改实现"还是"改承诺"。
3. **建 git 基线** — 在动上面任何一处之前，先有可回滚的历史。
4. **CLOUD-01 / DOC-01** — 半天内可完成的说明性修正。
5. **IMP-01 / HARM-01 / MAC-01 / SYNC-01** — 随下一次平台迭代处理，HARM-01 需要真机验证。
6. 其余低级别项按顺手程度清理。

---

*本文件由代码通读与只读验证整理而成；除本文件外未新增或修改任何项目文件。*
