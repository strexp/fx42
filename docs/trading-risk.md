# 交易与风控

## 1. 订单

v1 只支持市价单。请求通过 `/api/orders` 提交：

```json
{
  "mode": "virtual",
  "symbol": "EURUSD",
  "side": "long",
  "lots": "0.1",
  "leverage": 100,
  "type": "market",
  "clientOrderId": "web-...",
  "takeProfit": null,
  "stopLoss": null,
  "confirmStale": false
}
```

- `lots` 或 `units` 二选一。
- 手数必须符合 `minLots` / `lotStep` / `maxLots`。
- `clientOrderId` 幂等。
- 平台是唯一对手方；成交价来自 bid/ask 加 `spreadMarkupBps`。

### 支持的操作

- 开仓
- 加仓
- 减仓
- 平仓
- 反手
- 批量全平
- TP/SL
- 自动平仓保证金率
- 追加/撤出保证金

已有持仓时，下单面板会锁定杠杆和止损：

- 同向下单为加仓，杠杆必须与持仓一致
- 反向下单根据数量自动变为减仓、平仓或反手
- 订单预览会使用合并后的持仓计算加仓均价、保证金和强平价；减仓/平仓展示已实现盈亏、剩余数量、剩余保证金和剩余强平价；反手展示平仓部分盈亏和新仓信息
- 已有持仓时止损字段锁定；加仓和反手填写的止盈会更新到交易后的持仓，减仓/平仓保留原止盈止损

## 2. 逐仓保证金

每个持仓独立计算保证金、盈亏和强平价：

```text
margin = notional / leverage
equity = margin + unrealizedPnl
maintenance = notional × MMR
riskRatio = equity / maintenance
```

- 杠杆档位为全局配置，默认 1–1000x。
- MMR 按杠杆档位配置，单位为 bps。
- 保证金不足时不会自动从其他持仓调剂。
- 用户可以追加/撤出保证金；撤出后仍须满足初始保证金和缓冲要求。

### 部分平仓

- 使用 `POST /api/positions/:id/close`，可传 `units`；省略则全平。
- 平仓数量必须是 `contractSize × lotStep` 的整数倍。
- 剩余数量必须为 0，或不少于 `contractSize × minLots`；否则返回 `INVALID_UNITS`。
- 超量平仓直接拒绝，不再静默截断。
- 保证金按平仓比例释放，向下取整。
- 部分平仓保留 TP/SL；只有全部平仓才取消触发器。
- 部分平仓如果会产生负权益，则拒绝，要求改为全部平仓。
- 平仓订单标记 `reduce_only = 1`，成交记录 `action = reduce`。
- `clientOrderId` 支持重试幂等；同一 ID 不会重复平仓。

## 3. 盈亏

内部价格统一为「USD / 非 USD 单位」，盈亏按内部价格计算后再转换为 FTK。用户看到的所有价格已经是 FTK，因此等价于：

```text
long:  (markFtk − entryFtk) × units
short: (entryFtk − markFtk) × units
```

开仓、加仓和反手新开仓部分的手续费按 `max(notional × takerBps, fees.minOpenFee)` 计算；平仓手续费不设最低值。手续费、融资费、强平罚金和坏账都进入账本。

## 4. 风险等级

`scanPositionRisks` 每 250ms 扫描：

| riskRatio                   | 动作        |
| --------------------------- | ----------- |
| `≤ 1`                       | liquidation |
| `≤ autoCloseRatioBps/10000` | auto_close  |
| `≤ 1.15`                    | margin_call |
| `≤ 1.50`                    | danger      |
| `≤ 2.00`                    | warning     |

全平和减仓通常允许；开仓/加仓通过 `OrderRiskGate` 检查。部分平仓若会产生负权益会被拒绝，要求改为全部平仓。反手单（`units > 现有持仓`）的开仓部分同样按开仓处理：token、halt、周末、平台/用户敞口、持仓数、储备覆盖率、点差异常、最小/最大名义等检查全部生效。

- 用户状态和免责声明
- token 绑定（real）
- halt 状态
- 周末规则
- 市场开市/休市
- 报价陈旧
- 点差异常
- 平台净敞口
- 手数
- 可用余额
- 储备覆盖率

## 5. 强平与穿仓

`liquidatePosition`：

1. 校验价格和版本。
2. 重新计算 riskRatio。
3. 使用 bid/ask 平仓。
4. 结算保证金、已实现盈亏、强平罚金。
5. `insurance_fund` 系统钱包吸收缺口。
6. 仍不足的部分进入 `bad_debt`，并设置 `halt_opening`。
7. 写入 `liquidations` 和通知。
8. 设置用户强平冷却。

强平只处理现有持仓，不开新仓；部分强平/ADL 未实现。手动部分平仓不属于强平流程。

## 6. TP/SL 与自动平仓

- TP/SL 写入 `price_triggers`，每 1 秒扫描。
- 触发后调用正常平仓流程。
- 自动平仓由持仓的 `autoCloseRatioBps` 控制，范围为配置的 `autoCloseRatioMin`–`autoCloseRatioMax`。
- 设置时不得高于当前 `marginRatio` 的 90%，避免下一轮扫描立即触发平仓；前端按当前持仓的保证金率动态显示允许范围。
- 强平优先于自动平仓。

## 7. 周末规则

周末窗口从周五 NY 收盘前 `startBeforeCloseMinutes` 开始，覆盖周六、周日直到周日 17:00 NY 后 `reopenGraceMinutes`。窗口内：

- 计算周末最低保证金：`notional / weekend.maxLeverage`
- 不足时发送 `weekend.margin` 通知
- 在 `reduceBeforeCloseMinutes` 内仍不足时强制平仓
- 周末窗口内禁止开仓、加仓和反手开仓；`weekend.maxLeverage` 只用于要求已有持仓补足周末最低保证金，不是“仍可开仓”的杠杆上限

默认 `maxLeverage: 50`。

## 8. 每日融资

- 每天 00:00 UTC 计算（`Scheduler` 固定该时间；`financing.settlementUtc` 目前是保留字段）。
- 按 `notional × annualRateBps / 10000 / 365` 折算日费率，对全部开仓持仓统一收取，不区分方向或品种。
- 优先从钱包余额扣除，不足则从持仓保证金扣除。
- 仍不足时发送 `financing.unpaid` 通知。
- 启动时补算最近 7 天，按 `chargeDate` 幂等。

## 9. 通知

通知写入 `notifications`，payload 包含具体上下文：

- `margin.*`：symbol、positionId、ratio
- `weekend.margin` / `weekend.closed`（历史类型；周末强平现在写入 `position.closed`）
- `financing.unpaid`
- `position.closed`：手动平仓、TP/SL、自动平仓、周末平仓和运维平仓，包含 closePrice、reason、realized、fullyClosed
- `liquidation`
- `bad_debt`
- `risk.recalculated`
- `deposit.credited`
- `withdrawal.sent` / `withdrawal.failed`
- `reserve.coverage`（历史类型；当前没有管理员接收者，覆盖率告警仅写日志）

保证金提醒会检查同一持仓是否已有未读的 `margin.*` 通知；有未读时不重复创建。用户全部标记已读后，后续风险变化可再次提醒。

## 10. 风控任务

- `RiskLoop`：250ms 风险扫描
- `RiskLoop`：1s TP/SL 扫描
- `JobWorker`：500ms 队列轮询
- `Scheduler`：
  - 30s deposit-sync / withdrawal-reconcile
  - 5min reserve-monitor / reconcile / weekend-review
  - 24h cleanup
  - 每日融资
- 账本不平：立即 `halt_all`
