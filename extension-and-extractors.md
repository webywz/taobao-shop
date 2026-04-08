# 插件与提取器设计

## 1. 文档目标

本文档定义浏览器插件架构、执行流程、权限边界，以及淘宝 / 拼多多提取器规则。

## 2. 技术选型

- `Plasmo`
- `TypeScript`
- `Chrome Manifest V3`

首版只支持桌面 Chrome。

## 3. Manifest 权限建议

最小权限集：

- `storage`
- `tabs`
- `scripting`
- `alarms`
- `activeTab`
- 淘宝 / 拼多多域名 `host_permissions`

不建议首版申请任意域名权限。

## 4. 模块划分

- `background`：设备注册、许可绑定、拉任务、认领、心跳、标签页控制
- `content script`：读取页面 DOM 和脚本数据
- `extractors`：平台识别和图片分类
- `upload`：获取上传签名并直传对象存储
- `popup / options`：展示插件状态和调试信息

建议目录：

- `src/background/`
- `src/content/`
- `src/extractors/taobao/`
- `src/extractors/pdd/`
- `src/shared/types/`
- `src/shared/http/`
- `src/popup/`

## 5. 标准执行流程

1. 插件首次启动时注册设备
2. 插件绑定当前激活许可
3. 后台轮询获取任务
4. 认领任务
5. 打开非激活标签页
6. 等待页面稳定
7. 选择平台 extractor
8. 生成 `ProductManifest`
9. 上传素材
10. 提交结果或失败
11. 关闭标签页

补充规则：

- 同一设备首版只串行执行一个任务
- 标签页执行完成后应主动清理，避免浏览器堆积
- 执行中的任务必须持续发送心跳

## 6. 页面稳定条件

建议组合判断：

- `document.readyState === "complete"`
- 目标图片区块已出现
- 关键资源一段时间内不再新增
- 超时保护生效

建议实现：

- 先等待 `load` 或 10 秒超时
- 再观察目标节点和图片请求数量 1 到 2 秒是否稳定
- 若页面持续跳动，按超时失败处理，而不是无限等待

## 7. 提取器输出结构

```ts
export interface ProductManifest {
  platform: "taobao" | "pdd"
  sourceUrl: string
  canonicalUrl: string
  productId?: string
  title?: string
  images: {
    main: ImageAsset[]
    sku: SkuImageAsset[]
    detail: ImageAsset[]
  }
  meta: {
    capturedAt: string
    extractorVersion: string
  }
}
```

`ImageAsset` 建议最少包含：

- `sourceUrl`
- `normalizedUrl`
- `groupType`
- `sortOrder`
- `width`
- `height`

`SkuImageAsset` 建议额外包含：

- `skuName`
- `skuValueId`

## 8. 数据源优先级

统一原则：

1. 页面内嵌 JSON
2. 首屏脚本变量
3. 明确 DOM 区块
4. 兜底图片链接扫描

统一清洗规则：

- 去掉无意义 query 参数
- 将相同图片不同尺寸链接归一到同一主资源
- 过滤 `data:`、占位图、雪碧图、图标资源
- 去重时优先保留更高清版本

## 9. 淘宝提取规则

### 9.1 URL 识别

- 识别 `item.taobao.com/item.htm?id=...`
- 规范化输出 `canonicalUrl`
- 提取 `id` 作为 `productId`

### 9.2 主图

- 从轮播图或商品主图数组提取
- 去重并保持顺序

### 9.3 SKU 图

- 优先读取规格项绑定图片
- 输出 `skuName`

### 9.4 详情图

- 从详情描述区提取
- 排除装饰图、按钮图和明显无关小图
- 如果详情区为异步加载 iframe 或脚本拼装，需要优先解析结构化数据

## 10. 拼多多提取规则

### 10.1 URL 识别

- 识别 `mobile.yangkeduo.com/goods.html?goods_id=...`
- 规范化输出 `canonicalUrl`
- 提取 `goods_id` 作为 `productId`

### 10.2 主图

- 从轮播区或主图数组提取
- 去重并保持顺序

### 10.3 SKU 图

- 识别规格项关联图片
- 尽量输出完整 `skuName`

### 10.4 详情图

- 从详情图片区提取
- 排除导航、浮层和营销角标
- 若存在懒加载长图，应等待滚动或节点注入稳定后再采集

## 11. 常见错误与重试

常见错误：

- `AUTH_REQUIRED`
- `PAGE_TIMEOUT`
- `PRODUCT_NOT_FOUND`
- `UNSUPPORTED_LAYOUT`
- `UPLOAD_FAILED`

