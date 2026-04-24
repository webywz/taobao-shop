# 淘宝商品采集桌面端架构方案

## 1. 目标定义

目标产品形态：

- 用户在桌面端输入淘宝商品链接
- 程序打开受控浏览器页面
- 用户在必要时手动完成登录、滑块或验证码
- 程序在当前会话中提取商品页可见内容与页面请求数据
- 最终导出为结构化结果，例如 `JSON / CSV / Excel / 图片资源目录`

不建议把目标定义为“稳定抓到所有内容”。更现实的目标是：

- 尽可能提取商品基础信息、媒体、SKU、属性、详情描述
- 对需要登录或动态加载的数据，依赖真实浏览器会话获取
- 当页面结构变化或风控升级时，允许部分字段降级或失败重试

## 2. 推荐技术路线

推荐组合：

- 桌面壳：`Tauri v2`
- 前端界面：`Vue 3 + TypeScript`
- 浏览器自动化：`Playwright`
- 抽取引擎运行时：`Node.js sidecar`
- 本地存储：`SQLite`
- 导出：`JSON / CSV / XLSX`

核心原因：

- `Tauri` 适合做轻量桌面壳、配置管理、文件系统访问和原生打包
- `Playwright` 适合处理淘宝这类强动态、强前端渲染页面
- `Node sidecar` 比“纯 Rust 内嵌爬虫”更现实，Playwright 生态成熟，调试成本低

## 3. 总体架构

推荐采用三层结构，而不是把采集逻辑直接塞进前端：

1. `Tauri App`
   负责界面、任务管理、配置、文件导出、日志展示
2. `Collector Sidecar`
   由 Tauri 启动的本地 `Node.js` 进程，内部运行 Playwright
3. `Browser Session`
   真实 Chromium 浏览器上下文，用于登录、打开商品页、提取 DOM 与网络响应

### 3.1 逻辑关系

```text
Vue UI
  -> Tauri command
  -> Sidecar manager
  -> Node collector service
  -> Playwright browser/context/page
  -> extractor pipeline
  -> normalized product json
  -> SQLite / export files
```

### 3.2 为什么不建议“前端直接调 Playwright”

- Tauri 前端运行在 WebView，不能直接承担浏览器自动化职责
- 自动化逻辑、登录态、日志、重试策略更适合独立进程管理
- 侧车进程崩溃后可单独拉起，避免把桌面 UI 一起拖死

## 4. 模块划分

### 4.1 Tauri 端职责

`src-tauri` 负责：

- 启动与管理 sidecar 进程
- 提供 `invoke` 命令给前端
- 保存本地配置
- 管理任务状态缓存
- 处理导出路径、文件选择、系统通知
- 接收采集进度事件并推送到前端

前端 `src` 负责：

- 输入商品链接
- 展示任务状态、日志、截图、提取结果
- 提供“打开浏览器登录”“开始采集”“重新采集”“导出数据”等操作

### 4.2 Sidecar 端职责

`collector` 服务负责：

- 启动 Playwright 浏览器
- 管理 `browser / context / page`
- 维持登录态与 cookie 持久化
- 打开商品页并等待页面稳定
- 监听网络请求与响应
- 提取 DOM 中可见数据
- 合并多来源数据并标准化
- 返回统一数据结构

### 4.3 抽取管道职责

抽取建议拆成独立阶段：

1. `url_resolver`
   统一处理短链、参数清洗、跳转后的真实商品 URL
2. `page_loader`
   负责打开页面、等待核心节点出现、等待懒加载完成
3. `network_sniffer`
   监听页面 XHR / fetch / document 请求，收集候选接口返回
4. `dom_extractor`
   从渲染后的 DOM 中提取标题、价格、店铺名、详情区域、SKU 文本等
5. `state_extractor`
   从页面挂载的初始化数据或内联脚本中提取 JSON 状态
6. `normalizer`
   把多个来源映射到统一 `ProductSnapshot`
7. `asset_downloader`
   下载主图、详情图、视频封面等资源

## 5. 推荐目录结构

```text
taobao-collector-desktop/
├─ src/
│  ├─ app/
│  ├─ views/
│  ├─ components/
│  ├─ composables/
│  ├─ services/
│  ├─ stores/
│  ├─ router/
│  └─ types/
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/
│  │  ├─ sidecar/
│  │  ├─ db/
│  │  ├─ events/
│  │  └─ main.rs
│  ├─ binaries/
│  └─ tauri.conf.json
├─ collector/
│  ├─ src/
│  │  ├─ server/
│  │  ├─ browser/
│  │  ├─ extractors/
│  │  ├─ parsers/
│  │  ├─ models/
│  │  ├─ storage/
│  │  └─ index.ts
│  ├─ package.json
│  └─ playwright.config.ts
└─ docs/
```

