# FX42

FX42 是运行在 DN42 内的虚拟外汇 / CFD 交易所。用户通过 OIDC 登录，使用 FTK 进行真实账户充值/提现，或使用 VFTK 体验模拟账户。平台是交易的唯一对手方，行情来自 biquote。

- 每个用户拥有相互隔离的 real（FTK）与 virtual（VFTK）账户
- 市价开仓、加仓、减仓、平仓、部分平仓、反手、TP/SL、自动平仓、强平
- 1x–1000x 杠杆、逐仓保证金、周末规则、融资费、`insurance_fund` 钱包
- 账户与持仓数字通过后端快照自动刷新，前端不做价格单位换算
- 可作为 PWA 安装到 Android、iOS 与桌面，图标与离线页随应用发布
- scam.dn42 自动充值/提现，异常转账安全网
- 无管理员角色和管理后台；储备账户由环境变量指定，配置和运维通过 YAML、环境变量和 CLI

## 技术栈

- Nuxt 4 / Vue 3 / Nuxt UI 4
- `@vueuse/core`（SSE、可见性、定时器生命周期）
- `@number-flow/vue`（核心账户数字动画）
- Nitro REST/SSE
- SQLite + `better-sqlite3` + Litestream
- biquote REST/SignalR

## 快速开始

```bash
pnpm install
pnpm dev:mock
# http://localhost:3000
```

mock 登录页提供 Alice（DN42 用户）、DN42 Alt（同 mnt 合并测试）和 Bob（Generic）。数据来自 `config/fx42.mock.yaml` 的模拟行情和模拟 scam 服务。

生产环境：

```bash
cp .env.example .env
# 填写 .env 中的密钥和 OIDC/scam/biquote 配置
# config/fx42.yaml 是已纳入版本管理的生产配置（不含敏感 token）
pnpm build
node .output/server/index.mjs
```

## 常用命令

```bash
pnpm dev:mock
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm test:arch
pnpm test:e2e
pnpm db:migrate
pnpm db:check
pnpm ops --help
```

## 文档

完整设计、配置、API、运维和测试说明见 [`docs/`](./docs/)：

- [架构](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [配置](docs/configuration.md)
- [认证与账户](docs/auth-accounts.md)
- [资金](docs/funding.md)
- [行情](docs/market-data.md)
- [交易与风控](docs/trading-risk.md)
- [API](docs/api.md)
- [前端](docs/frontend.md)
- [运维](docs/operations.md)
- [测试](docs/testing.md)
- [当前状态](docs/status.md)

## License

AGPL-3.0
