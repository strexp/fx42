# 测试与质量门禁

## 1. 测试分层

| 层               | 位置                      | 内容                                                    |
| ---------------- | ------------------------- | ------------------------------------------------------- |
| domain           | `packages/domain/test`    | 名义、保证金、盈亏、强平价、风险门禁                    |
| shared           | `packages/shared/test`    | 金额边界、micros、BigInt                                |
| config           | `packages/config/test`    | 配置校验、缺失文件、环境变量                            |
| contracts        | `packages/contracts/test` | zod schema、请求边界                                    |
| db / integration | `packages/db/test`        | 账本、触发器、下单、平仓、强平、自动充值                |
| runtime          | `packages/runtime/test`   | mock 行情、PriceStore、任务与风控循环                   |
| E2E              | `tests/e2e`               | mock 登录、页面、钱包、交易、部分平仓、账户快照自动刷新 |

## 2. 命令

```bash
pnpm test              # 单元 + 集成
pnpm test:watch
pnpm test:contracts
pnpm test:arch         # dependency-cruiser 依赖方向
pnpm test:e2e          # Playwright
pnpm lint
pnpm typecheck
pnpm --filter @fx42/web typecheck
pnpm build
pnpm db:check
```

CI 会按同样顺序执行，并额外跑 E2E 和账本检查。

## 3. 关键覆盖

- 复式记账平衡、不可变分录、mode 隔离
- 钱包余额与账本一致
- 开/加/减/平/反手；反手单开仓部分的全部风控门禁
- 手动部分平仓：步长、最小剩余、TP/SL 保留、幂等、坏账保护
- 自动平仓比例不得超过当前保证金率的 90%
- 账户快照：钱包与持仓同源、real/virtual 隔离、前端自动刷新
- TP/SL 只触发一次
- 强平、`insurance_fund`、坏账
- 周末保证金
- 融资扣款
- 自动充值、异常转入、提现状态机
- 最小手数/步长
- 100x / 1000x 和 1e16/1e18 micros 边界
- 用户语言偏好、通知去重
- 仪表盘权益与交易页持仓 PnL 在行情变化后自动刷新

## 4. E2E 环境

`pnpm test:e2e` 使用 `playwright.config.ts`，默认 mock 模式：

- `config/fx42.mock.yaml`
- `data/e2e.db`（每次启动前清理）
- db/integration 测试使用 `createMemoryDb()`，不写磁盘
- 自动启动 Nuxt 服务

E2E 不应依赖真实 scam.dn42、biquote 或 OIDC。

## 5. 修改代码后的最低要求

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

涉及数据库 schema、账本、资金或交易时额外执行：

```bash
pnpm db:schema
pnpm db:check
pnpm test:e2e
```

涉及依赖方向或包边界时执行：

```bash
pnpm test:arch
```