## 6. 进程通信设计

推荐 `Tauri <-> sidecar` 之间走本地 HTTP 或本地 IPC，不建议前端直接连 sidecar。

推荐方式：

- `Tauri` 启动 sidecar
- sidecar 在 `127.0.0.1` 随机端口启动本地服务
- `Tauri` 保存端口并通过 command 暴露给前端
- 前端所有采集操作都经由 `Tauri invoke`

这样做的好处：

- 端口管理、权限控制、异常恢复更清晰
- 不把采集服务直接暴露给前端页面
- 后续可以替换为 socket 或 protobuf，不影响 UI

### 6.1 建议接口

```text
POST /session/start
POST /session/login/open
GET  /session/status
POST /collect/product
GET  /tasks/:id
POST /tasks/:id/cancel
POST /export/:id
```

### 6.2 事件流

推荐事件：

- `collector:booting`
- `collector:browser_opened`
- `collector:waiting_login`
- `collector:page_loaded`
- `collector:extracting_dom`
- `collector:capturing_network`
- `collector:normalizing`
- `collector:completed`
- `collector:failed`

## 7. 浏览器与登录态设计

淘宝场景下，登录态是架构核心，不要把它当成附属功能。

推荐策略：

- 使用持久化 `browser context`
- cookie、本地存储、会话信息保存到本地 profile 目录
- 用户首次手动登录一次
- 后续任务复用同一个 profile

### 7.1 推荐会话模型

每个用户一个本地 profile：

```text
~/Library/Application Support/your-app/profiles/default/
```

在 Playwright 中建议使用：

- `launchPersistentContext`

这样更适合：

- 维持淘宝登录态
- 保留站点本地缓存
- 降低每次重新登录成本

### 7.2 登录流程

1. 用户点击“打开登录窗口”
2. sidecar 打开受控 Chromium
3. 用户自行完成登录和验证
4. sidecar 检测到登录成功标志
5. Tauri 记录当前 profile 可用

登录成功判定可以结合：

- cookie 是否出现关键登录 cookie
- 页面是否展示账号头像或昵称
- 访问一个仅登录后可见的轻量页面做确认

## 8. 商品采集流程

### 8.1 单商品主流程

1. 用户输入淘宝商品链接
2. 前端调用 `collectProduct(url)`
3. Tauri 把任务交给 sidecar
4. sidecar 规范化 URL
5. sidecar 用当前登录态打开商品页
6. 等待首屏稳定和关键节点渲染完成
7. 并行执行：
   - DOM 提取
   - 网络监听
   - 页面状态提取
8. 归一化字段
9. 保存任务结果与资源文件
10. 回传前端展示并支持导出

### 8.2 等待策略

不要只依赖 `networkidle`，淘宝页面常有持续请求。推荐组合条件：

- 标题节点出现
- 价格区域出现
- SKU 区域或详情容器出现
- 滚动加载详情区域完成
- 关键接口返回或超时降级

## 9. 数据模型设计

建议先定义统一结构，避免一开始直接把原始页面字段灌进数据库。

```ts
type ProductSnapshot = {
  taskId: string;
  sourceUrl: string;
  finalUrl: string;
  platform: "taobao";
  collectedAt: string;
  title?: string;
  subtitle?: string;
  price?: {
    current?: string;
    original?: string;
    currency?: string;
  };
  salesText?: string;
  shop?: {
    name?: string;
    url?: string;
  };
  media: {
    images: string[];
    detailImages: string[];
    videoUrl?: string;
  };
  skus: Array<{
    skuId?: string;
    name: string;
    price?: string;
    stockText?: string;
    attributes: Record<string, string>;
  }>;
  attributes: Record<string, string>;
  descriptionHtml?: string;
  descriptionText?: string;
  raw: {
    dom?: unknown;
    state?: unknown;
    network?: unknown[];
  };
};
```

这里保留 `raw` 很重要，后续页面结构变化时，便于回放和修复解析逻辑。

## 10. 抽取策略

不要押注单一来源。推荐“三路合并”：

### 10.1 DOM 抽取

适合拿到：

