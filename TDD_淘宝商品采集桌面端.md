# 淘宝商品采集桌面端 - 技术设计文档（TDD）

## 1. 文档概述

### 1.1 目的与范围

本文档定义淘宝商品采集桌面端的技术架构、模块设计、接口协议、数据模型与部署方案，面向开发与测试团队。

### 1.2 术语与缩写

- **Tauri**：跨平台桌面应用框架，使用 Rust 后端 + Web 前端
- **Sidecar**：由主应用启动的独立子进程
- **Playwright**：浏览器自动化框架
- **Profile**：Playwright 持久化浏览器上下文，保存 cookie 与本地存储
- **IPC**：进程间通信（Inter-Process Communication）

### 1.3 版本记录

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0 | 2026-04-24 | - | 初始版本 |

### 1.4 MVP 范围与非目标

本节用于明确第一版交付边界，避免在设计和开发阶段持续扩张需求。

#### 1.4.1 MVP 目标

MVP 聚焦于“**单平台、单核心流程、可稳定闭环**”：
- 用户可在桌面端新增淘宝账号，并完成手动登录
- 用户可输入单个淘宝商品链接，发起一次采集任务
- 系统可基于登录态抓取商品核心信息并落库
- 用户可查看任务列表、任务详情、错误信息和调试产物
- 用户可将单个任务结果导出为 `json`、`csv`、`xlsx`

MVP 成功标准：
- 核心采集链路可从“登录 → 采集 → 展示 → 导出”完整跑通
- 常见失败场景具备明确提示和可追踪调试信息
- 本地数据可稳定保存，应用重启后能查看历史任务和账号

#### 1.4.2 MVP 范围内

**平台与页面范围**：
- 仅支持 `taobao` 平台
- 仅支持商品详情页采集
- 仅支持单链接单任务发起，不支持批量导入 URL

**账号能力范围**：
- 支持添加账号、删除账号、重新登录、检查登录状态
- 支持多账号保存与切换
- 支持同一账号串行执行任务

**采集能力范围**：
- 采集商品标题、价格、店铺、主图、SKU、属性、详情摘要等核心字段
- 支持 DOM、网络、页面状态三路融合提取
- 支持 `completed`、`partial`、`failed` 三种结果状态
- 支持失败重试和调试信息保留

**桌面端能力范围**：
- 提供首页任务创建入口
- 提供任务列表、详情预览、错误提示、导出操作
- 提供基础设置项，如超时、导出目录、调试开关

**运行与存储范围**：
- 本地 SQLite 存储任务、账号和采集结果
- 本地文件系统保存导出文件和调试产物
- 优先支持 macOS，Windows 为兼容目标但不作为第一优先验收平台

#### 1.4.3 明确不纳入 MVP

以下能力明确不进入第一版交付范围：

- 不支持1688、京东、拼多多等其他平台
- 不支持店铺页、搜索结果页、活动页、直播页等非商品详情页
- 不支持批量采集、任务队列编排、定时任务、自动轮询
- 不支持云端账号同步、云端任务同步、多设备共享数据
- 不支持自动绕过滑块、短信验证、人机验证等风控能力
- 不支持内置代理池、IP 轮换、指纹伪装等反风控增强能力
- 不支持商品评论、问大家、评价分析、竞品分析等衍生数据采集
- 不支持自动翻译、自动清洗、自动标签分类等数据加工功能
- 不支持内置报表中心、可视化分析大盘
- 不支持批量图片下载优化、断点续传、CDN 镜像等高级导出能力

#### 1.4.4 延后到后续版本的候选能力

以下能力可以在 MVP 验证完成后进入下一阶段评估：

- 批量 URL 导入与并发调度
- 更多平台适配，如天猫、1688
- 任务模板与常用导出配置
- 历史任务搜索、标签和归档
- 调试信息一键打包
- 自动更新、崩溃上报、匿名使用统计
- 页面级低代码规则配置或选择器热更新

#### 1.4.5 范围控制原则

为避免需求膨胀，MVP 阶段统一遵循以下原则：

- **先闭环后扩展**：优先保证单条链路稳定，不为“未来可能要用”预埋复杂系统
- **先人工兜底后自动化**：需要人工参与的登录和风控处理允许保留人工流程
- **先单任务后批量化**：先验证单任务稳定性，再考虑批量与并发
- **先本地可用后远程协同**：第一版只解决本机上的完整使用体验
- **先核心字段后衍生分析**：先保证商品主体数据准确，再考虑评论、分析、报表

#### 1.4.6 需求变更准入规则

若有新增需求，只有同时满足以下条件，才允许进入 MVP：

1. 不改变当前三层架构与主流程
2. 不新增独立服务端依赖
3. 不显著增加风控、合规或账号安全风险
4. 不影响当前核心里程碑交付时间

否则统一进入 MVP 后需求池，在验证首版成功后再评估优先级。

---

## 2. 技术选型

### 2.1 选型决策矩阵

| 技术点 | 候选方案 | 选型结果 | 理由 |
|--------|----------|----------|------|
| 桌面框架 | Electron / Tauri | **Tauri v2** | 体积小、性能好、安全性高 |
| 前端框架 | Vue 3 / React | **Vue 3 + TypeScript** | 团队熟悉度、生态成熟 |
| 浏览器自动化 | Puppeteer / Playwright / Selenium | **Playwright** | API 现代、多浏览器支持、调试友好 |
| 采集引擎运行时 | Rust 内嵌 / Node sidecar | **Node.js sidecar** | Playwright 生态成熟、开发效率高 |
| 本地存储 | SQLite / LevelDB / JSON 文件 | **SQLite** | 结构化查询、事务支持、跨平台 |

