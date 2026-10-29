# 运维与部署

## 1. 运行方式

生产环境推荐：

- 单个 FX42 容器
- 一个持久化 `/data` 卷
- Litestream sidecar
- Caddy/Nginx 反向代理和 TLS

FX42 与 SQLite 必须单实例运行；不要横向启动多个写进程。

## 2. 环境准备

```bash
cp .env.example .env
```

`config/fx42.yaml` 是已纳入版本管理的生产配置，不包含敏感 token；启动前按实际部署直接编辑该文件。

必需生产密钥：

- `NUXT_SESSION_PASSWORD`：至少 32 字符
- `FX42_ENCRYPTION_KEY`：32 字节随机数的 base64
- 每个启用 OIDC provider 对应的 client secret 环境变量
- `SCAM_RESERVE_IBAN` / `SCAM_RESERVE_TOKEN`（非 mock 模式必填）
- `METRICS_TOKEN`

OIDC 回调地址：

```text
https://<host>/api/auth/oidc/<provider>/callback
```

## 3. 数据库与迁移

- 运行时启动会自动迁移。
- 显式迁移：`pnpm db:migrate`
- 对账：`pnpm db:check`（`quick_check` + 账本检查）
- 备份：`pnpm db:backup`
- 修改 `schema.sql` 后：`pnpm db:schema`

## 4. 运维 CLI

```bash
pnpm ops status
pnpm ops halt --reason "incident"
pnpm ops halt --all --reason "full stop"
pnpm ops resume
pnpm ops close <position-id> --reason "manual"
pnpm ops adjust --user <id-or-MNT> --amount 100 --reason "manual credit"
pnpm ops adjust --to fee_income --amount 100 --reason "adjustment"
pnpm ops user suspend <id-or-MNT>
pnpm ops user resume <id-or-MNT>
pnpm ops user close <id-or-MNT>
pnpm ops unmatched list
pnpm ops unmatched match <id> --user <id-or-MNT>
pnpm ops unmatched ignore <id>
pnpm ops risk
pnpm ops reserve
```

`halt` / `resume` / `close` / `status` 通过 UNIX socket：

```text
FX42_CONTROL_SOCKET=/run/fx42/control.sock   # 容器
FX42_CONTROL_SOCKET=./data/control.sock      # 本地
```

所有敏感操作写入 `audit_logs`。

## 5. 健康检查与指标

| 路径       | 内容                                      |
| ---------- | ----------------------------------------- |
| `/healthz` | 进程、SQLite quick_check、任务队列        |
| `/readyz`  | 运行时 ready、首个行情                    |
| `/metrics` | Prometheus；生产需 Bearer `METRICS_TOKEN` |

建议监控：

- 进程存活
- SQLite quick_check
- feed connected / lastTickAt
- jobs pending / failed
- reserve coverage
- halt flags
- 强平/坏账计数

## 6. Docker

```bash
docker compose build fx42
docker compose up -d
```

镜像：

- 构建阶段：`node:26-trixie-slim` + `python3 make g++` 编译 `better-sqlite3`
- 运行阶段：`node:26-trixie-slim`
- 内置 DN42 root CA，默认 `NODE_USE_SYSTEM_CA=1`
- 入口脚本以 root 修正 `/data` 和 `/run/fx42` 权限，然后用 `gosu` 降权到 `fx42`

Compose 挂载：

```yaml
volumes:
  - ./data:/data
  - ./config:/config:ro
```

`config/` 只读；改配置后重启。

## 7. Litestream

`docker/litestream.yml` 负责把 `/data/fx42.db` 复制到 `/backup` 或远端存储。恢复步骤：

1. 停止 FX42 容器，避免继续写入。
2. 使用 Litestream restore 恢复到 `/data/fx42.db`。
3. 启动容器，确认 `/healthz` 和 `pnpm db:check`。

## 8. CI / 发布

`.github/workflows/ci.yml` 在 `master` 和 PR 上执行：

- lint
- typecheck（包 + web）
- contracts
- unit/integration
- architecture
- build
- Playwright E2E
- `db:check`

`.github/workflows/docker.yml`：

- `master` 构建并发布 `latest`
- Git tag 发布同名 tag
- 同时发布 `sha-<short>` 镜像

## 9. 故障处理

| 现象         | 处理                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| 行情断流     | 检查 biquote/SignalR；系统会自动重连并进入 REST fallback                      |
| 储备不足     | `pnpm ops reserve`，补充储备后等待 monitor 恢复                               |
| 账本不平     | 系统自动 `halt_all`；检查 `reconciliation_reports`，不要绕过                  |
| 坏账         | 平仓结算产生坏账时自动 `halt_opening`；检查强平记录和 `insurance_fund` 钱包   |
| 异常转入     | `pnpm ops unmatched list`，按流程 match/ignore                                |
| 风险参数误改 | 若启动被拒绝，恢复配置或显式设置 `FX42_ALLOW_RISK_CONFIG_CHANGE=1` 并确认重算 |