- 标题
- 当前展示价格
- 店铺名
- 页面可见促销文案
- 部分 SKU 展示文本
- 详情页渲染内容

优点：

- 直观
- 调试简单

问题：

- 选择器容易变
- 有些数据只显示摘要，不是完整结构化字段

### 10.2 页面状态抽取

目标：

- 从页面内联脚本、全局变量、初始化状态对象中找商品结构化数据

适合拿到：

- 商品 ID
- SKU 结构
- 属性表
- 媒体列表
- 店铺 ID

优点：

- 结构化程度更高

问题：

- 字段路径会变
- 页面可能做混淆或裁剪

### 10.3 网络响应抽取

目标：

- 监听页面加载过程中触发的接口

适合拿到：

- 动态价格
- SKU 变体
- 详情图资源
- 推荐模块之外的核心业务数据

优点：

- 更接近真实业务数据

问题：

- 接口字段可能依赖登录态
- 参数签名、时效参数、上下文依赖都可能变化

### 10.4 归一化策略

字段优先级建议：

- 价格：`network > state > dom`
- SKU：`state > network > dom`
- 标题：`dom > state`
- 详情：`dom + network 合并`
- 店铺信息：`state > dom`

## 11. 资源下载设计

采集结果通常不止 JSON，还包括图片和详情资源。

推荐产物结构：

```text
exports/
└─ task-20260424-001/
   ├─ product.json
   ├─ product.xlsx
   ├─ cover/
   ├─ detail/
   └─ debug/
      ├─ page.html
      ├─ state.json
      ├─ network.json
      └─ screenshot.png
```

`debug` 目录很有价值：

- 用于排查采集失败
- 用于后续优化解析器
- 用于回归测试

## 12. 数据库设计

首版建议用 SQLite，足够支撑单机桌面端。

建议表：

- `tasks`
- `products`
- `artifacts`
- `profiles`

### 12.1 tasks

- `id`
- `status`
- `source_url`
- `final_url`
- `created_at`
- `updated_at`
- `error_message`

### 12.2 products

- `task_id`
- `title`
- `price_current`
- `shop_name`
- `snapshot_json`

### 12.3 artifacts

- `task_id`
- `type`
- `path`
- `meta_json`

## 13. 错误处理与恢复

桌面采集工具要把失败当成常态设计。

推荐错误类型：

- `LOGIN_REQUIRED`
- `LOGIN_EXPIRED`
- `PAGE_LOAD_TIMEOUT`
- `SELECTOR_NOT_FOUND`
- `RISK_CONTROL_BLOCKED`
- `NETWORK_CAPTURE_EMPTY`
- `NORMALIZE_FAILED`
- `EXPORT_FAILED`

每种错误都要返回：

- 错误码
- 人类可读说明
- 当前截图
- 调试文件路径
- 是否建议重试

## 14. 风控与边界

这个产品如果要长期可用，必须从架构层承认这些边界：

- 页面结构会变化
- 登录态会失效
- 某些内容必须真实交互后才出现
- 某些数据无法保证长期稳定获取

建议产品策略：

- 以“用户自己登录后的单条或低频采集”为主
- 不把“高并发批量抓取”作为第一阶段目标
- 不把规避验证码、规避风控作为核心功能设计
- 把失败可诊断、可重试放进 MVP

## 15. 推荐的 MVP 范围

第一版只做这些：

- 输入单个淘宝商品链接
- 复用本地登录态
- 采集标题、价格、主图、SKU、属性、店铺名、详情描述
- 导出 `JSON`
- 保留调试快照

先不要做：

- 批量并发采集
- 评论抓取
- 问大家抓取
- 推荐商品抓取
- 多平台统一采集
- 云端任务调度

说明：

- 首版不建议把以上能力一起做完，不代表架构上不支持
- 如果产品目标是“尽可能什么都能采”，应该通过统一任务模型和插件式 extractor 扩展，而不是把所有逻辑硬编码在单一商品流程里

## 16. 推荐实施顺序

### 阶段一：桌面骨架

- 初始化 `Tauri + Vue 3 + TypeScript`
- 加入 `sidecar` 管理能力
- 打通前端到 Tauri command
- 打通 Tauri 到 sidecar 的本地调用

交付物：

- 可启动桌面应用
- 可启动 collector 进程
- 可展示 sidecar 状态

### 阶段二：浏览器会话

- 集成 Playwright
- 建立持久化 profile
- 实现手动登录流程
- 检测登录状态

交付物：

- 用户可打开浏览器手动登录
- 登录态可复用

