# 实现与协议

## 阅读位置

协议版本 `locatorVersion: 1`。

- TXT：去除 BOM，将换行统一为 LF，将文本统一为 Unicode NFC；`offset` 按 Unicode code point 计数。字号、行距或设备改变后重新分页，按相同文字偏移恢复。
- PDF：保存从零开始的 `page`。协议预留归一化 `y`，当前客户端按页恢复，写入 `y: 0`。
- `bookId` 为原始文件字节的 SHA-256，小写 64 位十六进制。改名不影响关联，文件内容变化会成为另一版本。

## API

客户端请求均通过 HTTPS，并携带个人连接码 `Authorization: Bearer …`。服务端仅保存连接码的 SHA-256 摘要并做恒定时间比较。第一版只服务单个个人空间，未实现多用户注册。

```text
GET /api/v1/health
GET /api/v1/books/{bookId}/progress
PUT /api/v1/books/{bookId}/progress
```

PUT 请求：

```json
{
  "locatorVersion": 1,
  "locator": { "type": "txt", "offset": 120 },
  "progress": 0.25,
  "baseRevision": 2,
  "deviceId": "per-install-device-id",
  "operationId": "unique-operation-id"
}
```

服务端使用 Cosmos DB ETag 做条件更新；首次写入使用 create 防止并发覆盖。版本不匹配返回 409 和当前云端位置。只保留最近 32 次操作的幂等回执，不保存完整阅读历史。

相同操作 ID 和相同内容的重试返回原结果；同一个操作 ID 被用于不同内容则拒绝。不会使用客户端时间或“读得更远”决定覆盖顺序。

## 本机数据

IndexedDB `leaf-reader`，schema v2。

- `books`：书架元数据、定位信息、书签、云端版本、待同步标记和操作 ID。
- `files`：导入时写入一次的文件数据。
- v1 升级会在一个数据库升级事务中迁移原有文件，保留进度与书签。

保存进度采用串行队列。连接码不进入 IndexedDB、书架数据或发布包。macOS 使用 Secure Enclave 与 AES-GCM 持久保存；HarmonyOS 适配层使用 Asset Store Kit。

## 平台边界

共享 TypeScript 运行于 WKWebView / ArkWeb。ArkTS 只实现平台桥接，并不直接执行 Vue / PDF.js 包。

鸿蒙工程以本机 SDK 元数据为准：26.0.0 Release，SDK build 26.0.0.105；最低兼容配置 6.1.1(24)。用户提供的知识文档中关于 API 26 Beta 的时间快照没有直接用作本机版本事实。

当前不依赖系统后台常驻任务。生命周期触发仅作补充，周期本机保存是进度可靠性的基础。
