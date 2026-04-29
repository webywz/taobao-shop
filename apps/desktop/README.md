# TB PDD Image Desktop

基于 `Tauri + Vue3` 的桌面端，功能对齐 `apps/web` 的核心流程：

- 激活授权
- 创建提取任务
- 查看任务列表和任务详情
- 任务压缩包与格式转换

## 开发运行

在仓库根目录执行：

```bash
npm run dev:api
```

新开一个终端执行：

```bash
npm run dev:desktop
```

## 构建

```bash
npm run build:desktop
```

## 环境变量

`apps/desktop` 默认请求 `http://127.0.0.1:8000`。如需改为其它 API 地址，可在 `apps/desktop/.env` 配置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```