### 2.2 Tauri v2 vs Electron

| 对比项 | Tauri | Electron |
|--------|-------|----------|
| 安装包体积 | ~5MB | ~50MB |
| 内存占用 | 低（系统 WebView） | 高（内嵌 Chromium） |
| 安全性 | 默认沙箱隔离 | 需手动配置 |
| 生态成熟度 | 较新 | 成熟 |
| 学习曲线 | Rust 后端有门槛 | JavaScript 全栈 |

选择 Tauri 的原因：
- 桌面工具对体积敏感
- Rust 后端适合处理文件系统与进程管理
- 前端仍使用 Vue，学习成本可控

### 2.3 Playwright 选型理由

淘宝页面特点：
- 强前端渲染，DOM 动态生成
- 需要登录态才能访问完整数据
- 存在滑块验证与风控机制

Playwright 优势：
- 真实浏览器环境，完整执行 JavaScript
- 支持持久化上下文，维持登录态
- 网络监听能力强，可捕获 XHR/Fetch 响应
- 调试工具完善（截图、录屏、trace）

### 2.4 SQLite 数据存储选型

需求：
- 存储任务记录、商品数据、账号元数据
- 支持查询历史任务
- 支持事务，保证数据一致性

SQLite 优势：
- 单文件数据库，便于备份与迁移
- 无需独立数据库服务
- 跨平台兼容性好
- Rust 生态有成熟的 `rusqlite` 库

---

## 3. 系统架构

### 3.1 整体三层架构

```text
┌─────────────────────────────────────────┐
│         Tauri UI Layer (Vue 3)          │
│  - 用户界面                              │
│  - 任务管理                              │
│  - 配置管理                              │
└─────────────────┬───────────────────────┘
                  │ Tauri Command (IPC)
┌─────────────────▼───────────────────────┐
│       Tauri Backend (Rust)              │
│  - Sidecar 进程管理                      │
│  - SQLite 数据库操作                     │
│  - 文件系统访问                          │
│  - 事件广播                              │
└─────────────────┬───────────────────────┘
                  │ stdin/stdout JSON
┌─────────────────▼───────────────────────┐
│   Collector Sidecar (Node.js)           │
│  - Playwright 浏览器管理                 │
│  - 页面加载与等待                        │
│  - DOM / 网络 / 状态提取                 │
│  - 数据归一化                            │
└─────────────────┬───────────────────────┘
                  │ Playwright API
┌─────────────────▼───────────────────────┐
│      Browser Context (Chromium)         │
│  - 持久化 Profile                        │
│  - 页面渲染                              │
│  - 网络请求                              │
└─────────────────────────────────────────┘
```

### 3.2 进程模型

- **主进程**（Tauri Rust）：应用生命周期管理、窗口管理、数据库操作
- **渲染进程**（Vue WebView）：用户界面，通过 Tauri Command 与主进程通信
- **Sidecar 进程**（Node.js）：独立子进程，由主进程启动，负责浏览器自动化
- **浏览器进程**（Chromium）：由 Playwright 启动，执行页面渲染与脚本

进程隔离优势：
- Sidecar 崩溃不影响主应用
- 浏览器进程异常退出可单独恢复
- 便于独立升级采集引擎

### 3.3 通信链路

**前端 → Rust**：Tauri Command（类型安全的 IPC）
```typescript
await invoke('collect_product', { url: '...' })
```

**Rust → Sidecar**：stdin/stdout JSON 消息
```json
// stdin
{"type": "collect", "taskId": "task_001", "url": "..."}

// stdout
{"type": "progress", "taskId": "task_001", "stage": "loading_page"}
{"type": "result", "taskId": "task_001", "data": {...}}
```

**Rust → 前端**：Tauri Event（事件广播）
```typescript
listen('collector:progress', (event) => {
  console.log(event.payload)
})
```

---

## 4. 模块设计

### 4.1 Tauri UI 层（Vue 3 前端）

目录结构：
```text
src/
├── views/
│   ├── Home.vue          # 主界面
│   ├── TaskList.vue      # 任务列表
│   ├── Settings.vue      # 设置页
│   └── Onboarding.vue    # 首次启动引导
├── components/
│   ├── TaskCard.vue      # 任务卡片
│   ├── ProductPreview.vue # 商品预览
│   └── AccountSelector.vue # 账号选择器
├── stores/
│   ├── taskStore.ts      # 任务状态管理
│   ├── configStore.ts    # 配置管理
│   └── accountStore.ts   # 账号管理
└── services/
    └── tauri.ts          # Tauri Command 封装
```

核心职责：
- 用户输入与交互
- 任务状态展示
- 调用 Tauri Command 触发后端操作
- 监听 Tauri Event 更新界面

### 4.2 Tauri Backend（Rust）

目录结构：
```text
src-tauri/src/
├── main.rs               # 应用入口
├── commands/
│   ├── collector.rs      # 采集相关 Command
│   ├── config.rs         # 配置相关 Command
│   └── account.rs        # 账号相关 Command
├── sidecar/
│   ├── manager.rs        # Sidecar 进程管理
│   └── protocol.rs       # stdin/stdout 协议
├── db/
│   ├── schema.rs         # 数据库 Schema
│   ├── tasks.rs          # 任务表操作
│   └── accounts.rs       # 账号表操作
└── events/
    └── emitter.rs        # 事件广播
```

核心职责：
- 启动与管理 Sidecar 进程
- 提供 Tauri Command 给前端调用
- 操作 SQLite 数据库
- 广播采集进度事件到前端
- 处理文件系统操作（导出、日志）

