# 配置

## 1. 配置文件

- 生产配置：`config/fx42.yaml`（纳入版本管理，不含敏感 token）
- mock / E2E：`config/fx42.mock.yaml`

`FX42_CONFIG_FILE` 指定配置文件；默认 `./config/fx42.yaml`。文件不存在时启动直接失败，不存在隐式回退或合并。

运行时会在启动时：

- 校验 YAML
- 校验 provider、品种、杠杆、MMR、回调路径
- 写入 `config_snapshots`
- 检测风险参数变化

## 2. 环境变量

| 变量                            | 必填     | 说明                                                      |
| ------------------------------- | -------- | --------------------------------------------------------- |
| `NODE_ENV`                      | 否       | `development` / `test` / `production`，默认 `development` |
| `FX42_MODE`                     | 否       | `production` / `mock`，默认 `production`                  |
| `DATABASE_PATH`                 | 否       | SQLite 路径，默认 `./data/fx42.dev.db`                    |
| `FX42_CONFIG_FILE`              | 否       | YAML 配置路径                                             |
| `NUXT_SESSION_PASSWORD`         | 生产必填 | 至少 32 字符，会话密封密钥                                |
| `NUXT_PUBLIC_BASE_URL`          | 否       | 外部访问地址，用于 OIDC callback 和 SEO                   |
| `FX42_ENCRYPTION_KEY`           | 生产必填 | 32 字节随机数的 base64，scam token AES-GCM 密钥           |
| `SCAM_BASE_URL`                 | 否       | scam.dn42 API 地址                                        |
| `SCAM_RESERVE_IBAN`             | 非 mock  | 储备账户 IBAN，仅由后端使用，不返回给用户（运行时必填）    |
| `SCAM_RESERVE_TOKEN`            | 非 mock  | 储备账户 scam token，仅由后端使用（运行时必填）            |
| `BIQUOTE_REST_URL`              | 否       | biquote REST 地址                                         |
| `BIQUOTE_HUB_URL`               | 否       | biquote SignalR hub 地址                                  |
| `FX42_ALLOW_RISK_CONFIG_CHANGE` | 否       | 有持仓时允许风险参数变更并调度重算                        |
| `FX42_CONTROL_SOCKET`           | 否       | 控制 socket 路径                                          |
| `LOG_LEVEL`                     | 否       | pino 日志级别                                             |
| `METRICS_TOKEN`                 | 否       | `/metrics` Bearer token                                   |

OIDC client secret 不写在 YAML 中；YAML 的 `clientSecretEnv` 指定环境变量名。

## 3. YAML 结构

### 基础

```yaml
ftkUsdRate: '0.01' # 1 FTK = 0.01 USD
leverageTiers: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
chart:
  mas: [5, 10, 20, 60]
```

### 费用

`minOpenFee` 是每笔开仓/加仓/反手新开仓部分的最低手续费，单位为 FTK；手续费按 `max(notional × takerBps, minOpenFee)` 计算。平仓手续费不使用该底线。

```yaml
fees:
  takerBps: 1
  minOpenFee: '1'
  spreadMarkupBps: 0
  depositBps: 0
  withdrawFixed: '0.1'
  withdrawBps: 10
```

`config/fx42.yaml` 使用 `minOpenFee: '1'`，`config/fx42.mock.yaml` 使用 `'0.1'`；两者都是 FTK 金额。

### 风险

```yaml
risk:
  maintenanceMarginByLeverage:
    1: 1000
    2: 200
    # ...
    1000: 5
  gapBufferBps: 2
  liquidationFeeBps: 100
  minOrderNotional: '100'
  maxOrderNotional: '20000000'
  maxUserNotional: '100000000'
  maxPositionsPerUser: 20
  maxSlippageBps: 50
  staleQuoteMs: 30000
  haltQuoteMs: 15000
  priceJumpBps: 500
  staleClosePolicy: confirm
  maxStaleCloseFeedGapMs: 60000
  cooldownAfterLiquidationSec: 60
  autoCloseRatioMin: '1.05'
  autoCloseRatioMax: '5.00'
  marketClosedPolicy: close-only
```

MMR 单位为 bps；每个启用的杠杆档位都必须配置。关键风险参数变化会被记录并对有持仓的重启进行保护。

当前实现说明：

- `minOrderNotional` / `maxOrderNotional` / `maxUserNotional` 以 FTK 计；`maxNetExposureUsd` 以 USD 计。
- `gapBufferBps` 只参与启动时的杠杆/MMR 安全校验，不参与运行时强平或保证金计算。
- `maxSlippageBps`、`priceJumpBps`、`staleClosePolicy` 仍是 schema 必填字段，但交易与行情链路尚未使用：市价单按 bid/ask（加 `spreadMarkupBps`）成交，没有滑点上限或跳空熔断；陈旧平仓由 `marketClosedPolicy` + `confirmStale` 控制。
- `autoCloseRatioMin/Max` 是静态范围；设置单个持仓时还会受当前 `marginRatio × 0.9` 限制，避免下一轮 250ms 扫描立即触发平仓。

### 资金

```yaml
funding:
  memoExpiryMinutes: 1440
  minDeposit: '0.01'
  maxDeposit: '1000000'
  maxDepositPerDay: '5000000'
  minWithdraw: '0.01'
  maxWithdraw: '1000000'
  maxWithdrawPerDay: '5000000'
  maxPendingDeposits: 5
```

