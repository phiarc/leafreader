# 0.1.9 书本同步与鸿蒙阅读布局

## 使用

两端连接同一个阅读空间后，导入的 TXT/PDF 自动上传。其他设备的书架自动出现书目，点击下载并从同步位置继续阅读，下载成功后可离线阅读。已导入的书也会在新版首次同步时上传。连接配置和连接码沿用旧版。

书卡右侧管理按钮提供“移除下载”和“从书库删除”。前者仅移除本机文件，保留书目、位置和书签；后者删除云端文件并在其他设备下次同步时移除书目。明确重新导入原文件可恢复已删除书籍。书签仍仅保存在本机。离线时已缓存书籍可读；云端删除需要联网。

容量：5 GiB 逻辑配额、500 个书目记录（含删除记录）、TXT 单本 30 MiB、PDF 单本 100 MiB。逻辑配额不等于账单硬限制：未完成上传、快照及暂时未清理对象可能额外占用存储；Azure 的存储、请求、网络仍按订阅政策计费。文件同步失败时继续尝试阅读进度同步。

## 云端和客户端

复用现有 Standard LRS 账户的私有 `leaf-books` 容器、Cosmos `progress` 容器及 Consumption Function。新增：

- `GET /v1/library`：书目、删除记录、配额和用量。
- `PUT /v1/books/{sha256}/upload`：验证元数据、通过 Cosmos ETag CAS 预留容量、返回限时单文件写入 SAS 和会话。
- `PUT /v1/books/{sha256}/complete`：提交固定分块列表、冻结快照并流式验证 SHA-256 和大小；通过后发布书目。
- `GET /v1/books/{sha256}/download`：返回限定快照的只读 SAS。
- `DELETE /v1/books/{sha256}/file`：先保存删除记录，再清理 Blob 与快照；失败可重试，书目刷新也重试待清理记录。

函数使用托管身份和 Storage Blob Data Contributor，通过 Azure Functions 内部身份接口获得存储令牌；SDK 签发 User Delegation SAS。客户端不持有存储账户密钥。写 SAS 不能写入已经发布的快照，避免验证后内容被替换。SAS 30 分钟有效，上传会话一小时有效，未提交块由 Azure 到期清理。

每个分块 256 KiB，原生 URLSession / NetworkKit 完成二进制传输，桥接只传单个有界分块，不把整本 PDF 转成长字符串。分块失败自动重试，整个上传失败后下次同步重新提交同一会话；目前不记录已完成分块索引，因此重开后重新发送分块，尚非精确断点续传。下载完成后检查总大小和 SHA-256，成功才写入本机文件存储；失败不留下可阅读的半文件。下载未实现跨进程断点续传。

本版使用共享个人空间连接码。持有该码的设备均有书库读写权限；未新增多用户账户体系或端到端加密。

## 鸿蒙界面

- 阅读底栏只保留翻页、进度滑块和百分比；编码选择在“阅读偏好 → 调整文字编码”的二级菜单。旧 API 共享界面在“目录 → 文字显示设置”中调整。
- 阅读底栏使用完整宽度的原生材质容器，避免单标签导航栏压缩进度控件。
- 通知放在 dock 上方，并计算底部系统安全区。
- 开启全屏布局，透明系统栏、背景延伸至上下系统区；监听安全区变化，正文只避让状态栏/手势区并额外保留 14/18 px 边距。显示/隐藏浮层工具栏不改变分页高度。
- 章节仍从新页开始，标题后接正文；显示时把连续三行以上空行折叠为一个空行，合并相邻的重复“第 N 章 / 第 N 章 标题”目录标记。原文、文件哈希、规范化字符定位不变。

## 验证

68 项自动测试通过：含真实客户端桥接的多分块重试、下载校验、模拟另一端发现、并发容量预留、重复提交、删除清理/防复活、快照不可变，以及标题正文同页回归。

`node scripts/verify-library-cloud.mjs` 已在真实 Azure 上通过 macOS 实际 URLSession 分块传输验证 TXT 和 PDF 上传、完成重试、书目发现、匿名访问拒绝、范围下载与原文件逐字节一致、删除。只上传合成测试文件，结束后已删除；报告位于 `build/cloud/library-verification.json`。

独立浏览器的两份应用上下文已验证导入上传、另一端发现下载、恢复阅读位置、移除下载后重新下载、云端删除传播，以及鸿蒙尺寸下正文区域超过视口高度 85%、通知高于 dock。该预览模拟原生桥接，不能替代原生 UI 真机验证。

构建通过不代表鸿蒙真机界面和 NetworkKit 传输已验证。本轮按用户要求只交付工程和安装包，不安装或调试鸿蒙设备。

官方依据：

- https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview
- https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
- https://learn.microsoft.com/en-us/javascript/api/@azure/storage-blob/blockblobclient
- https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-arkui-1562
