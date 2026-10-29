# 资金与 scam.dn42

## 1. 账户绑定

用户绑定 scam.dn42 token：

1. 调用 scam `GET /api/accounts` 校验 token。
2. 记录 scam 用户信息和账户列表。
3. token 使用 AES-256-GCM 加密存储。
4. UI 只显示 token 尾号和账户信息。

限制：

- 有持仓、余额或未完成资金操作时不能重新绑定/解绑。
- 解绑需要二次确认。
- 绑定/解绑写入审计日志。

## 2. real 自动充值

用户选择自己已绑定的 scam 账户，输入金额后确认：

1. 服务端创建 pending deposit，生成内部对账 memo。
2. 使用用户 token 调用 scam `/api/transfer`，从用户账户转入环境变量指定的储备账户（`SCAM_RESERVE_IBAN`）。
3. 成功且拿到 transaction id：立即按交易记录入账。
4. 超时/5xx：保留 pending，由 30 秒一次的 `deposit-sync` 对账完成。
5. 明确失败：deposit 标记 failed，不记用户余额。

充值方向是 `用户账户 → 储备账户`。没有手动转账页面，也没有让用户填写 memo 的 UI。

### 对账与异常转账

`creditDepositFromTransaction()` 会检查：

- 目标是否为储备账户
- memo 是否存在
- memo 是否对应 pending deposit
- 是否已经入账
- 发送方是否为该 deposit 用户当前绑定账户

以下情况进入 `unmatched_transfers`：

- 无 memo
- 未知 memo
- 已入账 memo 被重复使用
- 过期
- 发送方不符
- cancelled / 其他异常

运维使用：

```bash
pnpm ops unmatched list
pnpm ops unmatched match <id> --user <id-or-MNT>
pnpm ops unmatched ignore <id>
```

## 3. virtual 充值

- 不调用 scam。
- 立即增加 VFTK 余额。
- 受 `virtual.maxDeposit` / `virtual.maxDailyDeposit` 限制。
- 产生正常 deposit 记录和账本交易。

## 4. real 自动提现

用户确认提现后：

1. 冻结用户余额到 `withdrawal_pending`。
2. 入队 `withdrawal-execute`。
3. 检查储备账户余额。
4. 使用 `SCAM_RESERVE_TOKEN` 调用 scam `/api/transfer` 转入用户选定的已绑定账户。
5. 成功：结算 pending，记录 `scam_ref`。
6. 明确失败：全额退回用户余额。
7. 超时：由 `withdrawal-reconcile` 按 `scam_ref` 对账。

提现目标必须属于当前用户当前 active 凭证，防止 IDOR。

## 5. virtual 提现

- 不调用 scam。
- 直接从 VFTK 余额扣除，状态直接 `settled`。
- 资金进入 virtual 系统储备钱包。

## 6. 费用与限额

来自 YAML：

- `fees.depositBps`
- `fees.withdrawFixed`
- `fees.withdrawBps`
- `funding.minDeposit` / `maxDeposit` / `maxDepositPerDay`
- `funding.minWithdraw` / `maxWithdraw` / `maxWithdrawPerDay`
- `funding.maxPendingDeposits`
- `virtual.maxDeposit` / `maxDailyDeposit`

金额最终按 4 位小数与 scam 交互，向下取整。

当前实现对过期 memo 仍有 7 天宽限：`expiresAt` 早于 7 天前才会进入 `unmatched_transfers` 的 `expired` 分支。

## 7. 储备监控

`monitorReserve` 每 5 分钟运行：

- 计算 real 用户余额、未实现盈亏、持仓保证金等负债；当前负债口径未单独计入 `withdrawal_pending`，且持仓负权益会直接冲减合计负债。
- 计算储备账户余额覆盖率。
- 覆盖率低于阈值时：
  - 设置 `reserve_coverage_ok=0`
  - 阻止 real 账户新的开仓/加仓（virtual 不受影响）
  - 记录 warning 日志（系统没有管理员通知接收者）
- 提现创建不直接读取覆盖率标志；`withdrawal-execute` 会按储备账户实际余额检查，不足时保持 `requested` 并等待补充储备后重试。

## 8. 账本记录

所有资金动作都是平衡交易：

- deposit：用户钱包增加，`external_reserve` 减少，手续费进入 `fee_income`
- withdrawal：用户钱包减少，`withdrawal_pending` → `external_reserve` / `fee_income`
- virtual：使用 `sys:virtual:*` 系统钱包，不触碰外部资金

任何异常都必须回滚整个 SQLite 事务。

## 9. UI 确认

以下操作都有二次确认：

- 充值
- 提现
- 取消提现
- 解绑外部账户
- 设为默认提现账户

确认框会显示模式、金额、币种和风险提示。
