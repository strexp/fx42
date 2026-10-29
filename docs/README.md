# FX42 文档

本目录描述 **当前代码的实际行为**，不是历史计划或待讨论方案。修改实现时请同步更新对应文档。

## 阅读顺序

| 文档                                   | 内容                                     |
| -------------------------------------- | ---------------------------------------- |
| [architecture.md](./architecture.md)   | 系统边界、monorepo、运行时启动、请求链路 |
| [data-model.md](./data-model.md)       | SQLite schema、账本、金额精度、核心表    |
| [configuration.md](./configuration.md) | YAML 配置、环境变量、默认值、配置变更    |
| [auth-accounts.md](./auth-accounts.md) | OIDC、账户模型、免责声明、语言偏好       |
| [funding.md](./funding.md)             | scam 绑定、自动充值/提现、储备、异常转账 |
| [market-data.md](./market-data.md)     | biquote、价格缓存、K 线、SSE、货币换算   |
| [trading-risk.md](./trading-risk.md)   | 订单、保证金、盈亏、强平、周末、融资     |
| [api.md](./api.md)                     | REST/SSE、错误码、DTO 约定               |
| [frontend.md](./frontend.md)           | 页面、主题、i18n、图表、通知             |
| [operations.md](./operations.md)       | CLI、健康检查、Docker、备份、CI          |
| [testing.md](./testing.md)             | 测试分层、命令、质量门禁                 |
| [status.md](./status.md)               | 当前实现状态与已知限制                   |

## 产品边界

FX42 是部署在 DN42 内的虚拟外汇/CFD 平台：

- 用户通过一个或多个 OIDC provider 登录
- 每个用户有两个隔离账户：`real`（FTK）和 `virtual`（VFTK）
- real 账户通过 scam.dn42 自动充值/提现
- virtual 账户只使用内部虚拟资金
- 平台是每笔交易的唯一对手方，不做用户撮合
- 支持 1x–1000x、逐仓保证金、TP/SL、自动平仓、手动部分平仓、强平、融资费
- 账户和持仓数字通过后端快照自动刷新，前端不做价格单位换算
- 可作为 PWA 安装到 Android、iOS 与桌面；图标与离线页随应用发布
- 没有管理后台；配置和运维通过 YAML、环境变量和 `pnpm ops`

## 仓库结构

```text
apps/web
  app/                  Vue 页面、布局、组件、composables
  i18n/locales/         zh-CN / en 文案
  server/routes/        Nitro REST/SSE 路由
  server/plugins/       运行时初始化
  server/utils/         auth、DTO、runtime、限流等
apps/cli                fx42-ops CLI
packages/shared         micros、BigInt、错误、ID、时钟
packages/contracts      zod 请求 schema 与 DTO 类型
packages/domain         纯领域数学与风控门禁
packages/config         YAML schema、环境变量、配置快照
packages/db             schema、迁移、账本、repos/、对账
packages/clients        scam、biquote、OIDC、AES-GCM、mock
packages/application    用例层（账户、funding/、trading/、风控）
packages/runtime        行情、风控循环、任务、调度、控制 socket
```

## 文档维护规则

- 以代码为唯一事实来源。
- 不再保留“未实现计划”“旧方案比较”“历史决策过程”；这些内容不属于当前文档。
- 新功能必须同时更新 `docs/` 与 `README.md`。
- 涉及金额、账本、强平、资金流水的改动，必须同步更新 `data-model.md` / `funding.md` / `trading-risk.md`。