### 4.3 Collector Sidecar（Node.js）

目录结构：
```text
collector/src/
├── index.ts              # 入口，监听 stdin
├── server/
│   └── handler.ts        # 消息处理器
├── browser/
│   ├── manager.ts        # Playwright 浏览器管理
│   └── profile.ts        # Profile 管理
├── extractors/
│   ├── dom.ts            # DOM 提取器
│   ├── network.ts        # 网络监听器
│   ├── state.ts          # 页面状态提取器
│   └── normalizer.ts     # 数据归一化
├── parsers/
│   └── taobao.ts         # 淘宝页面解析规则
├── models/
│   └── product.ts        # 商品数据模型
└── storage/
    └── artifacts.ts      # 调试快照存储
```

核心职责：
- 接收 Rust 主进程的采集指令
- 启动 Playwright 浏览器
- 管理持久化 Profile
- 执行页面加载与数据提取
- 返回采集结果与进度事件

### 4.4 登录态管理模块

**Profile 目录结构**：
```text
~/Library/Application Support/taobao-collector/profiles/
└── {profileId}/
    ├── cookies.json
    ├── localStorage.json
    └── sessionStorage.json
```

**登录流程**：
1. 用户点击"添加账号"
2. Rust 调用 Sidecar 的 `open_login` 指令
3. Sidecar 启动 Playwright，打开淘宝登录页
4. 用户手动完成登录
5. Sidecar 检测到登录成功标志（cookie 或页面元素）
6. Sidecar 保存 Profile 到本地目录
7. Rust 在数据库中记录 Profile 元数据

**登录检测**：
- 检查 cookie 中是否存在关键登录 cookie（如 `_tb_token_`）
- 访问用户中心页面，检查是否跳转到登录页

#### 4.4.1 登录与风控状态机

```text
idle
  → opening_login_window
  → waiting_user_login
  → login_detecting
  → login_valid
  → profile_persisted
  → completed

waiting_user_login
  → risk_control_detected
  → waiting_user_verify
  → login_detecting

waiting_user_login / waiting_user_verify
  → cancelled_by_user
  → timeout
  → failed
```

**状态说明**：
- `opening_login_window`：Rust 下发 `open_login` 指令，Sidecar 创建专用浏览器窗口
- `waiting_user_login`：用户手动扫码、输入账号密码或完成二次验证
- `risk_control_detected`：检测到滑块、短信验证、异常登录确认等风控页面
- `waiting_user_verify`：等待用户手动完成验证，系统仅展示提示，不尝试自动绕过
- `login_detecting`：轮询 cookie、用户中心页跳转结果和关键页面元素
- `login_valid`：检测到有效登录态，可写入 Profile 元数据
- `profile_persisted`：Profile 和数据库元数据均已落盘

**前端交互要求**：
- 登录窗口打开后，主界面展示当前账号状态为“等待登录”
- 检测到风控时，提示用户“请在浏览器中完成人工验证”
- 用户主动关闭登录窗口时，前端展示“登录已取消”，不写入有效账号
- 超过 5 分钟未完成登录时，自动提示超时，可选择继续等待或重新打开登录窗口
- 登录成功后立即刷新账号列表，并更新 `login_status=valid`

### 4.5 采集引擎（三路融合）

三路数据来源并行采集，归一化时按优先级合并：

**DOM 提取**（`extractors/dom.ts`）：
- 使用 `page.locator()` 提取标题、价格、店铺名、SKU 文本
- 选择器定义集中在 `parsers/taobao.ts`，与业务逻辑解耦

**网络监听**（`extractors/network.ts`）：
- 在 `page.goto()` 前注册 `page.on('response', ...)` 监听器
- 过滤目标接口（如 `mtop.taobao.detail.getdetail`）
- 解析响应 JSON，提取价格、SKU、媒体列表

**页面状态提取**（`extractors/state.ts`）：
- 通过 `page.evaluate()` 读取页面全局变量（如 `window.__INIT_DATA__`）
- 提取商品 ID、SKU 结构、属性表

**归一化优先级**：
```text
价格：  network > state > dom
SKU：   state > network > dom
标题：  dom > state
详情：  dom + network 合并
店铺：  state > dom
```

### 4.6 数据导出模块

导出产物目录结构：
```text
exports/{profileId}/task-{taskId}/
├── product.json
├── product.csv
├── product.xlsx
├── cover/          # 主图
├── detail/         # 详情图
└── debug/
    ├── screenshot.png
    ├── page.html
    ├── state.json
    └── network.json
```

导出格式实现：
- JSON：直接序列化 `ProductSnapshot`
- CSV：使用 `csv-stringify` 展开 SKU 为多行
- Excel：使用 `exceljs` 生成多 Sheet（基础信息 + SKU 列表）

### 4.7 多账号管理模块

Profile 锁机制：
```typescript
class ProfileLock {
  private locks = new Map<string, string>() // profileId -> taskId

  acquire(profileId: string, taskId: string): boolean
  release(profileId: string, taskId: string): void
  isLocked(profileId: string): boolean
}
```

并发策略：
- 同一 Profile 串行执行，不允许并发
- 需要并发时，复制 Profile 目录派生临时上下文
- 任务异常退出后，锁超时 60s 自动释放

### 4.8 UI 原型交互说明

本节定义 MVP 阶段的主界面交互路径，确保账号管理、任务列表、错误提示和导出操作形成完整闭环。