### 阶段三：单商品采集

- 实现 URL 规范化
- 打开商品页
- 完成 DOM 抽取
- 保存截图、HTML、原始状态

交付物：

- 可采到基础字段

### 阶段四：多来源融合

- 加入网络监听
- 加入状态对象提取
- 做字段优先级归一化

交付物：

- SKU、详情、媒体完整度提升

### 阶段五：导出与诊断

- SQLite 存储
- `JSON / CSV / XLSX` 导出
- 调试目录与失败回放

交付物：

- 可用的本地采集工具首版

## 17. 关键实现建议

### 17.1 sidecar 运行方式

推荐把 `collector` 打包为独立 Node 应用，由 Tauri sidecar 启动。

原因：

- Playwright 与 Node 生态最成熟
- 调试方便
- 后续独立升级更容易

### 17.2 浏览器选择

优先使用 Playwright 自带 Chromium。

如果某些系统打包约束明显，再评估：

- 使用系统已安装 Chrome
- 首次启动时检查浏览器依赖

### 17.3 页面稳定性

不要把选择器写死在业务逻辑里。建议：

- 把选择器定义抽成配置模块
- 把提取规则做成可迭代的 parser 层
- 对每个字段记录数据来源

### 17.4 调试能力

每次采集都建议默认保留：

- 页面截图
- 最终 HTML
- 命中的关键接口响应
- 提取前后的 JSON

没有这些，后续维护成本会很高。

## 18. 一个可接受的接口契约示例

### 18.1 前端调用 Tauri

```ts
await invoke("collect_product", {
  url: "https://item.taobao.com/item.htm?id=123456"
});
```

### 18.2 Tauri 调用 sidecar

```json
{
  "taskId": "task_001",
  "url": "https://item.taobao.com/item.htm?id=123456",
  "profile": "default",
  "options": {
    "saveDebugArtifacts": true,
    "downloadAssets": true
  }
}
```

### 18.3 sidecar 返回

```json
{
  "taskId": "task_001",
  "status": "completed",
  "product": {
    "title": "示例商品",
    "price": {
      "current": "199.00"
    },
    "shop": {
      "name": "示例店铺"
    }
  },
  "artifacts": {
    "screenshot": "/path/to/screenshot.png",
    "json": "/path/to/product.json"
  }
}
```

## 19. 最终建议

如果你要的是“能做出来并且后面还能维护”的方案，推荐结论很明确：

- 用 `Tauri` 做桌面壳
- 用 `Node sidecar + Playwright` 做采集引擎
- 用持久化浏览器 profile 解决登录态
- 用 `DOM + 页面状态 + 网络响应` 三路融合提取
- 把调试快照、错误码、导出能力放进首版

不推荐：

- 纯 HTTP 硬抓
- 一开始就追求全量字段和高并发
- 把自动化逻辑直接塞进 Tauri 前端

## 20. 下一步可直接做什么

如果要继续落地，下一步最合理的是直接开一个最小工程，范围如下：

- `Tauri + Vue` 前端骨架
- `collector` sidecar 启动
- Playwright 持久化登录窗口
- 单链接采集任务接口
- 返回标题、价格、主图、店铺名

这个范围足够验证整条链路，不会一上来就把复杂度拉满。

## 21. 扩展采集范围设计

如果目标不是只采“单个商品基础信息”，而是尽可能覆盖淘宝页面中可见且可提取的内容，建议把采集对象抽象成统一实体，而不是继续把所有字段堆在 `ProductSnapshot` 里。

推荐支持的实体类型：

- `product`：商品主体、标题、价格、主图、SKU、详情、属性
- `shop`：店铺主页信息、店铺名称、评分、主营类目、店铺公告
- `review`：商品评价、追评、评价图片、视频、评价标签
- `qa`：问大家问题、回答、摘要、时间
- `recommendation`：推荐商品、搭配购、相似商品、店铺推荐
- `transaction_hint`：销量文案、发货地、物流说明、活动说明
- `live_or_content_hint`：直播入口、短视频入口、种草内容入口等页面可见线索

### 21.1 统一任务模型

不要只保留 `collectProduct(url)`，建议抽象成：

```ts
type CollectEntityRequest = {
  taskId: string;
  url: string;
  profile: string;
  entityTypes: Array<
    | "product"
    | "shop"
    | "review"
    | "qa"
    | "recommendation"
    | "transaction_hint"
    | "live_or_content_hint"
  >;
  options: {
    saveDebugArtifacts: boolean;
    downloadAssets: boolean;
    maxReviews?: number;
    maxQaItems?: number;
    includeRecommendationGraph?: boolean;
    includeRawPayloads?: boolean;
  };
};
```