重试建议：

- `PAGE_TIMEOUT`：页面重载后重试 1 次
- `UPLOAD_FAILED`：自动重试 2 到 3 次
- `AUTH_REQUIRED`：不自动重试
- `UNSUPPORTED_LAYOUT`：不自动重试

失败上报要求：

- 必须带 `taskId`
- 必须带稳定 `errorCode`
- 尽量带上 `finalUrl`
- 可附带压缩后的诊断信息，例如命中的选择器或数据源名称

## 12. 插件与 Web 通信

建议方式：

- Web 通过 `window.postMessage` 检测插件状态
- `content script` 校验 `origin`
- Web 将当前 `license_token` 同步给插件
- 后续所有任务仍由插件向后端拉取，不由 Web 直接下发任意 URL

建议消息类型：

- `PLUGIN_PING`
- `PLUGIN_STATUS`
- `BIND_LICENSE`
- `OPEN_HELP`

## 13. 调试与观测

建议记录：

- `taskId`
- `platform`
- `extractorVersion`
- 命中的数据源
- 主图 / SKU 图 / 详情图数量
- 最终 URL

开发期建议保留“测试当前标签页”模式，方便单独调 extractor。

建议增加调试面板：

- 当前设备状态
- 当前绑定许可摘要
- 最近一次心跳时间
- 最近一次任务结果
- 手动触发“重新绑定”按钮

## 14. 回归样本要求

每个平台至少准备：

- 普通商品
- 多规格商品
- 有 SKU 图商品
- 无 SKU 图商品
- 下架或失效商品
- 需要登录的商品

样本管理建议：

- 每个平台维护固定样本清单
- 记录样本最后验证日期
- 标记高风险页面类型，例如异步详情区、多规格、长图详情

## 15. 当前延期项

- Firefox / Edge 适配
- 移动端浏览器
- 批量并发执行
- 复杂风控场景自动处理

## 16. 轮询与心跳策略

- 空队列轮询建议指数退避，例如 3 秒、5 秒、10 秒
- 任务执行中每 10 到 15 秒发送心跳
- 后端返回限流或服务异常时，插件需要退避重试
- 插件重启后应恢复设备身份，而不是重复注册新设备

## 17. 上传流程建议

1. 插件整理出待上传素材列表
2. 向后端请求 presign
3. 逐个或小批量直传对象存储
4. 上传成功后汇总 ETag 或结果摘要
5. 调用 complete 接口确认
6. 最终提交 `manifest`

要求：

- 上传失败必须可重试
- 相同资源重复上传可按 hash 去重
- 所有上传都必须绑定 `taskId`

## 18. 安全边界

- 不在页面上下文暴露完整 `device token`
- `content script` 与页面通信必须校验消息来源
- 插件只申请任务所需最小权限
- 任何调试日志默认不打印完整卡密和 token

## 19. Web 与插件通信协议细化

推荐统一消息信封：

```json
{
  "source": "tb-pdd-image-saas-web",
  "type": "PLUGIN_PING",
  "payload": {},
  "requestId": "req_01J..."
}
```

字段规则：

- `source`：固定值，便于插件过滤消息来源
- `type`：消息类型枚举
- `payload`：消息体
- `requestId`：用于请求响应配对和排查

建议消息类型与载荷：

- `PLUGIN_PING`
  - 请求：空对象
  - 响应：`{ "installed": true, "version": "1.0.0" }`
- `PLUGIN_STATUS`
  - 响应：`{ "installed": true, "bound": true, "deviceId": "dev_01J...", "licenseId": "lic_01J..." }`
- `BIND_LICENSE`
  - 请求：`{ "licenseToken": "ltok_abc" }`
  - 响应：`{ "success": true, "deviceId": "dev_01J..." }`
- `OPEN_HELP`
  - 请求：`{ "target": "install" }`

失败响应建议：

```json
{
  "source": "tb-pdd-image-saas-extension",
  "type": "PLUGIN_STATUS",
  "payload": {
    "success": false,
    "errorCode": "DEVICE_NOT_BOUND"
  },
  "requestId": "req_01J..."
}
```

## 20. 插件运行时序

推荐运行顺序：