#### 4.8.1 主界面布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 顶部栏：账号选择 | 新增账号 | 设置 | 打开导出目录            │
├───────────────────────┬──────────────────────────────────────┤
│ 左侧任务面板          │ 右侧详情面板                         │
│ - 新建采集任务        │ - 商品基础信息预览                   │
│ - URL 输入框          │ - 图片/视频预览                      │
│ - 最近任务列表        │ - SKU 列表                           │
│ - 状态筛选            │ - 属性表                             │
│ - 失败/重试入口       │ - 调试信息与导出操作                 │
└───────────────────────┴──────────────────────────────────────┘
```

布局原则：
- 首屏优先支持“选账号 + 粘贴链接 + 开始采集”三步操作
- 最近任务列表始终可见，避免用户采集后找不到结果
- 详情面板根据任务状态切换为“预览态 / 错误态 / 空状态”

#### 4.8.2 账号管理交互

**账号列表展示字段**：
- 账号别名
- 登录状态：`valid` / `expired` / `unknown`
- 最近使用时间
- 当前是否被任务占用

**交互流程**：
1. 用户首次进入应用，若无账号，展示空状态卡片和“添加账号”主按钮
2. 用户点击“添加账号”后，弹出账号创建弹窗，输入别名并确认
3. 前端调用 `create_account` 成功后，立即调用 `open_login`
4. 登录窗口打开后，账号卡片进入“等待登录”状态，并显示轮询中的进度文案
5. 登录成功后，账号列表自动刷新，并默认选中新建账号
6. 若登录取消或超时，账号保留但状态为 `unknown`，用户可手动再次发起登录

**账号卡片操作**：
- `重新登录`：当状态为 `expired` 或 `unknown` 时可见
- `删除账号`：仅在无运行中任务且未加锁时可执行
- `检查状态`：主动触发 `check_login`

**交互约束**：
- 没有可用账号时，禁用“开始采集”按钮
- 被锁定账号在选择器中置灰，并显示“任务执行中”
- 删除账号前弹出二次确认，明确是否同时删除本地 Profile

#### 4.8.3 新建采集与任务列表交互

**新建任务区域**：
- 输入项：商品 URL
- 选择项：账号/Profile
- 操作项：`开始采集`、`清空`

**任务列表字段**：
- 任务 ID（可折叠显示）
- 商品标题或 URL 摘要
- 账号别名
- 当前状态
- 进度百分比
- 创建时间 / 完成时间
- 快捷操作：`查看详情`、`重试`、`导出`

**主流程**：
1. 用户粘贴 URL，并选择账号
2. 前端校验 URL 格式，非法时就地提示，不发起请求
3. 点击“开始采集”后，立即在列表顶部插入一条 `queued` 任务
4. 任务卡片根据 `collector:progress` 事件实时更新状态与进度
5. 任务完成后自动选中该任务，并在右侧展示采集结果
6. 若任务失败，列表中保留失败卡片，支持查看错误详情和一键重试

**列表筛选与排序**：
- 默认按 `updated_at DESC` 排序
- 支持按 `全部 / 运行中 / 已完成 / 失败` 筛选
- 运行中任务固定置顶，便于观察实时进度

#### 4.8.4 任务详情与结果预览

**完成态**：
- 展示标题、价格、店铺、主图、SKU、属性、详情摘要
- 显示采集时间、采集账号、来源 URL、最终 URL
- 提供 `导出 JSON`、`导出 CSV`、`导出 Excel`、`打开目录` 按钮

**部分成功态（`partial`）**：
- 顶部展示黄色提示条，说明缺失字段和降级来源
- 缺失字段统一显示为 `--`
- 允许用户继续导出，同时在导出文件中保留 `diagnostics`

**失败态**：
- 不展示商品预览，改为错误摘要卡片
- 若存在 `screenshotPath` 或 `debugDir`，提供“打开调试目录”入口
- 若错误可重试，则展示主按钮 `重新采集`

#### 4.8.5 错误弹窗与提示规范

**错误提示分层**：
- 表单错误：使用输入框下方文案，如“请输入有效的淘宝商品链接”
- 可恢复错误：使用顶部通知或任务卡片内联提示，如网络超时、导出失败
- 阻断性错误：使用模态弹窗，如登录失效、风控拦截、数据库迁移失败

**错误弹窗结构**：
- 标题：对应错误类型，如“登录状态已失效”
- 摘要：用户可理解的一句话说明
- 详情区：错误码、任务 ID、发生阶段
- 操作区：主操作 + 次操作

**推荐动作映射**：

| 错误码 | 弹窗主按钮 | 次按钮 |
|--------|------------|--------|
| `LOGIN_REQUIRED` | `前往登录` | `取消` |
| `LOGIN_EXPIRED` | `重新登录` | `切换账号` |
| `RISK_CONTROL_BLOCKED` | `前往处理` | `稍后重试` |
| `PAGE_LOAD_TIMEOUT` | `立即重试` | `查看调试信息` |
| `EXPORT_FAILED` | `重新导出` | `更换目录` |

提示规则：
- 同一任务同一错误在 30 秒内不重复弹窗，避免打扰
- 全局弹窗出现时，任务列表仍保留原状态，避免误以为任务消失
- 错误关闭后可从任务详情再次打开完整错误信息

#### 4.8.6 导出流程交互

**触发入口**：
- 任务列表卡片快捷按钮
- 任务详情页底部操作栏
- 批量导出入口（后续版本可扩展）

**导出流程**：
1. 用户点击导出按钮，若未配置默认目录，则先弹出目录选择器
2. 用户选择导出格式：`json`、`csv`、`xlsx`
3. 前端调用 `export_task`
4. 导出中按钮进入 loading 状态，并禁用重复点击
5. 导出成功后，显示“导出成功”通知，并提供“打开目录”按钮
6. 导出失败时，显示错误原因；若为权限问题，优先引导重新选择目录

**导出交互规则**：
- 对 `completed` 和 `partial` 任务都允许导出
- 对 `failed` 任务禁用导出结果文件，但允许打开调试目录
- 导出成功后记住用户最近一次选择的目录，作为下次默认值

#### 4.8.7 关键页面状态定义

**空状态**：
- 无账号：显示“先添加账号再开始采集”
- 无任务：显示最近操作引导和示例链接格式

**加载状态**：
- 任务创建后立刻显示骨架屏，避免右侧面板空白闪烁
- 账号登录检测中显示小型状态条，不阻塞其他界面操作

**异常状态**：
- Sidecar 未就绪时，主界面顶部显示全局告警条，并禁用新任务创建
- 数据库迁移失败时，只保留“查看日志”和“退出应用”操作

#### 4.8.8 前端事件联动建议

```typescript
collector:progress            -> 更新任务卡片进度、详情页阶段文案
collector:completed           -> 刷新任务详情、解锁账号、提示可导出
collector:failed              -> 展示错误摘要、按 retryable 决定是否显示重试
collector:recoverable_failed  -> 展示带“立即重试”的错误提示
account:login_status_changed  -> 刷新账号标签、更新选择器可用状态
config:updated                -> 刷新默认导出目录、调试模式等界面配置
```

联动原则：
- 列表页和详情页使用同一份 `taskStore`，避免状态不一致
- 弹窗不直接维护业务状态，只负责触发动作，最终状态以事件回流为准
- 所有“成功”提示都应带明确对象，例如“任务 task_001 已导出到 Documents”

---

## 5. 接口协议

### 5.1 Tauri Command 接口

```typescript
// 采集
invoke('collect_product', { url: string, profileId: string }): Promise<string> // 返回 taskId

