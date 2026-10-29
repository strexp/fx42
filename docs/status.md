# 当前状态

## 已实现

### 基础

- Nuxt 4 / Vue 3 / Nuxt UI 4 / TypeScript monorepo
- SQLite + `better-sqlite3`，WAL、STRICT、BigInt micros
- YAML 配置 + zod 校验 + `config_snapshots`
- 风险参数变更保护与 `recalc-risk`
- Docker、Litestream、CI、GHCR
- 仓储按聚合组合；账户数字通过 SSE 定时快照刷新

### 认证与账户

- 多 OIDC provider、独立回调
- DN42 按 `active_mnt` 合并，generic 按 `(provider, sub)` 隔离
- 一次性免责声明、onboarding、双账户
- 会话版本校验、用户暂停/关闭
- 用户语言偏好，URL 不携带语言

### 资金

- scam token 加密绑定/解绑
- real 自动充值 + 交易历史对账
- real 自动提现 + 失败退款 + 超时对账
- virtual 即时充值/提现
- 异常转入 `unmatched_transfers` 和 CLI 处理
- 储备覆盖率监控和熔断
- 资金操作二次确认

### 行情

- biquote SignalR + REST fallback
- 断流看门狗、行情快照、1s 持久化
- K 线缓存、SMA、SSE
- 点差异常、休市、陈旧报价策略
- 全系统统一 FTK 价格；后端入口归一化 USD-base 品种，前端无价格单位切换/换算
- 交易页行情 250ms；账户快照可见时 2s 自动刷新，页面隐藏时 8s

### 交易与风控

- 市价开/加/减/平/反手
- 1x–1000x、逐仓、TP/SL、自动平仓、手动部分平仓
- 风险门禁、平台净敞口、手数限制；反手单的开仓部分执行完整开仓检查
- 250ms 风险扫描、强平、`insurance_fund` 钱包、坏账
- 周末保证金、每日融资
- 平仓、强平、自动平仓和周末平仓通知
- 保证金通知未读去重
- 通知面板只显示未读，铃铛红点/变色

### 前端

- 登录、onboarding、仪表盘、行情、交易、持仓、钱包、历史、设置
- 主题预设、亮暗模式、PnL 颜色
- 中英双语、no-prefix URL、用户语言偏好
- 响应式布局、通知面板、二次确认
- 统一账户快照自动刷新：顶部权益、仪表盘、交易持仓、持仓页、钱包摘要
- `@vueuse/core` 管理 SSE、页面可见性、降级轮询和 debounce 生命周期
- `@number-flow/vue` 用于权益、余额、保证金、未实现盈亏等核心数字动画
- 免责声明正式文本和 meme 图片
- PWA：manifest、图标、service worker 与离线页；生产环境可安装到 Android、iOS 和桌面

## 已知限制

| 项                  | 状态   | 说明                                       |
| ------------------- | ------ | ------------------------------------------ |
| 真实 OIDC 联调      | 未完成 | 代码路径完整，需要注册实际 provider 并验证 |
| 真实 scam.dn42 联调 | 未完成 | mock 已覆盖主要流程，真实字段需按服务校准  |
| 真实 biquote 联调   | 未完成 | 需在 DN42 网络验证 hub 方法、字段和限流    |
| 限价单 / 挂单       | 未实现 | 当前只支持市价单 + TP/SL                   |
| 部分强平 / ADL      | 未实现 | 强平以整个持仓为单位                       |
| OpenAPI             | 未实现 | `packages/contracts` 可作为生成来源        |
| 独立 CSRF token     | 未实现 | 生产校验 Origin；没有 token 轮换           |
| 多实例              | 不支持 | SQLite 单写者，运行时与 web 必须同进程     |
| 管理后台            | 不做   | 运维使用 YAML + CLI                        |
| 交叉盘              | 不支持 | v1 只允许 quote=USD 或 base=USD            |
| 限流共享存储        | 未实现 | 当前为进程内内存桶                         |

## 下一步原则

1. 优先完成真实 OIDC、scam.dn42、biquote 的联调。
2. 任何资金/账本变更必须先补集成测试。
3. 不在没有迁移和回滚方案的情况下修改 schema。
4. 文档和实现同步更新；不再新增历史计划文档。
