# API

所有 API 位于 `apps/web/server/routes`。请求/响应 DTO 定义在 `packages/contracts`，金额为字符串，ID 为字符串。所有行情、持仓、订单和成交价格均为 FTK；前端不做价格单位换算。

## 1. 认证与用户

| 方法  | 路径                                | 说明                                    |
| ----- | ----------------------------------- | --------------------------------------- |
| GET   | `/api/auth/providers`               | 启用的 OIDC provider 列表               |
| GET   | `/api/auth/oidc/:provider`          | 发起 OIDC 登录，支持 `redirect`         |
| GET   | `/api/auth/oidc/:provider/callback` | provider 独立回调                       |
| POST  | `/api/auth/logout`                  | 登出；`?allDevices=true` 使所有会话失效 |
| GET   | `/api/me`                           | 当前用户、身份、账户、偏好              |
| PATCH | `/api/me`                           | 更新显示名、locale、默认模式            |
| POST  | `/api/onboarding/accept`            | 接受免责声明并选择默认模式              |
| GET   | `/api/accounts`                     | 当前用户账户                            |

不存在管理员角色或管理员 API。

## 2. 账户快照

| 方法 | 路径                                  | 说明                                        |
| ---- | ------------------------------------- | ------------------------------------------- |
| GET  | `/api/account/snapshot?mode=`         | 当前模式的钱包 + 全部持仓原子快照           |
| GET  | `/api/stream/account?mode=&interval=` | 账户快照 SSE；默认 1000ms，范围 500–10000ms |

响应：

```json
{
  "mode": "virtual",
  "wallet": {
    "balance": "1000000",
    "equity": "1000123.45",
    "marginUsed": "11150",
    "unrealizedPnl": "123.45",
    "available": "1000000",
    "currency": "VFTK"
  },
  "positions": [],
  "serverTime": 1793340000000,
  "sequence": 42
}
```

- `wallet` 与 `positions` 来自同一次服务端计算。
- SSE 每 `interval` 推送完整 `snapshot`。
- 前端只替换完整快照，不在本地重新计算权益或 PnL。

## 3. 行情

| 方法 | 路径                                            | 说明                                        |
| ---- | ----------------------------------------------- | ------------------------------------------- |
| GET  | `/api/markets`                                  | 全部启用品种 ticker                         |
| GET  | `/api/markets/:symbol/ticker`                   | 单品种 ticker                               |
| GET  | `/api/markets/:symbol/candles?interval=&limit=` | K 线 + SMA                                  |
| GET  | `/api/market-sessions`                          | 四大市场时钟                                |
| GET  | `/api/stream/market?symbols=&interval=`         | 行情 SSE；默认 250ms，interval 可到 10000ms |

ticker 还包含 `pipSize`（按当前价格动态计算）、`spreadPips`、`spreadSpike`、`leverageTiers`、`autoCloseRatioMin` / `autoCloseRatioMax` 等字段。

## 4. 钱包与资金

| 方法   | 路径                                | 说明                               |
| ------ | ----------------------------------- | ---------------------------------- |
| GET    | `/api/wallet?mode=`                 | 钱包余额、权益、保证金、未实现盈亏 |
| GET    | `/api/wallet/ledger?mode=`          | 资金流水                           |
| GET    | `/api/deposits?mode=`               | 充值记录                           |
| GET    | `/api/deposits/:id`                 | 单笔充值                           |
| POST   | `/api/deposits/virtual`             | virtual 充值                       |
| POST   | `/api/deposits/auto`                | real 自动充值                      |
| GET    | `/api/withdrawals?mode=`            | 提现记录                           |
| GET    | `/api/withdrawals/:id`              | 单笔提现                           |
| POST   | `/api/withdrawals`                  | 创建提现                           |
| POST   | `/api/withdrawals/:id/cancel`       | 取消 requested 提现                |
| GET    | `/api/wallet/scam-accounts`         | 当前凭证下外部账户                 |
| POST   | `/api/wallet/scam-token`            | 绑定/重新绑定 token                |
| DELETE | `/api/wallet/scam-token`            | 解绑 token                         |
| POST   | `/api/wallet/scam-accounts/primary` | 设置默认提现账户                   |

