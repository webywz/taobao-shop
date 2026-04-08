# 后端平台设计

## 1. 文档目标

本文档整合技术选型、卡密激活、API、状态机、数据模型、归档、图片格式转换和部署配置。

## 2. 技术选型

推荐默认组合：

- API：`NestJS`
- 数据库：`PostgreSQL`
- 队列 / 缓存：`Redis + BullMQ`
- 对象存储：`S3 / OSS`
- 监控：`Sentry + 结构化日志`

如果团队偏 Python，也可替换为 `FastAPI + PostgreSQL + Redis`，但首版优先统一 `TypeScript`。

## 3. 激活与授权模型

三类身份：

- 浏览器激活许可：`license_token`
- 插件设备：`device token`
- 单任务执行：`task token`

边界：

- `license_token` 代表已激活的使用资格
- `device token` 只访问设备和任务执行接口
- `task token` 绑定单个任务和设备，任务结束即失效
- 激活码只用于兑换，不用于后续业务请求

### 3.1 卡密生成建议

- 使用 CSPRNG 生成至少 `128 bit` 随机值
- 展示格式建议为 `ABCD-EFGH-JKLM-NPQR`
- 数据库不存明文卡密，只存 `code_hash`
- 对 `code_hash` 建唯一索引，冲突时重新生成

### 3.2 卡密兑换原则

- 卡密只允许兑换一次
- 兑换成功后生成一条 `license`
- `license` 与当前浏览器环境绑定
- 后续请求只校验 `license_token`

### 3.3 设备绑定原则

- 设备首次绑定当前 `license`
- 未绑定许可的设备不能拉取任务
- 如要支持换设备，建议使用“解绑旧设备再绑新设备”而不是多设备共享

## 4. 核心接口

### 4.1 激活与 Web 接口

- `POST /v1/licenses/redeem`
- `GET /v1/licenses/current`
- `POST /v1/extract/tasks`
- `GET /v1/extract/tasks/:taskId`
- `GET /v1/extract/tasks`
- `POST /v1/extract/tasks/:taskId/archive`
- `GET /v1/extract/tasks/:taskId/archive`
- `GET /v1/downloads/:taskId/archive`
- `GET /v1/assets/:assetId`
- `POST /v1/assets/:assetId/convert`
- `POST /v1/extract/tasks/:taskId/convert`

### 4.2 设备接口

- `POST /v1/devices/register`
- `POST /v1/devices/:deviceId/bind-license`
- `GET /v1/extract/tasks/queue/next`
- `POST /v1/extract/tasks/:taskId/claim`
- `POST /v1/devices/:deviceId/heartbeat`
- `POST /v1/extract/tasks/:taskId/progress`
- `POST /v1/uploads/presign`
- `POST /v1/uploads/complete`
- `POST /v1/extract/tasks/:taskId/result`
- `POST /v1/extract/tasks/:taskId/fail`

### 4.3 卡密激活接口建议

`POST /v1/licenses/redeem`

请求：

```json
{
  "activationCode": "ABCD-EFGH-JKLM-NPQR"
}
```

成功响应：

```json
{
  "licenseId": "lic_01J...",
  "licenseToken": "ltok_abc",
  "durationDays": 30,
  "expiresAt": "2026-05-08T00:00:00Z"
}
```

失败示例：

```json
{
  "error": {
    "code": "ACTIVATION_CODE_USED",
    "message": "activation code already redeemed",
    "requestId": "req_01J..."
  }
}
```

### 4.4 设备绑定接口建议

`POST /v1/devices/:deviceId/bind-license`

请求：

```json
{
  "licenseToken": "ltok_abc"
}
```

成功响应：

```json
{
  "deviceId": "dev_01J...",
  "licenseId": "lic_01J...",
  "status": "bound"
}
```

### 4.5 图片格式转换接口建议

`POST /v1/assets/:assetId/convert`

请求：

```json
{
  "targetFormat": "webp"
}
```

成功响应：

```json
{
  "jobId": "conv_01J...",
  "status": "processing"
}
```

批量转换：

`POST /v1/extract/tasks/:taskId/convert`

```json
{
  "targetFormat": "png",
  "assetType": "main"
}
```

### 4.6 主链路接口示例

推荐联调顺序：