这样做的价值：

- 同一个页面可按需采多个实体
- 不同页面类型可复用同一套任务与导出框架
- 后续增加新实体时，不必推翻现有 API

### 21.2 统一结果模型

建议把结果拆成“主快照 + 扩展实体集合”：

```ts
type CollectTaskResult = {
  taskId: string;
  status: "completed" | "partial" | "failed";
  pageType?: "product" | "shop" | "unknown";
  entities: {
    product?: ProductSnapshot;
    shop?: ShopSnapshot;
    reviews?: ReviewSnapshot[];
    qa?: QaSnapshot[];
    recommendations?: RecommendationSnapshot[];
    transactionHints?: KeyValueItem[];
    contentHints?: KeyValueItem[];
  };
  diagnostics: {
    warnings: string[];
    extractorVersion: string;
    elapsedMs: number;
    sourceMap?: Record<string, string>;
  };
};
```

### 21.3 页面类型识别

建议在 `url_resolver` 之后增加 `page_classifier`：

- 判断当前是否为商品页、店铺页、登录页、风控页、错误页
- 提前决定启用哪些 extractor
- 对非商品页返回更清晰的错误或降级结果

可用信号：

- URL 规则
- 页面标题
- 关键 DOM 标识
- 初始化状态中的页面类型字段
- 是否命中风控或登录页特征

### 21.4 插件式 extractor

推荐把抽取器拆成：

- `extractors/product/*`
- `extractors/shop/*`
- `extractors/review/*`
- `extractors/qa/*`
- `extractors/recommendation/*`

统一接口建议：

```ts
interface EntityExtractor<T> {
  name: string;
  entityType: string;
  canRun(ctx: ExtractContext): Promise<boolean>;
  run(ctx: ExtractContext): Promise<ExtractorResult<T>>;
}
```

这样后续即使页面结构变化，也只需局部替换 extractor。

## 22. 接口协议与状态机规范

现有接口示例足够表达方向，但如果要真正进入开发，建议把协议定义到可联调级别。

### 22.1 任务状态机

推荐任务状态：

- `created`
- `queued`
- `launching_browser`
- `waiting_login`
- `loading_page`
- `extracting`
- `downloading_assets`
- `normalizing`
- `persisting`
- `completed`
- `partial`
- `failed`
- `cancelled`

状态流转建议：

```text
created
  -> queued
  -> launching_browser
  -> waiting_login (optional)
  -> loading_page
  -> extracting
  -> downloading_assets (optional)
  -> normalizing
  -> persisting
  -> completed | partial | failed | cancelled
```

### 22.2 任务对象

```ts
type TaskRecord = {
  id: string;
  status: string;
  profile: string;
  sourceUrl: string;
  finalUrl?: string;
  entityTypes: string[];
  progress?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  retryCount: number;
  error?: CollectorError;
};
```

### 22.3 错误对象

```ts
type CollectorError = {
  code:
    | "LOGIN_REQUIRED"
    | "LOGIN_EXPIRED"
    | "PAGE_LOAD_TIMEOUT"
    | "PAGE_TYPE_UNSUPPORTED"
    | "RISK_CONTROL_BLOCKED"
    | "SELECTOR_NOT_FOUND"
    | "NETWORK_CAPTURE_EMPTY"
    | "NORMALIZE_FAILED"
    | "ASSET_DOWNLOAD_FAILED"
    | "EXPORT_FAILED";
  message: string;
  retryable: boolean;
  stage?: string;
  screenshotPath?: string;
  debugDir?: string;
  details?: Record<string, unknown>;
};
```

### 22.4 事件载荷

建议事件不是只发“阶段名”，还要带上最小可用上下文：

```ts
type CollectorEvent = {
  taskId: string;
  type: string;
  status: string;
  progress?: number;
  message?: string;
  timestamp: string;
  data?: Record<string, unknown>;
};
```

推荐事件补充：

- `collector:task_queued`
- `collector:page_classified`
- `collector:downloading_assets`
- `collector:partial_result`
- `collector:task_cancelled`

### 22.5 取消与幂等

建议明确以下规则：