// 任务管理
invoke('get_task', { taskId: string }): Promise<TaskRecord>
invoke('list_tasks', { limit: number, offset: number }): Promise<TaskRecord[]>
invoke('cancel_task', { taskId: string }): Promise<void>
invoke('retry_task', { taskId: string }): Promise<string>

// 账号管理
invoke('list_accounts'): Promise<ProfileRecord[]>
invoke('create_account', { alias: string }): Promise<string> // 返回 profileId
invoke('delete_account', { profileId: string }): Promise<void>
invoke('open_login', { profileId: string }): Promise<void>

// 导出
invoke('export_task', { taskId: string, format: 'json'|'csv'|'xlsx', dir: string }): Promise<string>

// 配置
invoke('get_config', { key: string }): Promise<unknown>
invoke('set_config', { key: string, value: unknown }): Promise<void>
```

### 5.2 Rust ↔ Sidecar 协议

消息格式（每行一个 JSON）：

**Rust → Sidecar（stdin）**：
```typescript
type SidecarRequest =
  | { type: 'collect'; taskId: string; url: string; profileId: string; options: CollectOptions }
  | { type: 'cancel'; taskId: string }
  | { type: 'open_login'; profileId: string; profileDir: string }
  | { type: 'check_login'; profileId: string; profileDir: string }
  | { type: 'shutdown' }
```

**Sidecar → Rust（stdout）**：
```typescript
type SidecarResponse =
  | { type: 'progress'; taskId: string; stage: string; progress?: number; message?: string }
  | { type: 'result'; taskId: string; status: 'completed'|'partial'|'failed'; data?: ProductSnapshot; error?: CollectorError }
  | { type: 'login_status'; profileId: string; status: 'valid'|'expired'|'unknown' }
  | { type: 'ready' }
```

### 5.3 Tauri 事件（Rust → 前端）

```typescript
// 采集进度
listen('collector:progress', (e: { taskId: string; stage: string; progress?: number }) => {})

// 采集完成
listen('collector:completed', (e: { taskId: string }) => {})

// 采集失败
listen('collector:failed', (e: { taskId: string; error: CollectorError }) => {})

// 配置变更
listen('config:updated', (e: { key: string; value: unknown }) => {})
```

### 5.4 核心数据结构

```typescript
type ProductSnapshot = {
  taskId: string
  sourceUrl: string
  finalUrl: string
  platform: 'taobao'
  collectedAt: string
  title?: string
  price?: { current?: string; original?: string; currency?: string }
  salesText?: string
  shop?: { name?: string; url?: string }
  media: { images: string[]; detailImages: string[]; videoUrl?: string }
  skus: Array<{ skuId?: string; name: string; price?: string; attributes: Record<string, string> }>
  attributes: Record<string, string>
  descriptionHtml?: string
  raw: { dom?: unknown; state?: unknown; network?: unknown[] }
}