1. `POST /v1/licenses/redeem`
2. `POST /v1/devices/register`
3. `POST /v1/devices/:deviceId/bind-license`
4. `POST /v1/extract/tasks`
5. `GET /v1/extract/tasks/queue/next`
6. `POST /v1/extract/tasks/:taskId/claim`
7. `POST /v1/extract/tasks/:taskId/result`
8. `POST /v1/extract/tasks/:taskId/archive`
9. `GET /v1/downloads/:taskId/archive`

## 5. 通用响应约定

失败响应统一：

```json
{
  "error": {
    "code": "PAGE_TIMEOUT",
    "message": "page did not stabilize in time",
    "requestId": "req_01J...",
    "retryable": true,
    "details": {}
  }
}
```

创建任务建议支持 `Idempotency-Key`。

补充约定：

- 成功响应统一返回 `requestId`
- 列表接口统一支持 `page`、`pageSize`
- 时间字段统一使用 ISO 8601 UTC
- 所有下载地址建议返回短时效签名 URL，而不是永久公开链接

## 6. 任务状态机

状态：

- `pending`
- `claimed`
- `running`
- `uploading`
- `completed`
- `failed`
- `expired`

允许流转：

- `pending -> claimed`
- `claimed -> running`
- `running -> uploading`
- `uploading -> completed`
- `pending|claimed|running|uploading -> failed`
- `pending|claimed -> expired`

关键规则：

- `pending` 10 分钟无人认领可过期
- `claimed` 2 分钟未进入 `running` 可回收
- `running` 60 秒无心跳视为异常
- 单任务总执行超时建议 10 分钟

## 7. 错误码

核心错误码：