- 同一个 `taskId` 重复提交时，若任务仍在执行，返回已有任务状态
- 取消操作只取消尚未完成的任务，不回滚已保存的调试文件
- 取消后浏览器页签应关闭，但持久化 profile 不删除
- 导出接口应允许重复执行，避免因为一次文件写入失败导致任务报废

## 23. 安全与合规设计

即使产品目标是“尽可能多采集”，也建议把边界写进架构，而不是默认为无限制抓取。

### 23.1 基本原则

- 以用户主动打开、主动登录、主动触发的本地采集为主
- 不把绕过验证码、绕过登录、绕过平台风控作为核心能力
- 不默认提升并发，不默认后台静默长时间运行
- 不把采集到的账号信息、cookie、原始响应明文暴露给前端

### 23.2 本地敏感数据保护

建议保护对象：

- 浏览器 profile
- cookie 与 local storage
- 调试目录中的 HTML、截图、网络响应
- 导出的结构化数据

建议措施：

- profile 与调试目录按用户目录隔离
- 在数据库中只保存 profile 元数据，不直接写入完整 cookie
- 调试导出前支持脱敏
- 提供“清除本地会话”和“清除调试快照”入口

### 23.3 本地 HTTP/IPC 安全

如果使用本地 HTTP 服务，建议至少做这些：

- sidecar 只监听 `127.0.0.1`
- 端口随机分配
- Tauri 启动 sidecar 后生成一次性 session token
- 每个请求必须带 token
- sidecar 校验来源进程和 token 失效时间
- 应用退出时主动回收 token 与服务

### 23.4 调试快照脱敏

建议区分两类 debug 产物：

- `internal_debug`：原始调试快照，仅本机可见
- `export_debug`：对外共享前先脱敏的调试包

建议脱敏内容：

- cookie
- 用户昵称、收货相关信息
- 请求签名参数
- 可能暴露身份或会话的 header

## 24. 打包与发布方案

`Node sidecar + Playwright` 的方案能落地，但必须提前设计分发方式。

### 24.1 发布形态

推荐形态：

1. `Tauri` 主应用负责 UI、配置、文件系统和原生能力
2. `collector` 构建为独立 Node 应用
3. 通过 sidecar 方式与主应用一并打包
4. Playwright 浏览器二进制作为安装包的一部分，或首次启动按版本拉取

### 24.2 两种可选方案

方案 A：安装包内置 Node runtime 与浏览器

- 优点：离线可用，首次启动成功率高
- 缺点：安装体积大，升级包更重

方案 B：安装包只带主程序，首次启动补齐依赖

- 优点：安装包小
- 缺点：首启流程复杂，依赖网络，失败点更多

对桌面采集工具来说，更推荐方案 A。

### 24.3 macOS 重点问题

建议补充发布流程说明：

- sidecar 可执行文件签名
- Playwright 浏览器相关文件签名策略
- 应用 notarization
- 首次启动时的权限提示与异常处理

### 24.4 版本兼容策略

建议记录并展示：

- `appVersion`
- `collectorVersion`
- `extractorVersion`
- `playwrightVersion`
- `browserRevision`

出现采集异常时，这些版本信息要能一并导出。

## 25. 测试与回归策略

这类项目后期主要难点不是“能不能写出来”，而是“页面变化后能不能快速修”。

### 25.1 测试分层

建议至少分四层：

1. 解析器单测
   输入固定 HTML、状态 JSON、网络响应，验证字段提取是否正确
2. 页面样本回归
   使用历史保留的 debug 快照做离线回归
3. 端到端冒烟
   人工登录后跑少量真实链接，验证主流程可用
4. 导出与持久化测试
   验证 SQLite、JSON、CSV、XLSX、图片资源落盘逻辑

### 25.2 样本库设计

建议建立本地样本库：

```text
fixtures/
├─ product/
│  ├─ normal/
│  ├─ login_required/
│  ├─ risk_control/
│  └─ price_changed/
├─ review/
├─ qa/
└─ shop/
```

每个样本至少保留：

- `page.html`
- `state.json`
- `network.json`
- `expected.json`

### 25.3 回归触发时机

建议在以下时机必跑回归：

- 调整选择器
- 调整字段映射
- 升级 Playwright
- 升级浏览器版本
- 收到线上失败样本并修复后

### 25.4 可观测性

建议每次任务都记录：

- 各阶段耗时
- 是否命中登录
- 是否命中风控
- 实际启用的 extractor
- 字段来源与缺失字段列表

这些数据能直接帮助定位“到底是页面没加载出来，还是解析器失效了”。