type CollectorError = {
  code: 'LOGIN_REQUIRED' | 'LOGIN_EXPIRED' | 'PAGE_LOAD_TIMEOUT' | 'RISK_CONTROL_BLOCKED'
       | 'SELECTOR_NOT_FOUND' | 'NETWORK_CAPTURE_EMPTY' | 'NORMALIZE_FAILED' | 'EXPORT_FAILED'
  message: string
  retryable: boolean
  stage?: string
  screenshotPath?: string
  debugDir?: string
}
```

### 5.5 字段级验收标准

本节用于定义 `ProductSnapshot` 的字段完整度要求，并作为任务结果判定 `completed`、`partial`、`failed` 的统一依据。

#### 5.5.1 字段分级定义

- **必填字段**：缺失后不能视为完整商品结果，通常触发 `partial` 或 `failed`
- **建议字段**：缺失后不阻断任务完成，但需记录到 `diagnostics`
- **可选字段**：缺失不影响结果判定

#### 5.5.2 商品字段验收表

| 字段 | 级别 | 验收要求 | 缺失处理 |
|------|------|----------|----------|
| `taskId` | 必填 | 必须与任务记录一致 | 缺失直接判定 `failed` |
| `sourceUrl` | 必填 | 必须为用户输入的原始 URL | 缺失直接判定 `failed` |
| `finalUrl` | 必填 | 必须为最终落地商品页 URL | 缺失判定 `partial` |
| `platform` | 必填 | 固定为 `taobao` | 异常值判定 `failed` |
| `collectedAt` | 必填 | ISO 8601 时间字符串 | 缺失判定 `failed` |
| `title` | 必填 | 非空字符串，长度大于 1 | 缺失判定 `partial` |
| `price.current` | 必填 | 可解析为价格文本 | 缺失判定 `partial` |
| `shop.name` | 建议 | 非空字符串 | 缺失记录到 `diagnostics` |
| `media.images` | 建议 | 至少 1 张主图 URL | 缺失记录到 `diagnostics`，可判 `partial` |
| `skus` | 建议 | 有 SKU 商品需至少包含 1 条 SKU；无 SKU 商品允许空数组 | 结构异常判定 `partial` |
| `attributes` | 建议 | 至少保留已识别属性键值 | 缺失记录到 `diagnostics` |
| `salesText` | 可选 | 销量文本，如“已售 100+” | 缺失忽略 |
| `price.original` | 可选 | 划线价或原价 | 缺失忽略 |
| `shop.url` | 可选 | 店铺页链接 | 缺失忽略 |
| `media.detailImages` | 可选 | 详情图 URL 列表 | 缺失忽略 |
| `media.videoUrl` | 可选 | 商品视频地址 | 缺失忽略 |
| `descriptionHtml` | 可选 | 详情 HTML 片段 | 缺失忽略 |
| `raw.dom` | 建议 | 保留原始 DOM 提取结果 | 缺失记录调试信息缺口 |
| `raw.state` | 建议 | 保留状态树提取结果 | 缺失记录调试信息缺口 |
| `raw.network` | 建议 | 保留已捕获网络数据数组 | 缺失记录调试信息缺口 |

#### 5.5.3 结果判定规则

**判定为 `completed` 的条件**：
- 所有必填字段均存在且合法
- `title` 与 `price.current` 至少来自一种可信来源（DOM、state、network）
- 结果可被正常持久化并完成 `snapshot_json` 写入

**判定为 `partial` 的条件**：
- 必填字段中存在可降级缺失项，如 `finalUrl`、`title`、`price.current`
- 建议字段缺失较多，导致结果可用但不完整
- 某一路提取失败，但其余来源已产出可展示结果
- 主图、SKU、属性等结构存在部分缺损，但不影响识别该商品主体

**判定为 `failed` 的条件**：
- `taskId`、`sourceUrl`、`platform`、`collectedAt` 等基础元数据缺失
- 页面未能识别为有效商品页
- 三路提取结果都为空，无法形成最小商品快照
- 结果生成成功但持久化失败，且无法回滚到一致状态

#### 5.5.4 最小可用结果定义

最小可用结果（用于允许展示与导出）的最低要求如下：

```text
sourceUrl    必须存在
platform     必须存在
collectedAt  必须存在
title        必须存在
price.current 或 shop.name 二者至少存在一个
```

说明：
- 若 `title` 缺失，则用户无法确认商品主体，不满足最小可用结果
- 若 `price.current` 缺失但 `shop.name` 存在，可作为弱可用结果，判定为 `partial`
- 若仅有调试信息而没有商品主体字段，则必须判定为 `failed`

#### 5.5.5 SKU 与属性验收细则

**SKU 验收规则**：
- 若页面识别为单规格商品，`skus=[]` 允许通过，不单独判 `partial`
- 若页面识别为多规格商品，`skus` 至少包含 1 条记录，否则判定 `partial`
- 每条 SKU 至少应满足 `name` 非空；`price` 缺失允许降级
- `attributes` 中的规格键值若为空，需保留原始占位并记录 `diagnostics`

**属性验收规则**：
- `attributes` 允许为空对象，但若页面明确展示属性表而提取为空，应记为降级
- 属性名和属性值都应进行 trim；空白字符串视为缺失
- 重复属性键按“后者覆盖前者”处理，并在调试信息中记录冲突数

#### 5.5.6 诊断信息记录要求

当任务被判定为 `partial` 时，建议在 `snapshot_json` 或扩展字段中保留以下诊断信息：

```typescript
type ExtractionDiagnostics = {
  missingRequiredFields: string[]
  missingRecommendedFields: string[]
  degradedSources: string[]
  warnings: string[]
}
```

记录要求：
- `missingRequiredFields`：记录缺失的必填字段路径，如 `price.current`
- `missingRecommendedFields`：记录缺失的建议字段路径，如 `media.images`
- `degradedSources`：记录失败的数据来源，如 `network`、`state`
- `warnings`：记录非阻断问题，如“检测到多规格商品但仅提取到部分 SKU”

### 5.6 配置项定义

建议将配置项统一保存在 `config` 表或 `app_config.json` 中，并由 Rust 提供统一读写接口。

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `collector.maxConcurrency` | number | `1` | 最大并发采集任务数，默认单任务串行 |
| `collector.pageLoadTimeoutMs` | number | `30000` | 页面加载超时时间 |
| `collector.extractTimeoutMs` | number | `15000` | 提取阶段超时时间 |
| `collector.retry.maxAttempts` | number | `3` | 最大自动重试次数 |
| `collector.retry.backoffMs` | number[] | `[5000,15000,30000]` | 重试退避时间 |
| `collector.debug.enabled` | boolean | `true` | 是否保存调试快照 |
| `collector.debug.keepDays` | number | `7` | 调试产物保留天数 |
| `collector.browser.channel` | string | `chromium` | Playwright 浏览器通道 |
| `collector.browser.headless` | boolean | `false` | 开发阶段默认显示浏览器 |
| `collector.proxy.server` | string | `''` | 可选代理地址 |
| `export.defaultDir` | string | `~/Documents/taobao-collector` | 默认导出目录 |
| `export.formats` | string[] | `['json','csv','xlsx']` | 允许导出格式 |
| `account.loginTimeoutMs` | number | `300000` | 登录超时时间 |
| `account.autoCheckOnStartup` | boolean | `true` | 启动时自动检查账号状态 |

配置规则：
- 除路径类配置外，其余配置变更后优先热更新；无法热更新的项在 UI 中提示“重启后生效”
- 配置写入失败时，前端应展示明确错误并保留旧值
- 对数值型配置做边界校验，避免出现 `0`、负数或异常大值

### 5.7 协议容错与恢复

为保证 Rust 与 Sidecar 通信可恢复，建议在现有协议之上增加以下约束。

**协议扩展字段**：
```typescript
type Envelope<T> = {
  version: '1.0'
  requestId: string
  timestamp: string
  payload: T
}
```

约束要求：
- 每条请求与响应都带 `version` 和 `requestId`，便于兼容升级和链路追踪
- Rust 在发送 `collect`、`open_login`、`cancel` 指令后，需等待 Sidecar ACK；超过 3 秒未收到则判定通信异常
- Sidecar 启动后先发送 `ready`，Rust 未收到 `ready` 不允许分发业务请求
- Sidecar 每 10 秒发送一次心跳消息；Rust 连续 3 次未收到心跳则执行重启策略

**超时与重试**：
- `open_login`：30 秒内未创建浏览器窗口则返回失败
- `collect`：按任务阶段分别计时，`loading_page` 与 `extracting` 独立超时
- `cancel`：收到取消后 5 秒内必须返回任务结束事件，否则 Rust 强制终止浏览器上下文

**恢复策略**：
- Sidecar 异常退出时，Rust 将运行中任务统一标记为 `failed`，错误码为 `SIDECAR_CRASHED`
- 若任务处于 `loading_page` 或 `extracting` 且 `retryable=true`，可转为 `recoverable` 并允许用户手动重试
- 应用启动时扫描 `queued`、`launching_browser`、`loading_page`、`extracting` 等未完成任务，补写结束状态与错误原因
- 检测到浏览器子进程残留时，优先尝试优雅关闭，失败后再执行强制回收

**建议新增事件**：
```typescript
listen('collector:heartbeat_lost', (e: { sidecarId: string }) => {})
listen('collector:recoverable_failed', (e: { taskId: string; error: CollectorError }) => {})
listen('account:login_status_changed', (e: { profileId: string; status: string }) => {})
```

---

## 6. 数据模型

### 6.1 SQLite Schema

```sql
CREATE TABLE profiles (
  id          TEXT PRIMARY KEY,
  alias       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'taobao',
  profile_dir TEXT NOT NULL,
  login_status TEXT NOT NULL DEFAULT 'unknown',
  last_used_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL,
  status       TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  final_url    TEXT,
  entity_types TEXT NOT NULL DEFAULT 'product',
  progress     INTEGER DEFAULT 0,
  retry_count  INTEGER DEFAULT 0,
  error_json   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL UNIQUE,
  title         TEXT,
  price_current TEXT,
  shop_name     TEXT,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE artifacts (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL,
  type      TEXT NOT NULL,
  path      TEXT NOT NULL,
  meta_json TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 6.2 任务状态机

```text
created → queued → launching_browser → [waiting_login] → loading_page
  → extracting → [downloading_assets] → normalizing → persisting
  → completed | partial | failed | cancelled
```

### 6.3 索引与迁移策略

**建议索引**：

```sql
CREATE INDEX idx_tasks_profile_created_at ON tasks(profile_id, created_at DESC);
CREATE INDEX idx_tasks_status_updated_at ON tasks(status, updated_at DESC);
CREATE INDEX idx_products_created_at ON products(created_at DESC);
CREATE INDEX idx_artifacts_task_type ON artifacts(task_id, type);
```

设计说明：
- `tasks(profile_id, created_at)`：用于账号维度查看任务历史
- `tasks(status, updated_at)`：用于待处理、失败任务筛选
- `artifacts(task_id, type)`：用于任务详情页快速读取截图、HTML、网络日志

**迁移策略**：
- 使用 `schema_version` 记录数据库版本，随应用发布递增
- 应用启动时由 Rust 检查当前版本，按顺序执行迁移脚本，禁止跳步写库
- 每个迁移脚本必须具备幂等性，并在事务中执行
- 重大结构变更前自动备份数据库文件，备份失败则终止迁移
- 迁移完成后写入迁移日志，包括版本号、执行时间、结果与错误信息

**兼容规则**：
- 新增字段优先采用“可空 + 默认值 + 延迟回填”策略，避免旧数据不可读
- 删除字段需至少跨一个小版本完成弃用，先停止写入，再移除读取依赖
- 对 `snapshot_json`、`error_json` 这类 JSON 字段增加版本号，避免反序列化失败

---

## 7. 错误处理策略

### 7.1 错误分类

| 错误码 | 触发场景 | 是否可重试 |
|--------|----------|------------|
| `LOGIN_REQUIRED` | 未登录访问需登录页面 | 否（需先登录） |
| `LOGIN_EXPIRED` | 登录态失效 | 否（需重新登录） |
| `PAGE_LOAD_TIMEOUT` | 页面加载超时 | 是 |
| `RISK_CONTROL_BLOCKED` | 触发风控验证 | 否（需人工处理） |
| `SELECTOR_NOT_FOUND` | 关键 DOM 节点不存在 | 是（降级处理） |
| `NETWORK_CAPTURE_EMPTY` | 未捕获到目标接口 | 是（降级处理） |
| `NORMALIZE_FAILED` | 数据归一化失败 | 否 |
| `EXPORT_FAILED` | 文件写入失败 | 是 |

### 7.2 降级策略

- 网络监听失败 → 仅使用 DOM 提取结果，任务标记为 `partial`
- DOM 提取部分字段失败 → 保留已提取字段，缺失字段记录到 `diagnostics`
- 图片下载失败 → 保留图片 URL，不阻塞主流程

### 7.3 重试机制

- 可重试错误最多重试 3 次
- 重试间隔：5s / 15s / 30s（指数退避）
- 重试次数记录到 `tasks.retry_count`

---

## 8. 安全设计

### 8.1 本地数据保护

- Profile 目录权限设置为仅当前用户可读写（`chmod 700`）
- 数据库文件同样限制权限
- 调试快照中的 cookie、token 字段自动替换为 `[REDACTED]`

### 8.2 Sidecar 通信安全

- Sidecar 只通过 stdin/stdout 与主进程通信，不监听网络端口
- 若改为本地 HTTP，需绑定 `127.0.0.1`，并使用启动时生成的一次性 token 鉴权

### 8.3 Tauri CSP 配置

```json
{
  "security": {
    "csp": "default-src 'self'; script-src 'self'; connect-src ipc: http://ipc.localhost"
  }
}
```

---

## 9. 构建与部署

### 9.1 目录结构

```text
taobao-collector-desktop/
├── src/                  # Vue 3 前端
├── src-tauri/            # Tauri Rust 后端
│   └── binaries/         # 打包后的 collector sidecar 二进制
├── collector/            # Node.js sidecar 源码
└── docs/
```

### 9.2 开发环境搭建

```bash
# 安装依赖
pnpm install
cd collector && pnpm install

# 开发模式
pnpm tauri dev

# 单独调试 collector
cd collector && pnpm dev
```

### 9.3 打包流程

1. 构建 collector：`cd collector && pnpm build && pkg . --target node18-macos-arm64`
2. 将 collector 二进制放入 `src-tauri/binaries/`
3. 构建 Tauri 应用：`pnpm tauri build`

### 9.4 跨平台构建矩阵

| 平台 | 架构 | Node target | Tauri target |
|------|------|-------------|--------------|
| macOS | arm64 | `node18-macos-arm64` | `aarch64-apple-darwin` |
| macOS | x64 | `node18-macos-x64` | `x86_64-apple-darwin` |
| Windows | x64 | `node18-win-x64` | `x86_64-pc-windows-msvc` |

### 9.5 macOS 发布注意事项

- sidecar 二进制需要签名（`codesign`）
- Playwright Chromium 相关文件需要签名策略
- 应用需要 notarization 才能在 macOS 上正常运行
- 首次启动时处理 Gatekeeper 权限提示

---

## 10. 测试策略

### 10.1 单元测试

测试范围：
- `extractors/dom.ts`：输入固定 HTML，验证字段提取结果
- `extractors/state.ts`：输入固定 JSON，验证字段路径解析
- `extractors/normalizer.ts`：输入多路数据，验证优先级合并逻辑
- `parsers/taobao.ts`：验证选择器配置正确性

测试工具：`vitest`

### 10.2 集成测试

测试范围：
- Rust ↔ Sidecar stdin/stdout 通信协议
- SQLite 数据库 CRUD 操作
- 文件导出（JSON / CSV / Excel）

### 10.3 样本回归测试

维护本地样本库：
```text
fixtures/
├── product/
│   ├── normal/           # 正常商品页
│   ├── login_required/   # 需要登录
│   ├── risk_control/     # 风控拦截
│   └── price_changed/    # 价格变动
└── shop/
```

每个样本包含：
- `page.html`：页面 HTML 快照
- `state.json`：页面状态数据
- `network.json`：网络响应数据
- `expected.json`：期望提取结果

回归触发时机：
- 修改选择器或字段映射
- 升级 Playwright 版本
- 收到线上失败样本并修复后

### 10.4 手工测试检查清单

- [ ] 首次启动引导流程完整
- [ ] 手动登录并保存登录态
- [ ] 复用登录态采集商品
- [ ] 采集失败时展示错误与调试快照
- [ ] 导出 JSON / CSV / Excel 格式正确
- [ ] 多账号切换正常
- [ ] 应用更新流程正常
- [ ] macOS / Windows 双平台验证

### 10.5 异常场景专项检查

- [ ] 登录窗口被用户主动关闭后，账号状态保持未登录
- [ ] 登录过程中触发滑块验证时，界面能提示人工处理
- [ ] 登录超过超时时间后，任务与账号状态正确回收
- [ ] Sidecar 异常退出后，运行中任务被标记失败且可见错误原因
- [ ] 应用重启后，未完成任务被正确恢复或标记为中断失败
- [ ] 导出目录无写权限时，返回 `EXPORT_FAILED` 且不影响原始数据保存
- [ ] 数据库迁移失败时，应用提示清晰且数据库能从备份恢复
- [ ] 调试目录达到保留期限后，清理任务不会误删最新产物
