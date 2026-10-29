# 架构

## 1. 总体结构

FX42 是单进程 TypeScript monorepo。Nuxt/Nitro 负责 HTTP、SSR、REST、SSE 和前端资源；同一个 Node 进程内运行交易运行时（行情、风控、任务、调度、控制 socket）。

```text
Browser
  ├─ Nuxt SSR / Vue app
  ├─ REST /api/*
  └─ SSE /api/stream/*
        │
        ▼
apps/web (Nitro)
  ├─ server/plugins/runtime.ts
  ├─ server/routes/*
  └─ server/utils/*
        │
        ▼
packages/runtime
  ├─ PriceStore / FeedRuntime
  ├─ RiskLoop
  ├─ JobWorker
  ├─ Scheduler
  └─ ControlServer
        │
        ▼
packages/application
  ├─ accounts / funding
  ├─ trading / risk
  └─ use cases
        │
        ├──────────────┐
        ▼              ▼
packages/domain     packages/db
pure math/risk      SQLite / ledger / repos
        │
        └──────────────┐
                       ▼
                packages/clients
                scam / biquote / OIDC / crypto
```

## 2. 包职责

| 包                     | 职责                                                     | 不应包含               |
| ---------------------- | -------------------------------------------------------- | ---------------------- |
| `packages/shared`      | 金额微单位、BigInt 工具、错误码、ID、系统时钟            | 业务规则、数据库、HTTP |
| `packages/contracts`   | zod 请求 schema、DTO 类型                                | 业务执行               |
| `packages/domain`      | 纯函数：名义价值、保证金、盈亏、费用、强平、风险门禁校验 | IO、数据库、网络       |
| `packages/config`      | YAML schema、环境变量、配置快照、风险指纹                | 交易逻辑               |
| `packages/db`          | SQLite schema、迁移、账本、按聚合组合的 repo、对账、种子 | HTTP、UI、外部 API     |
| `packages/clients`     | scam、biquote、OIDC、AES-GCM、mock 实现                  | 业务编排               |
| `packages/application` | 用例编排：账户、资金、下单、平仓、风控动作               | Vue、Nitro 路由        |
| `packages/runtime`     | composition root、行情/任务/风控循环、控制 socket        | 领域规则实现           |
| `apps/web`             | Nuxt/Nitro、认证、REST/SSE、前端 UI                      | 直接修改账本           |
| `apps/cli`             | 运维命令、控制 socket 调用、数据库运维                   | 前端逻辑               |

依赖方向由 `pnpm test:arch` 检查。数据库层直接使用 `better-sqlite3`、手写 SQL 和触发器，不引入 ORM；各聚合 repo 独立实现，由 `DbRepos` 组合，application 通过 `repos.users` / `repos.trading` 等字段访问。前端 SSE/可见性/定时器生命周期由 `@vueuse/core` 管理。

## 3. 启动流程

`apps/web/server/plugins/runtime.ts` 调用 `ensureRuntime()`：

1. 定位仓库根目录并加载根 `.env.local` / `.env`。
2. `loadEnv()` 校验环境变量；生产环境必须提供会话密钥和加密密钥。
3. `loadConfig()` 读取 `FX42_CONFIG_FILE`（默认 `./config/fx42.yaml`），执行 zod 校验。
4. 打开 SQLite，执行迁移。
5. 创建指标、日志、价格缓存、scam 客户端、OIDC registry。
6. 检查风险配置是否变化：
   - 无持仓：正常启动。
   - 有持仓且未设置 `FX42_ALLOW_RISK_CONFIG_CHANGE=1`：拒绝启动。
   - 有持仓且允许：入队 `recalc-risk`。
7. 写入 `config_snapshots`；mock 模式生成演示用户。
8. 构造行情、任务、风控、调度和控制 socket。
9. `start()`：启动行情源、任务循环、250ms 风控扫描、调度器和控制 socket。

请求处理只通过 `runtime()` / `ctx()` 获取运行时上下文，不在 route 中重复初始化数据库或配置。账户数字通过 `/api/stream/account` 的定时快照推送；不再维护事件 outbox。

## 4. 请求与写入边界

### 读取

- 页面 SSR 使用 `useRequestFetch()` 请求同源 API。
- 客户端使用 `useApi()`，统一处理 401 和错误码 Toast。
- 行情通过 SSE `/api/stream/market`。
- 账户数字通过 `/api/account/snapshot` 初始化和 `/api/stream/account` 定时快照刷新。
- 成交历史、通知、系统状态由页面按需轮询；不依赖事件流。

### 写入

所有资金写入必须经过 `packages/db`：

- `postLedger()` 是唯一余额变动入口。
- 事务分录必须平衡，real/virtual 不混账。
- SQLite 触发器拒绝修改/删除分录、解冻已终结交易和非平衡交易。
- 业务用例通过 `AppContext.uow` 提交事务；SQLite 适配器在 `packages/db` 中实现，application 不直接创建数据库事务。用例参数使用 `AccountContext` / `FundingContext` / `TradingContext` / `ReconciliationContext` 等窄依赖类型，而不是全部接收完整 `AppContext`。

金额在 API 中为十进制字符串；数据库为 int64 微单位（1e-8 FTK），运行时使用 `BigInt` 或 `Decimal`。

## 5. 语言与 URL

- i18n 使用 `no_prefix`，URL 不携带语言。
- 已登录用户的界面语言来自 `users.locale`，未登录时使用默认 `en`。
- 登录页语言切换只修改前端状态，不改变路径。
- `html lang` 随当前界面语言更新。

## 6. 设计约束

- **单实例**：SQLite 单写者，运行时和 web 必须同进程。
- **无管理后台**：不存在管理员角色；储备账户由 `SCAM_RESERVE_IBAN` / `SCAM_RESERVE_TOKEN` 环境变量指定，运维使用 CLI。
- **配置文件优先**：业务参数来自 YAML，不提供数据库配置界面。
- **行情驱动**：平台是唯一对手方，不维护订单簿或用户撮合。
- **余额不可直接写**：任何资金动作都必须有对应的复式账本交易和审计记录。
- **不静默改风险参数**：有持仓时变更关键风险参数会被拒绝或显式重算。
