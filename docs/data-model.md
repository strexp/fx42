# 数据模型与账本

## 1. SQLite

- 引擎：SQLite 3 + `better-sqlite3`
- 模式：WAL、`STRICT` 表
- 单进程、单写者
- 迁移：`packages/db/src/schema.sql`，启动时自动执行；`pnpm db:migrate` 可显式执行
- 生成文件：`packages/db/src/schema.generated.ts`（修改 schema 后运行 `pnpm db:schema`）
- 备份：Litestream；也可使用 `pnpm db:backup`

## 2. 金额精度

| 场景              | 表示                   |
| ----------------- | ---------------------- |
| 数据库余额/金额   | int64 微单位，1e-8 FTK |
| TypeScript 运行时 | `bigint`               |
| 领域计算          | `decimal.js`           |
| API / UI          | 十进制字符串           |

禁止使用 JS `number` 直接参与余额或交易金额计算。

系统钱包按 mode 隔离：

```text
external_reserve
withdrawal_pending
margin_pool
fee_income
insurance_fund
exchange_pnl
bad_debt
```

`external_reserve`、`exchange_pnl`、`bad_debt` 允许负余额；其余钱包禁止负余额。

## 3. 核心表

### 用户与账户

| 表                  | 说明                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `users`             | 用户、状态、locale、默认模式、session_version                                  |
| `user_identities`   | OIDC 身份；dn42 按 `active_mnt` 关联，generic 按 `(provider_id, subject)` 关联 |
| `trading_accounts`  | 每个用户的 real / virtual 账户                                                 |
| `terms_acceptances` | 一次性免责声明接受记录（IP、UA、时间）                                         |
| `scam_credentials`  | scam token 加密密文、提示尾号、状态                                            |
| `scam_accounts`     | 用户外部账户缓存、默认提现账户                                                 |
| `oidc_tokens`       | OIDC 流程临时状态                                                              |

### 账本

| 表               | 说明                                   |
| ---------------- | -------------------------------------- |
| `wallets`        | 用户钱包和系统钱包                     |
| `ledger_txs`     | 平衡交易头、mode、类型、引用、最终状态 |
| `ledger_entries` | 每个钱包的借贷分录和余额快照           |

账本触发器保证：

- 分录不可更新/删除
- 交易 finalized 后不可回退
- 同一交易不能混合 real/virtual
- 分录所属钱包必须与交易 mode 一致

`postLedger()` 在写入前同时校验分录合计为 0；失败不会留下部分写入。

### 交易

| 表                       | 说明                                                |
| ------------------------ | --------------------------------------------------- |
| `orders`                 | 市价订单、成交价、名义、手续费、reduce_only、幂等键 |
| `positions`              | 持仓、逐仓保证金、MMR、TP/SL 关联、版本号           |
| `fills`                  | 开/平/减仓成交明细与已实现盈亏                      |
| `price_triggers`         | TP/SL 触发价和状态                                  |
| `position_margin_events` | 追加/撤出/融资扣减保证金事件                        |
| `liquidations`           | 强平价格、权益、缺口、罚金                          |
| `financing_charges`      | 每日融资费扣款记录                                  |

### 资金

| 表                    | 说明                                                 |
| --------------------- | ---------------------------------------------------- |
| `deposits`            | real/virtual 充值、scam 交易号、memo、状态、幂等请求 |
| `withdrawals`         | 提现申请、网络费、scam_ref、目标账户、状态           |
| `unmatched_transfers` | 无 memo、未知 memo、重复 memo、发送方不符等异常转入  |
| `deposit_sync_state`  | 充值对账游标                                         |

### 行情与运行时

| 表                       | 说明                                         |
| ------------------------ | -------------------------------------------- |
| `market_prices`          | 最新报价快照                                 |
| `candles`                | 各周期 K 线                                  |
| `feed_status`            | 行情连接状态、最后 tick                      |
| `config_snapshots`       | 每次启动的配置 YAML / canonical JSON / hash  |
| `notifications`          | 用户通知，payload 为 JSON                    |
| `audit_logs`             | 运维和敏感操作审计                           |
| `jobs`                   | 后台任务队列                                 |
| `runtime_flags`          | halt、reserve coverage、通知冷却等运行时标志 |
| `reconciliation_reports` | 账本对账报告                                 |

schema 的完整字段以 [`packages/db/src/schema.sql`](../packages/db/src/schema.sql) 为准。v2 起移除 `outbox_events` 与 `idempotency_keys`，启动迁移会清理旧库中的同名表。

## 4. 账户隔离

- 每个用户创建两个 `trading_accounts`：`real` / `virtual`。
- 订单、持仓、钱包、充值、提现、账本交易全部带 mode。
- real 余额不能用于 virtual 交易，反之亦然。
- 除资金来源不同，real/virtual 的交易规则、费率、MMR、强平、周末和融资规则一致。

## 5. 对账

`pnpm db:check` 执行：

- SQLite `quick_check`
- 所有用户钱包余额与账本分录余额一致
- margin pool 与 open positions 的保证金一致
- 系统钱包和交易平衡
- 未完成迁移检查

`Scheduler` 每 5 分钟入队 `reconcile`，由 `JobWorker` 执行账本对账；不平衡时设置 `halt_all=1` 并记录报告。
