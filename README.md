# 淘宝 / 拼多多商品图片提取 SaaS 文档

这套文档已经整理为 5 份主文档，按“先看范围，再看实现，再看交付”的顺序阅读即可。

当前首版只聚焦主功能闭环，不接支付平台。范围包括：

- 卡密激活
- 插件安装与设备绑定
- 单链接任务创建
- 淘宝 / 拼多多图片提取
- 主图、SKU 图、详情图分类
- 图片上传、结果展示、ZIP 下载
- 图片格式转换
- 历史任务查看

## 阅读顺序

1. [overview-and-scope.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/overview-and-scope.md)
2. [frontend-product.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/frontend-product.md)
3. [backend-platform.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/backend-platform.md)
4. [extension-and-extractors.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/extension-and-extractors.md)
5. [delivery-and-qa.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/delivery-and-qa.md)

## 文档分工

- [overview-and-scope.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/overview-and-scope.md)：产品范围、边界、架构、角色、主链路
- [frontend-product.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/frontend-product.md)：页面结构、交互、状态、视觉风格
- [backend-platform.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/backend-platform.md)：技术选型、鉴权、API、状态机、数据模型、部署
- [extension-and-extractors.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/extension-and-extractors.md)：插件设计、运行时流程、淘宝 / 拼多多提取规则
- [delivery-and-qa.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/delivery-and-qa.md)：开发顺序、里程碑、测试、上线检查

如果已经进入开发阶段，优先看：

- [backend-platform.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/backend-platform.md) 的接口协议和默认值
- [extension-and-extractors.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/extension-and-extractors.md) 的运行时序和字段映射
- [delivery-and-qa.md](/Users/weize/Desktop/taobao-pdd-image-saas-docs/delivery-and-qa.md) 的开发启动清单与派工建议

## 本轮补充重点

- 明确角色、术语、输入输出约束和不承诺项
- 补齐前端页面状态、联调约定和插件状态判断
- 补齐后端数据模型、对象存储规范、队列、鉴权和部署建议
- 补齐插件轮询、心跳、上传、安全边界和调试要求
- 补齐交付验收、联调顺序、上线与回滚预案
- 保持文档数量不变，直接把字段级协议、时序和开发冻结项收进现有文档
- 已明确卡密为时间授权模型，不做额度；ZIP 和转换产物保留期支持 `3天 / 7天 / 30天`

## 当前不做

- 支付平台接入
- 套餐购买
- 自动续费
- 退款流程
- 发票与财务对账

后续如果进入商业化阶段，再单独增加支付相关文档，不混入当前主功能实现。

## 插件 ZIP

当前手动安装用的插件 ZIP 不在项目根目录，生成后会放在：

- [apps/web/public/downloads/tb-pdd-image-extension.zip](/Users/weize/Desktop/taobao-pdd-image-saas-docs/apps/web/public/downloads/tb-pdd-image-extension.zip)

如果需要重新生成，直接在项目根目录执行：

```sh
npm run package:extension
```

这个命令会重新构建插件，并把 ZIP 同步到 Web 下载目录，供页面 `/downloads/tb-pdd-image-extension.zip` 直接下载。