## 5. 交易

| 方法 | 路径                            | 说明                                                         |
| ---- | ------------------------------- | ------------------------------------------------------------ |
| POST | `/api/orders/preview`           | 计算动作（开/加/减/平/反手）、名义、保证金、费用、强平价     |
| POST | `/api/orders`                   | 提交市价单                                                   |
| GET  | `/api/orders?mode=`             | 订单列表                                                     |
| GET  | `/api/orders/:id`               | 单笔订单                                                     |
| GET  | `/api/positions?mode=`          | 持仓 + 钱包                                                  |
| POST | `/api/positions/:id/close`      | 平仓/部分平仓；支持 `units`、`confirmStale`、`clientOrderId` |
| POST | `/api/positions/close-all`      | 全平当前模式                                                 |
| POST | `/api/positions/:id/margin`     | 追加/撤出保证金                                              |
| PUT  | `/api/positions/:id/tpsl`       | 设置 TP/SL                                                   |
| PUT  | `/api/positions/:id/auto-close` | 设置自动平仓比例（不得高于当前 marginRatio × 0.9）           |

### 部分平仓

`POST /api/positions/:id/close` 请求：

```json
{
  "units": "5000",
  "confirmStale": false,
  "clientOrderId": "close-web-..."
}
```

- 省略 `units` 表示全部平仓。
- 部分平仓数量必须对齐 `contractSize × lotStep`。
- 剩余数量必须为 0，或不少于 `contractSize × minLots`。
- 部分平仓保留 TP/SL；全部平仓才取消。
- `clientOrderId` 用于重试幂等。

响应额外包含：

```json
{
  "closedUnits": "5000",
  "remainingUnits": "15000",
  "fullyClosed": false
}
```

## 6. 历史与状态

| 方法 | 路径                         | 说明                             |
| ---- | ---------------------------- | -------------------------------- |
| GET  | `/api/history/fills?limit=`  | 成交记录                         |
| GET  | `/api/history/pnl`           | 已实现盈亏                       |
| GET  | `/api/stats/overview`        | 24h 平台统计                     |
| GET  | `/api/system/status`         | 模式、halt、行情状态、周末、储备 |
| GET  | `/api/me/notifications`      | 通知列表                         |
| POST | `/api/me/notifications/read` | 全部标记已读                     |

## 7. 健康与指标

| 方法 | 路径       | 说明                                   |
| ---- | ---------- | -------------------------------------- |
| GET  | `/healthz` | 进程 + SQLite quick_check + 队列计数   |
| GET  | `/readyz`  | 运行时 ready + 首个行情                |
| GET  | `/metrics` | Prometheus；生产环境需 `METRICS_TOKEN` |

## 8. 错误格式

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Not enough available balance",
    "details": {},
    "requestId": "..."
  }
}
```

错误码定义于 `packages/shared/src/errors.ts`。前端通过 `errors.<code>` i18n key 映射显示。

常见错误：

- `UNAUTHORIZED` / `SESSION_INVALID`：跳转登录
- `TERMS_REQUIRED`：需先接受免责声明
- `ONBOARDING_REQUIRED`：需完成 onboarding
- `TOKEN_REQUIRED` / `TOKEN_INVALID`：real 账户外部凭证问题
- `INSUFFICIENT_BALANCE` / `MARGIN_REQUIRED`
- `MARKET_CLOSED` / `MARKET_STALE` / `SPREAD_SPIKE`
- `STALE_CLOSE_BLOCKED`
- `RESERVE_INSUFFICIENT`
- `RATE_LIMITED`
- `DB_BUSY`

## 9. 约定

- 金额和价格字符串，不使用浮点数。
- 写操作需要 `requestId` 或 `clientOrderId` 实现幂等。
- 查询 mode 缺省时使用用户默认模式。
- SSE 使用 `Cache-Control: no-cache, no-transform`，反向代理必须关闭缓冲。