## 26. 稳定性与任务调度策略

### 26.1 并发建议

如果要支持“什么都可以采”，也不代表应该一开始就高并发。

建议默认策略：

- 单 profile 串行执行
- 同时只保留少量活跃页面
- 评论、问大家等深分页内容采用分段采集
- 任务队列可排队，但不要默认多浏览器并发

### 26.2 profile 锁

建议给每个持久化 profile 加锁：

- 某个 profile 正在登录或采集时，不允许第二个任务直接复用
- 若必须并发，复制只读 profile 派生临时上下文
- 任务异常退出后要有锁恢复机制

### 26.3 降级策略

当某部分采集失败时，允许任务进入 `partial`：

- 主商品成功，评论失败
- 标题价格成功，详情失败
- DOM 成功，网络抓取失败

不要因为一个扩展实体失败就把整个任务判成不可用。

## 27. 文档级推荐结论

如果产品方向是“从单商品出发，但未来尽量支持更多页面对象和更多字段”，最稳妥的路线不是把所有能力首版做完，而是：

- 保持 `Tauri + Node sidecar + Playwright` 主架构不变
- 把采集对象抽象成统一实体与插件式 extractor
- 把任务协议、错误模型、调试体系、样本回归先设计好
- 允许能力范围持续扩展，但仍以低频、可诊断、可恢复为优先

这样后续无论你要补商品评论、问大家、店铺信息，还是推荐商品链路，都能在现有框架上迭代，而不是重写一版。

## 28. 多账号 / 多 Profile 管理

### 28.1 设计目标

- 支持同一台机器上管理多个淘宝账号
- 每个账号对应独立的浏览器 profile，互不干扰
- 切换账号时不需要重新登录

### 28.2 Profile 数据模型

```ts
type ProfileRecord = {
  id: string;
  alias: string;
  platform: "taobao";
  profileDir: string;
  loginStatus: "unknown" | "valid" | "expired";
  lastUsedAt?: string;
  createdAt: string;
};
```

profile 目录约定：

```text
~/Library/Application Support/your-app/profiles/{profileId}/
```

数据库 `profiles` 表只存元数据，不存 cookie 原文。

### 28.3 Profile 生命周期

- 创建：用户新建账号时，生成 profileId，创建目录，写入初始元数据
- 激活：任务提交时指定 profileId，sidecar 用对应目录启动 `launchPersistentContext`
- 切换：前端切换当前默认 profile，不影响正在运行的任务
- 删除：先检查是否有进行中任务，确认后删除目录与数据库记录

并发锁规则：

- 同一 profileId 同时只允许一个活跃任务
- 若需并发，从原 profile 目录复制只读快照，派生临时上下文
- 任务异常退出后，锁超时自动释放（建议 60s）

### 28.4 UI 层交互

- 账号列表展示：alias、登录状态、最近使用时间
- 操作入口：新建、重命名、重新登录、删除
- 切换账号时清理前端任务状态缓存，不中断已有任务

### 28.5 与现有模块集成

- `BrowserManager` 按 profileId 维护独立 context 实例
- 数据库采用分表方案：`tasks`、`products` 均带 `profile_id` 字段，不分库
- 导出目录按 profileId 隔离：`exports/{profileId}/task-xxx/`

## 29. 自动更新机制

### 29.1 更新策略

推荐使用 Tauri 内置 updater（基于 `tauri-plugin-updater`）。

- 主应用走全量更新，由 Tauri updater 处理
- collector/extractor 版本可独立热更新，不依赖主应用重装

### 29.2 版本清单格式

服务端维护一个 `version.json`：

```json
{
  "version": "1.2.0",
  "notes": "修复价格字段提取",
  "pub_date": "2026-04-24T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://your-cdn/app-1.2.0-aarch64.dmg.tar.gz",
      "signature": "..."
    },
    "windows-x86_64": {
      "url": "https://your-cdn/app-1.2.0-x86_64.msi.zip",
      "signature": "..."
    }
  }
}
```

### 29.3 客户端更新流程

- 启动时静默检查一次
- 发现新版本后通知用户，不强制打断
- 用户确认后下载，下载完成提示重启
- 不支持静默自动安装，避免用户感知丢失

### 29.4 collector 热更新

collector 版本独立于主应用，可单独下发：

- 主应用启动时检查 collector 版本号
- 若远端版本更新，后台下载新 collector 包
- 替换完成后重启 sidecar 进程，不重启主应用

### 29.5 回滚与安全