`funding.*` 金额以 FTK 计；`virtual.*` 以 VFTK 计。`memoExpiryMinutes` 是自动充值对账标识的有效期，不是手动转账功能。当前实现对过期 memo 仍有 7 天宽限：`expiresAt` 早于 7 天前才会进入 `unmatched_transfers` 的 `expired` 分支。

### 品种

每个启用的品种必须满足 v1 单 USD 约束：`quote=USD` 或 `base=USD`。交叉盘会在启动校验时被拒绝。

```yaml
instruments:
  - symbol: EURUSD
    enabled: true
    description: Euro vs US Dollar
    contractSize: '1000'
    pipSize: '0.0001'
    pricePrecision: 5
    minLots: '0.01'
    lotStep: '0.01'
    maxLots: '100'
    maxNetExposureUsd: '1000000'
  - symbol: USDJPY
    enabled: true
    description: Japanese Yen vs US Dollar
    contractSize: '1000'
    pipSize: '0.01'
    pricePrecision: 8
    minLots: '0.01'
    lotStep: '0.01'
    maxLots: '100'
    maxNetExposureUsd: '1000000'
```

`contractSize` 决定 1 手对应的数量；`maxNetExposureUsd` 以 USD 计。`base=USD` 品种会在后端入口自动归一化为「非 USD 货币 / USD」方向，不需要也不允许配置反转开关；所有用户可见价格统一从后端以 FTK 输出。`config/fx42.yaml` 当前使用 `1000`，`config/fx42.mock.yaml` 使用 `100000`，两者的最小单名义和经济规模不同，切换环境时需要注意。

`base=USD` 品种的 `pipSize` 填原生报价（USD/XXX）的 pip，例如 USDJPY 为 `0.01`、USDCAD 为 `0.0001`。引擎会在归一化后的 XXX/USD 价格空间按 `pipSize × P²` 动态换算，因此 `pricePrecision` 需要 7–9 位（当前配置为 8）。

### 周末、融资

```yaml
weekend:
  enabled: true
  startBeforeCloseMinutes: 180
  reduceBeforeCloseMinutes: 30
  maxLeverage: 50
  action: margin-call-then-reduce
  reopenGraceMinutes: 5

financing:
  enabled: true
  annualRateBps: 500
  basis: notional
  settlementUtc: '00:00'
```

`financing.settlementUtc` 目前是保留字段；融资任务由 `Scheduler` 固定为每日 `00:00 UTC` 入队，尚未按该字段调整时间。融资费按 `notional × annualRateBps / 10000 / 365` 对全部开仓持仓统一收取。

### 虚拟账户

```yaml
virtual:
  maxDeposit: '10000000'
  maxDailyDeposit: '50000000'
```

### OIDC

```yaml
auth:
  providers:
    - id: oauth-dn42
      kind: dn42
      displayName: 'oauth.dn42'
      issuer: 'https://oauth.dn42'
      clientId: '...'
      clientSecretEnv: FX42_OIDC_OAUTH_DN42_CLIENT_SECRET
      scopes: [openid, profile, email, dn42]
      mntClaim: active_mnt
      enabled: true
```

要求：

- `id` 全局唯一
- `issuer` 必须是 IdP 宣称的规范 issuer
- discovery URL 由 `issuer` 派生：`<issuer>/.well-known/openid-configuration`
- callback path 由 `id` 派生：`/api/auth/oidc/<id>/callback`
- `kind=dn42` 必须包含 `dn42` scope
- `mntClaim` 指定承载 MNT 的 claim 字段，默认 `active_mnt`
  - 普通字段名会先查 `dn42` claim 对象，再查顶层 claims（兼容原有 `dn42.active_mnt`）
  - 支持点路径，例如 `dn42.mnt`、`resource_access.dn42.mnt`
- `sub` 由 IdP 返回并作为身份键使用，FX42 不假设固定的 `sub` 生成算法
- 每个启用的 provider 必须配置对应的 client secret；多个 provider 可以共享同一个环境变量

## 4. 配置变更

- 普通非风险参数：重启生效。
- 风险指纹参数（FTK 汇率、杠杆、MMR、taker fee、周末杠杆、融资、强平费）变化：
  - 无持仓：正常启动。
  - 有持仓：默认拒绝启动。
  - 设置 `FX42_ALLOW_RISK_CONFIG_CHANGE=1`：入队 `recalc-risk` 后启动。
- 配置快照和 hash 写入 `config_snapshots`，用于审计和对账。

## 5. 开发与 mock

`pnpm dev:mock` 会设置：

```text
FX42_MODE=mock
FX42_CONFIG_FILE=./config/fx42.mock.yaml
DATABASE_PATH=./data/fx42.dev.db
FX42_CONTROL_SOCKET=./data/control.sock
```

mock 模式使用内存 scam 客户端和合成行情，不访问真实外部服务。内存 scam 客户端内置：

- 储备账户：`DN4200420000000000000001`，token `reserve-token`
- 普通演示账户：`DN4200420000000000000002`，token `alice-token`

`loadEnv()` 在 `FX42_MODE=mock` 时会自动填入上述储备 token/IBAN；非 mock 模式必须在环境中显式配置。