1. 插件启动，读取本地 `installationId` 和历史 `deviceToken`
2. 若无 `deviceToken`，调用注册接口换取 `deviceId` 和 `deviceToken`
3. Web 激活成功后，通过 `BIND_LICENSE` 将 `license_token` 发给插件
4. 插件完成绑定并持久化绑定状态
5. `background` 开始轮询 `queue/next`
6. 拿到任务后，先 `claim`
7. 打开标签页，等待页面稳定
8. 注入或唤起 `content script`
9. 执行平台 extractor，生成 `manifest`
10. 调用 `presign`，直传图片
11. 调用 `complete` 确认上传
12. 调用 `result` 提交结构化结果
13. 关闭标签页，回到空闲轮询

失败时序：

1. 提取失败后优先归类稳定错误码
2. 若可重试，先在插件内部完成有限次重试
3. 仍失败则调用 `fail`
4. 关闭标签页并恢复空闲状态

## 21. 本地存储建议

建议持久化：

- `installationId`
- `deviceId`
- `deviceToken`
- `licenseId`
- `lastBoundAt`
- `extensionVersion`

不建议持久化：

- 明文卡密
- 完整历史签名 URL
- 过多页面诊断日志

## 22. 提取器实现冻结项

开发前建议先冻结这几项，避免前后端返工：

- 平台 URL 识别规则
- 主图、SKU 图、详情图的最小字段集合
- 图片去重规则
- 详情图是否允许滚动触发懒加载
- 无 SKU 图时返回空数组还是跳过字段
- 登录态失败时统一报 `AUTH_REQUIRED`

## 23. 淘宝字段映射建议

提取结果至少映射出这些字段：

- `platform`
  - 固定值：`taobao`
- `sourceUrl`
  - 来源：用户提交原始链接
- `canonicalUrl`
  - 来源：规范化后的商品详情页链接
- `productId`
  - 来源：URL `id` 参数
- `title`
  - 来源优先级：结构化数据 > 页面标题 DOM
- `images.main`
  - 来源优先级：商品主图数组 > 轮播图 DOM
- `images.sku`
  - 来源优先级：规格数据中的图片绑定 > 规格 DOM
- `images.detail`
  - 来源优先级：详情区结构化数据 > 详情 DOM > 兜底长图扫描

主图排序建议：

- 优先按页面展示顺序
- 去重后保持原有相对顺序

SKU 图建议字段：

- `skuName`
- `sourceUrl`
- `normalizedUrl`
- `sortOrder`

详情图过滤建议：

- 过滤宽高明显过小的资源
- 过滤按钮、图标、店铺角标
- 过滤重复切片图和占位图

## 24. 拼多多字段映射建议

提取结果至少映射出这些字段：

- `platform`
  - 固定值：`pdd`
- `sourceUrl`
  - 来源：用户提交原始链接
- `canonicalUrl`
  - 来源：规范化后的商品详情页链接
- `productId`
  - 来源：URL `goods_id` 参数
- `title`
  - 来源优先级：页面内商品数据 > 标题 DOM
- `images.main`
  - 来源优先级：轮播图数组 > 主图 DOM
- `images.sku`
  - 来源优先级：规格数据中的图片字段 > 规格 DOM
- `images.detail`
  - 来源优先级：详情图片区数据 > 详情 DOM > 懒加载补采

拼多多细节建议：

- 对移动样式页面优先读取结构化数据，不要只依赖可见 DOM
- 对长图详情允许有限度滚动一次，触发懒加载后再采集
- 若详情图由接口异步灌入，优先等待目标节点稳定而不是固定睡眠

## 25. 图片清洗与去重规则细化

统一规则建议：

- 去掉明显无意义 query 参数，例如尺寸裁切、压缩质量、追踪参数
- 相同主资源链接只保留一张
- 同图多尺寸时优先保留更高清的一张
- 对 `webp`、`jpg`、`png` 的同源资源，优先保留原始质量更高版本

过滤建议：

- 宽或高小于 80 的图片默认过滤
- logo、icon、sprite、button、avatar 等命名特征优先过滤
- `data:`、`blob:` 链接默认不入最终结果，除非无法取得原始资源链接

## 26. 提取成功判定建议

建议最低成功标准：

- 至少提取到 1 张 `main`
- 成功返回 `platform`、`sourceUrl`、`canonicalUrl`、`capturedAt`
- 所有图片分组字段都存在，即使为空数组

建议增强成功标准：

- 若页面存在明确 SKU 图，应至少命中 1 张 `sku`
- 若页面存在详情图区，应至少命中 1 张 `detail`

不建议直接判失败的场景：

- 没有 SKU 图的商品
- 没有详情图的精简商品页
- 标题缺失但图片提取成功