- 安装包必须携带签名，客户端校验后才执行
- 更新失败保留旧版本，下次启动自动回退
- 提供 stable / beta 两个更新通道，在设置中切换

## 30. 日志系统设计

### 30.1 日志分层

三层独立日志，统一写入本地文件：

- 主进程日志（Tauri/Rust）：应用生命周期、sidecar 管理、文件操作
- 渲染进程日志（Vue）：用户操作、界面状态变化
- 采集任务日志（collector/Node）：每个任务独立日志流

### 30.2 日志格式

结构化 JSON，每行一条：

```json
{
  "timestamp": "2026-04-24T14:30:00.123Z",
  "level": "INFO",
  "module": "collector.dom_extractor",
  "taskId": "task_001",
  "message": "title extracted",
  "payload": { "title": "示例商品" }
}
```

敏感字段脱敏规则：
- `cookie`、`token`、`authorization` 替换为 `[REDACTED]`
- 用户昵称、手机号替换为 `[MASKED]`

### 30.3 存储与轮转

```text
~/Library/Application Support/your-app/logs/
├─ app-2026-04-24.log
├─ collector-2026-04-24.log
└─ tasks/
   └─ task_001.log
```

- 按日期轮转，保留最近 14 天
- 单文件超过 50MB 时压缩归档
- 任务日志与主日志分离，便于单独导出

### 30.4 调试模式

- 开发环境默认 DEBUG 级别，生产环境默认 INFO
- 渲染进程日志通过 Tauri event 转发到主进程统一落盘
- 前端日志面板只展示当前任务的 INFO 及以上级别

## 31. 配置管理

### 31.1 配置分层

三层优先级，高层覆盖低层：

1. 默认配置（内置代码）
2. 用户配置（持久化到本地 JSON）
3. 运行时配置（内存，进程退出后丢弃）

### 31.2 存储方案

使用 `tauri-plugin-store` 持久化用户配置：

```text
~/Library/Application Support/your-app/config.json
```

主进程持有配置权威副本，渲染进程通过 Tauri invoke 读写，不直接操作文件。

### 31.3 配置项分类

应用级：
- `theme`: `"light" | "dark" | "system"`
- `language`: `"zh-CN" | "en"`
- `updateChannel`: `"stable" | "beta"`

采集级：
- `defaultDownloadDir`: 导出根目录
- `requestTimeout`: 页面加载超时（ms）
- `retryCount`: 失败重试次数
- `downloadAssets`: 是否默认下载图片资源
- `saveDebugArtifacts`: 是否保留调试快照

账号级（per-profile 覆盖）：
- `downloadDir`: 覆盖默认导出目录
- `requestTimeout`: 覆盖全局超时

### 31.4 配置变更与同步

```ts
// Tauri command
invoke("set_config", { key: "requestTimeout", value: 30000 })
invoke("get_config", { key: "requestTimeout" })
```

配置变更后广播 `config:updated` 事件，sidecar 监听后热更新运行时参数，无需重启。

### 31.5 配置迁移

每次应用升级时检查配置版本号，自动补全新增字段默认值，不覆盖用户已有设置。

## 32. 首次启动体验（OOBE）

### 32.1 设计目标

- 首次启动完成环境检测与必要初始化
- 引导用户完成账号登录，降低上手门槛
- 中断后再次启动可从断点继续

### 32.2 启动检测项

应用首次启动时依次检查：

- 数据目录是否可写
- Playwright Chromium 是否存在，不存在则触发下载
- 磁盘剩余空间是否满足最低要求（建议 500MB）
- 默认导出目录是否可访问

任何检测失败都给出明确提示和修复建议，不静默跳过。

### 32.3 引导流程

```text
欢迎页
  -> 权限与说明（本地数据、浏览器自动化说明）
  -> 下载路径设置（可跳过，使用默认值）
  -> 添加账号（打开浏览器引导登录）
  -> 完成
```

每步均可跳过，跳过后使用默认值，后续可在设置中补充。

### 32.4 账号登录引导

1. 点击"添加账号"，sidecar 打开持久化 Chromium 窗口
2. 用户自行完成登录和验证码
3. sidecar 检测到登录成功标志后通知前端
4. 前端展示账号昵称，引导进入下一步

### 32.5 引导状态持久化

- 在配置中写入 `onboardingCompleted: true`
- 每步完成状态单独记录，支持断点续引导
- 设置页提供"重置引导"入口，清除标志位后重启即可重新触发