- `INVALID_ACTIVATION_CODE`
- `ACTIVATION_CODE_USED`
- `LICENSE_INACTIVE`
- `INVALID_URL`
- `UNSUPPORTED_PLATFORM`
- `DEVICE_REVOKED`
- `TASK_TOKEN_INVALID`
- `TASK_ALREADY_CLAIMED`
- `TASK_STATUS_INVALID`
- `AUTH_REQUIRED`
- `PAGE_TIMEOUT`
- `PRODUCT_NOT_FOUND`
- `UNSUPPORTED_LAYOUT`
- `UPLOAD_FAILED`
- `ARCHIVE_FAILED`
- `CONVERT_FAILED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

规则：

- 对外错误码保持稳定
- 同一错误码的含义不能在版本迭代中漂移
- `details` 只放可选诊断信息，不承载前端关键逻辑

## 8. 核心数据模型

推荐最少表：

- `activation_codes`
- `licenses`
- `devices`
- `extract_tasks`
- `task_assets`
- `task_archives`
- `asset_convert_jobs`
- `audit_logs`

### 8.1 activation_codes

核心字段：

- `id`
- `code_hash`
- `batch_no`
- `status`
- `redeemed_at`
- `redeemed_by_license_id`
- `expires_at`
- `created_at`

### 8.2 licenses

核心字段：

- `id`
- `token_hash`
- `status`
- `duration_days`
- `bound_browser_fingerprint`
- `activated_at`
- `expires_at`
- `last_seen_at`

### 8.3 devices

核心字段：

- `id`
- `device_token_hash`
- `license_id`
- `browser_name`
- `extension_version`
- `status`
- `last_heartbeat_at`
- `last_ip`
- `created_at`

### 8.4 extract_tasks

核心字段：

- `id`
- `license_id`
- `device_id`
- `platform`
- `source_url`
- `canonical_url`
- `product_id`
- `title`
- `status`
- `error_code`
- `error_message`
- `extractor_version`
- `claimed_at`
- `started_at`
- `completed_at`
- `expired_at`
- `created_at`

### 8.5 task_assets

核心字段：

- `id`
- `task_id`
- `group_type`
- `sku_name`
- `source_url`
- `storage_key`
- `mime_type`
- `width`
- `height`
- `file_size`
- `sort_order`
- `created_at`

### 8.6 task_archives

核心字段：

- `id`
- `task_id`
- `status`
- `storage_key`
- `file_size`
- `retention_days`
- `generated_at`
- `expires_at`

### 8.7 asset_convert_jobs

核心字段：

- `id`
- `task_id`
- `asset_id`
- `target_format`
- `status`
- `output_storage_key`
- `retention_days`
- `error_code`
- `created_at`
- `completed_at`

## 9. 存储与对象路径规范

建议对象存储 key 规范：

- 原图：`tasks/{taskId}/original/{groupType}/{assetId}.{ext}`
- 转换图：`tasks/{taskId}/converted/{assetId}/{format}.{ext}`
- ZIP：`tasks/{taskId}/archive/{archiveId}.zip`

保留策略建议：

- ZIP 保留期允许 `3 | 7 | 30` 天
- 转换产物保留期允许 `3 | 7 | 30` 天
- 原图建议跟随任务长期保留或单独配置，避免因转换或归档过期导致结果页失真

建议 ZIP 目录结构：

- `main/`
- `sku/`
- `detail/`
- `manifest.json`

命名原则：

- 文件名优先使用稳定 `assetId`
- 不直接使用商品标题作为对象 key，避免编码和敏感字符问题
- ZIP 内可增加序号前缀，便于用户本地排序

## 10. 队列与后台任务

建议拆分队列：

- `archive_queue`
- `convert_queue`
- `task_timeout_queue`
- `cleanup_queue`

后台任务职责：

- 归档 Worker 负责拉取任务资产、打包 ZIP、回写状态
- 转换 Worker 负责图片转码和结果落存
- 超时 Worker 负责回收卡死任务和过期任务
- 清理 Worker 负责清除过期签名记录和临时文件

## 11. 有效期与限流建议

首版授权模型建议：

- 每个 `license` 只按时间有效期控制，不做任务额度
- `license` 到期后，创建任务、查看结果、下载 ZIP、格式转换都应失效
- `expires_at` 是唯一对外有效期判断依据

限流建议：

- 卡密兑换按 IP 和浏览器指纹限流
- 任务创建按 `license` 限流
- 设备心跳和轮询按 `device` 限流

## 12. 安全与鉴权

安全要求：

- `license_token`、`device token` 数据库内只存 hash
- 上传签名应仅允许当前任务的目标 key
- `task token` 必须包含任务和设备绑定关系
- 所有内部日志禁止输出完整 token、卡密明文和签名 URL

访问控制：

- Web 接口基于 `license_token`
- 设备接口基于 `device token`
- 结果下载需同时校验任务归属和许可归属
- 管理后台如后续增加，必须与用户侧 API 隔离

## 13. 部署拓扑建议

最小部署单元：

- `api`：对外 HTTP 服务
- `worker`：归档、转码、超时处理
- `postgres`
- `redis`
- `object storage`

环境建议：

- `dev`：允许本地对象存储替代方案
- `staging`：接近生产的真实插件联调环境
- `prod`：独立数据库、Redis、对象存储桶

## 14. 可观测性

建议监控指标：

- 卡密兑换成功率
- 任务创建成功率
- 平台维度提取成功率
- 任务平均执行时长
- ZIP 生成平均时长
- 图片转换成功率
- 各错误码占比

建议日志字段：

- `requestId`
- `licenseId`
- `deviceId`
- `taskId`
- `platform`
- `status`
- `errorCode`
- `latencyMs`

## 15. 备份与清理策略

- Postgres 做每日备份
- ZIP 与转换产物可按 `3天`、`7天`、`30天` 配置过期策略
- 原图是否长期保留要与成本策略一起明确，首版建议保留一段固定时间
- 任务删除如果后续支持，应采用软删除，不直接删除审计记录

## 16. 联调优先级

建议后端先交付：

1. 卡密兑换和当前许可查询
2. 设备注册和设备绑定
3. 任务创建、详情、列表
4. 设备拉队列、认领、心跳、失败回传
5. 上传签名和结果提交
6. ZIP 和转换异步任务

## 17. 鉴权头与通用字段约定

Web 侧请求头建议：

- `Authorization: Bearer {license_token}`
- `X-Request-Id: {requestId}`
- `Idempotency-Key: {idempotencyKey}`，仅创建类接口必填

插件侧请求头建议：

- `Authorization: Bearer {device_token}`
- `X-Extension-Version: {extensionVersion}`
- `X-Request-Id: {requestId}`

通用字段约定：

- 所有 `id` 使用字符串，不暴露数据库自增值
- `status`、`platform`、`groupType` 均使用稳定枚举
- `createdAt`、`updatedAt`、`completedAt` 等字段统一用 UTC ISO 字符串
- 所有列表接口响应建议包含 `items`、`page`、`pageSize`、`total`

## 18. 关键接口字段级协议

### 18.1 `POST /v1/devices/register`

请求：

```json
{
  "installationId": "ins_01J...",
  "browserName": "chrome",
  "browserVersion": "135.0.0.0",
  "os": "macOS",
  "extensionVersion": "1.0.0"
}
```

字段说明：

- `installationId`：插件本地安装实例唯一标识，重启后保持不变
- `browserName`：固定枚举，首版只接受 `chrome`
- `extensionVersion`：用于兼容矩阵判断

成功响应：

```json
{
  "deviceId": "dev_01J...",
  "deviceToken": "dtok_abc",
  "status": "active",
  "requestId": "req_01J..."
}
```

### 18.2 `POST /v1/extract/tasks`

请求：

```json
{
  "sourceUrl": "https://item.taobao.com/item.htm?id=123456"
}
```

字段规则：

- `sourceUrl`：必填，只允许单链接
- 服务端需完成平台识别和 URL 规范化
- 若 URL 不符合商品详情页规则，直接返回 `INVALID_URL` 或 `UNSUPPORTED_PLATFORM`

成功响应：

```json
{
  "taskId": "task_01J...",
  "platform": "taobao",
  "status": "pending",
  "sourceUrl": "https://item.taobao.com/item.htm?id=123456",
  "canonicalUrl": "https://item.taobao.com/item.htm?id=123456",
  "createdAt": "2026-04-08T12:00:00Z",
  "requestId": "req_01J..."
}
```

### 18.3 `GET /v1/extract/tasks/:taskId`

成功响应建议：

```json
{
  "taskId": "task_01J...",
  "platform": "taobao",
  "status": "completed",
  "title": "商品标题",
  "sourceUrl": "https://item.taobao.com/item.htm?id=123456",
  "canonicalUrl": "https://item.taobao.com/item.htm?id=123456",
  "errorCode": null,
  "errorMessage": null,
  "extractorVersion": "1.0.0",
  "counts": {
    "main": 5,
    "sku": 3,
    "detail": 12
  },
  "archive": {
    "status": "ready",
    "downloadUrl": "https://...",
    "expiresAt": "2026-04-08T14:00:00Z"
  },
  "assets": {
    "main": [],
    "sku": [],
    "detail": []
  },
  "createdAt": "2026-04-08T12:00:00Z",
  "completedAt": "2026-04-08T12:00:45Z",
  "requestId": "req_01J..."
}
```

字段规则：

- `counts` 必须始终返回，供前端快速渲染摘要
- `archive.status` 建议使用 `not_started | processing | ready | failed`
- `assets` 可在大结果集场景下改为分页，但首版建议直接返回全部

### 18.4 `GET /v1/extract/tasks`

查询参数建议：

- `page`
- `pageSize`
- `status`
- `platform`
- `keyword`

成功响应：

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 128,
  "requestId": "req_01J..."
}
```

