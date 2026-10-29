# 认证、账户与语言

## 1. OIDC 登录

- 每个启用的 provider 有独立 ID、issuer、client ID 和 secret 环境变量映射；discovery URL 与 callback path 分别由 issuer 和 id 派生，secret 环境变量可以复用。
- 登录页通过 `/api/auth/providers` 获取列表。
- 发起点：`GET /api/auth/oidc/:provider?redirect=...`
- 回调：每个 provider 独立 `/api/auth/oidc/:provider/callback`

登录成功后写入密封会话：

- `userId`
- `identityId`
- `providerId`
- `sessionVersion`
- 登录时间

每次请求都会校验会话、`users.status` 和 `session_version`。运维通过 CLI 暂停/关闭用户后递增版本，使旧会话失效。

## 2. 账户映射

### DN42 provider

- `kind=dn42`
- 按规范化 `active_mnt` 合并同一用户
- MNT claim 字段可通过 provider 的 `mntClaim` 配置，默认 `active_mnt`；支持 `dn42.mnt` 这类点路径
- `sub` 直接使用 IdP 返回的值作为 `(provider_id, subject)` 身份键，不假设固定的生成算法
- 同一 `active_mnt` 通过不同 DN42 provider 登录会得到同一 FX42 用户和多个 identity

### Generic provider

- `kind=generic`
- 按 `(providerId, sub)` 创建独立用户
- 不与 DN42 身份自动合并

## 3. 双账户

首次完成登录后，每个用户拥有两个 `trading_accounts`：

- `real`：FTK，可绑定 scam token 进行真实充值/提现
- `virtual`：VFTK，只使用内部虚拟资金

账户、钱包、订单、持仓、账本和资金记录都带 mode，不能跨模式操作。

## 4. 首次登录与免责声明

- 首次登录必须进入 `/onboarding` 并接受免责声明。
- 免责声明文本由前端 i18n 静态提供，后端只记录一次性接受。
- `terms_acceptances` 记录 user、mode、IP、UA、时间。
- 未接受免责声明时：
  - 开仓、加仓、充值、绑定 token 被拒绝。
  - 平仓、减仓、提现仍然允许，避免锁死风险退出。

## 5. 默认模式与管理

- 用户可选择默认模式 `real` / `virtual`。
- 顶部模式切换会更新当前 UI 模式，并尽力同步用户默认偏好。

## 6. 语言偏好

- i18n strategy 为 `no_prefix`，URL 中没有 `/zh` 或 `/en`。
- 语言来源：
  1. 已登录用户的 `users.locale`（`zh-CN` / `en`）
  2. 未登录时使用默认 `en`
- 登录页可以纯前端切换语言，不改变 URL。
- 顶部语言菜单和设置页会保存用户语言偏好到 `users.locale`。
- 页面 SSR/客户端布局会在登录后按用户偏好设置 i18n locale。
- `html lang` 跟随当前界面语言。

## 7. 会话与安全

- 会话使用 `nuxt-auth-utils` 密封 cookie。
- 生产环境必须配置 `NUXT_SESSION_PASSWORD`。
- 登出支持当前会话和全部设备。
- 敏感操作写入 `audit_logs`。
- 生产环境校验 Origin；API 写操作使用幂等键。
- 当前限流是进程内内存桶，单实例有效。