### 18.5 `GET /v1/extract/tasks/queue/next`

响应规则：

- 无任务时返回 `204`
- 有任务时仅返回一个任务，避免插件并发执行复杂度
- 只返回当前 `license` 下当前设备可认领的任务

成功响应：

```json
{
  "taskId": "task_01J...",
  "platform": "taobao",
  "sourceUrl": "https://item.taobao.com/item.htm?id=123456",
  "taskToken": "ttok_abc",
  "expiresAt": "2026-04-08T12:10:00Z",
  "requestId": "req_01J..."
}
```

### 18.6 `POST /v1/extract/tasks/:taskId/claim`

请求：

```json
{
  "taskToken": "ttok_abc"
}
```

成功响应：

```json
{
  "taskId": "task_01J...",
  "status": "claimed",
  "claimedAt": "2026-04-08T12:00:05Z",
  "requestId": "req_01J..."
}
```

### 18.7 `POST /v1/devices/:deviceId/heartbeat`

请求：

```json
{
  "currentTaskId": "task_01J...",
  "taskStatus": "running",
  "sentAt": "2026-04-08T12:00:20Z"
}
```

字段规则：

- `currentTaskId` 可为空，表示设备空闲
- `taskStatus` 仅允许 `idle | claimed | running | uploading`

### 18.8 `POST /v1/uploads/presign`

请求：

```json
{
  "taskId": "task_01J...",
  "files": [
    {
      "clientAssetId": "asset_local_1",
      "groupType": "main",
      "ext": "jpg",
      "mimeType": "image/jpeg"
    }
  ]
}
```

成功响应：

```json
{
  "uploads": [
    {
      "clientAssetId": "asset_local_1",
      "assetId": "asset_01J...",
      "storageKey": "tasks/task_01J.../original/main/asset_01J....jpg",
      "method": "PUT",
      "uploadUrl": "https://..."
    }
  ],
  "requestId": "req_01J..."
}
```

### 18.9 `POST /v1/extract/tasks/:taskId/result`

请求：

```json
{
  "taskToken": "ttok_abc",
  "title": "商品标题",
  "productId": "123456",
  "canonicalUrl": "https://item.taobao.com/item.htm?id=123456",
  "extractorVersion": "1.0.0",
  "images": {
    "main": [],
    "sku": [],
    "detail": []
  },
  "meta": {
    "capturedAt": "2026-04-08T12:00:40Z"
  }
}
```

规则：

- `result` 接口只接受已认领且未完成任务
- 服务端入库成功后应异步触发 ZIP 生成
- 同一 `taskId` 重复提交必须幂等

### 18.10 `POST /v1/extract/tasks/:taskId/fail`

请求：

```json
{
  "taskToken": "ttok_abc",
  "errorCode": "PAGE_TIMEOUT",
  "errorMessage": "page did not stabilize in time",
  "retryable": true,
  "diagnostics": {
    "finalUrl": "https://item.taobao.com/item.htm?id=123456"
  }
}
```

## 19. 数据库字段类型与索引草案

建议类型：

- 主键 `id`：`varchar(32)` 或 `text`
- 枚举字段：数据库枚举或 `varchar(32)` + 应用层校验
- URL：`text`
- 时间：`timestamptz`
- 诊断字段：`jsonb`
- 数量字段：`integer`

关键索引建议：

- `activation_codes(code_hash)` 唯一索引
- `licenses(token_hash)` 唯一索引
- `devices(device_token_hash)` 唯一索引
- `extract_tasks(license_id, created_at desc)` 普通索引
- `extract_tasks(status, created_at asc)` 队列索引
- `task_assets(task_id, group_type, sort_order)` 复合索引
- `asset_convert_jobs(task_id, status)` 复合索引

关键约束建议：

- `extract_tasks.status` 只能落在状态机允许枚举
- `task_assets.group_type` 只能是 `main | sku | detail`
- `devices.license_id` 为空时不能认领任务
- `task_archives.retention_days` 只能是 `3 | 7 | 30`
- `asset_convert_jobs.retention_days` 只能是 `3 | 7 | 30`

## 20. 结果资产与 ZIP 结构定稿建议

单个 `asset` 建议返回：

```json
{
  "assetId": "asset_01J...",
  "groupType": "main",
  "skuName": null,
  "sourceUrl": "https://...",
  "previewUrl": "https://...",
  "downloadUrl": "https://...",
  "mimeType": "image/jpeg",
  "width": 800,
  "height": 800,
  "fileSize": 123456,
  "sortOrder": 1
}
```

ZIP 内 `manifest.json` 建议包含：

- `taskId`
- `platform`
- `sourceUrl`
- `canonicalUrl`
- `title`
- `extractorVersion`
- `capturedAt`
- `counts`
- `assets`

ZIP 命名建议：

- `{platform}_{productId}_{taskId}.zip`
- 若 `productId` 缺失，则退化为 `{platform}_{taskId}.zip`

## 21. 状态补偿与异常处理

补偿规则建议：

- `claimed` 超时未运行，自动回退为 `pending` 或直接 `expired`
- `running` 超时无心跳，先标记失败并记录 `PAGE_TIMEOUT` 或 `DEVICE_OFFLINE`
- `uploading` 中断时允许设备重试完成上传，不直接重复开新任务
- `archive` 失败允许手动或自动重试，不影响原始图片可下载
- `convert` 失败不影响原任务状态，单独记录在转换任务表

人工排查最少需要能按以下维度检索：

- `taskId`
- `licenseId`
- `deviceId`
- `platform`
- `errorCode`

## 22. 枚举值定稿建议

建议统一枚举：

- `platform`: `taobao | pdd`
- `task.status`: `pending | claimed | running | uploading | completed | failed | expired`
- `archive.status`: `not_started | processing | ready | failed`
- `convert.status`: `pending | processing | completed | failed`
- `device.status`: `active | revoked | offline`
- `groupType`: `main | sku | detail`
- `retentionDays`: `3 | 7 | 30`

接口约束：

- 所有枚举值对外只增不改，避免前端分支失效
- 未识别枚举值时，前端默认按失败或未知态展示
- 后端日志允许记录内部细分状态，但对外接口只暴露稳定枚举

## 23. 归档与格式转换接口补充协议

### 23.1 `POST /v1/extract/tasks/:taskId/archive`

用途：

- 手动触发 ZIP 打包
- 若已存在可用 ZIP，则直接返回当前状态

成功响应：

```json
{
  "taskId": "task_01J...",
  "archiveId": "arc_01J...",
  "status": "processing",
  "requestId": "req_01J..."
}
```

### 23.2 `GET /v1/extract/tasks/:taskId/archive`

成功响应：

```json
{
  "taskId": "task_01J...",
  "archiveId": "arc_01J...",
  "status": "ready",
  "retentionDays": 7,
  "downloadUrl": "https://...",
  "fileSize": 1234567,
  "expiresAt": "2026-04-08T14:00:00Z",
  "requestId": "req_01J..."
}
```

### 23.3 `POST /v1/assets/:assetId/convert`

规则：

- 只允许对当前 `license` 下资源发起转换
- 相同 `assetId + format` 的重复请求建议直接复用已有任务
- 转换不应修改原图 URL

请求：

```json
{
  "targetFormat": "webp",
  "retentionDays": 7
}
```

成功响应：

```json
{
  "jobId": "conv_01J...",
  "assetId": "asset_01J...",
  "targetFormat": "webp",
  "retentionDays": 7,
  "status": "processing",
  "requestId": "req_01J..."
}
```

### 23.4 `POST /v1/extract/tasks/:taskId/convert`

请求：

```json
{
  "targetFormat": "png",
  "assetType": "detail",
  "retentionDays": 7
}
```

成功响应：

```json
{
  "taskId": "task_01J...",
  "targetFormat": "png",
  "assetType": "detail",
  "retentionDays": 7,
  "jobCount": 12,
  "status": "processing",
  "requestId": "req_01J..."
}
```

## 24. 失败响应与用户动作建议

建议后端在稳定错误码之外，内部维护对应的用户动作：

- `INVALID_ACTIVATION_CODE`
  - 用户动作：提示检查卡密输入格式
- `ACTIVATION_CODE_USED`
  - 用户动作：提示卡密已被兑换，联系发卡方
- `LICENSE_INACTIVE`
  - 用户动作：跳回激活页重新校验
- `INVALID_URL`
  - 用户动作：提示输入商品详情页链接
- `UNSUPPORTED_PLATFORM`
  - 用户动作：提示当前仅支持淘宝 / 拼多多
- `AUTH_REQUIRED`
  - 用户动作：提示在浏览器中先登录商品平台
- `PAGE_TIMEOUT`
  - 用户动作：提示稍后重试，或确认本地页面可正常打开
- `PRODUCT_NOT_FOUND`
  - 用户动作：提示商品不存在、下架或链接失效
- `UNSUPPORTED_LAYOUT`
  - 用户动作：提示当前页面结构暂不支持，进入人工排查
- `UPLOAD_FAILED`
  - 用户动作：提示本地网络或对象存储上传失败，可重试
- `ARCHIVE_FAILED`
  - 用户动作：提示稍后重新打包
- `CONVERT_FAILED`
  - 用户动作：提示重新发起格式转换

建议失败响应额外保留：

- `retryable`
- `requestId`
- `details.finalUrl`
- `details.stage`

## 25. 开发期建议优先实现的最小接口集

如果需要尽快开工，最小接口集建议先只实现：

1. `POST /v1/licenses/redeem`
2. `GET /v1/licenses/current`
3. `POST /v1/devices/register`
4. `POST /v1/devices/:deviceId/bind-license`
5. `POST /v1/extract/tasks`
6. `GET /v1/extract/tasks/:taskId`
7. `GET /v1/extract/tasks/queue/next`
8. `POST /v1/extract/tasks/:taskId/claim`
9. `POST /v1/devices/:deviceId/heartbeat`
10. `POST /v1/uploads/presign`
11. `POST /v1/extract/tasks/:taskId/result`
12. `POST /v1/extract/tasks/:taskId/fail`

有了这 12 个接口，就能先跑通激活、任务、插件执行和结果回传的首个闭环。

## 26. 当前建议默认值

如果不再单独开会拍板，建议按以下默认值开发：

- 一个 `license` 首版只允许绑定 `1` 个设备
- 同一 `license` 允许存在多条历史任务，但同一时间只建议 `1` 个活跃执行任务
- 卡密按时间生效，核心字段为 `durationDays + expiresAt`
- ZIP 与转换产物保留期只开放 `3天 | 7天 | 30天`
- 原图默认长期保留，后续再根据成本决定是否过期
- 第一阶段验收先以“主图闭环”作为最低目标
