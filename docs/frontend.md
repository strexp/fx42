# 前端

## 1. 页面

| 页面       | 路径             | 说明                                                        |
| ---------- | ---------------- | ----------------------------------------------------------- |
| 登录       | `/login`         | provider 列表；语言切换纯前端，不改 URL                     |
| Onboarding | `/onboarding`    | 免责声明、模式选择                                          |
| 仪表盘     | `/`              | 权益、持仓、行情、最近成交、24h 统计；持仓/行情可跳转交易页 |
| 行情       | `/markets`       | 品种列表、点差、状态、市场时钟                              |
| 交易       | `/trade/:symbol` | K 线、下单、持仓面板、市场时钟                              |
| 持仓       | `/positions`     | 当前模式持仓、部分平仓、全平                                |
| 钱包       | `/wallet`        | 余额、充值、提现、外部账户、流水                            |
| 历史       | `/history`       | 成交、已实现盈亏                                            |
| 设置       | `/settings`      | 资料、语言、默认模式、主题、PnL 颜色、通知                  |
| 免责声明   | `/terms`         | 只读免责声明                                                |

## 2. 布局

- `layouts/default.vue`：主导航、权益、模式切换、通知、主题、语言、用户菜单、状态提示条。
- `layouts/auth.vue`：登录/onboarding 布局；onboarding 在桌面端使用更宽的阅读布局。
- 顶部 Logo 和 FX42 文字使用主题主色 `text-primary`。
- 状态提示条在亮色/暗色模式分别使用可读的深色/浅色文字。

## 3. 账户模式

- 顶部 real/virtual 切换使用 `useAccountMode()`。
- 当前模式和用户默认模式分离：切换模式更新本地状态，并尽力保存偏好。
- real 与 virtual 的钱包、持仓、订单、流水完全独立。

### 账户数字自动刷新

账户相关数字统一由 `useAccountSnapshot()` 提供：

- 数据源：`GET /api/account/snapshot?mode=`
- 实时推送：`GET /api/stream/account?mode=&interval=`
- 布局层只建立一条账户 SSE，页面读取共享快照
- 可见时每 2s 刷新；页面隐藏时降为 8s
- SSE 断开时使用 5s REST 降级轮询
- `wallet`、`equity`、`available`、`marginUsed`、`unrealizedPnl`、持仓 mark/PnL/liq 全部来自同一个快照
- 前端不再自行计算账户权益或持仓盈亏
- SSE、页面可见性和降级轮询分别由 `@vueuse/core` 的 `useEventSource` / `useDocumentVisibility` / `useIntervalFn` 管理
- `useAccountSnapshot()` 使用 `createSharedComposable`，布局和页面共享同一条账户 SSE 与快照状态

## 4. i18n

- `@nuxtjs/i18n` 使用 `strategy: 'no_prefix'`。
- URL 中不出现 `/zh`、`/en`；登录页固定 `/login`。
- 已登录用户语言来自 `users.locale`，未登录默认 `en`。
- 顶部语言菜单、设置页修改语言会保存用户偏好。
- 登录页语言切换只改变当前页面文案，不写 URL。
- 文案文件：`apps/web/i18n/locales/zh-CN.json`、`en.json`。
- `html lang` 跟随当前 locale。

## 5. 主题与外观

- 主题预设：Mono、Cobalt、Sky、Mint、Iris、Crimson、Coral、Sunset、Carbon、Bubblegum、Parchment。
- 每个预设控制 primary/neutral palette 和圆角。
- 主题、盈亏颜色写入 localStorage，hydration 后恢复响应式状态，避免高亮与打勾不一致。
- 亮/暗/跟随系统使用 Nuxt color-mode。
- 盈亏颜色预设同时用于 PnL 文字和 K 线涨跌色。

## 6. 图表

- `lightweight-charts` v5。
- K 线 + SMA5/10/20/60 + entry/liq/TP/SL 价格线。
- 所有价格均为 FTK；不再提供原生报价 / FTK 计价切换，也不在前端做换算或反转。
- 十字线使用自由移动模式，可查看任意鼠标位置的价格。
- 价格轴和十字线精度来自品种 `pricePrecision`。
- 休市/陈旧状态显示在交易页和持仓面板。

## 7. 行情刷新

- 交易页：只订阅当前 symbol，市场 SSE `250ms`；页面隐藏时降为 `5000ms`。
- 仪表盘、行情页：请求 `interval=3000`，页面隐藏时暂停市场 SSE。
- 账户数字通过 `/api/stream/account` 定时快照刷新；成交历史、通知和系统状态按需轮询。
- 账户 SSE 由布局层单例管理。
- 钱包页的充值/提现记录在存在 pending 项时每 5 秒轮询；钱包数字本身走账户快照。

## 8. 通知

- 顶部铃铛打开 popover 通知面板，不跳转设置页。
- 面板只显示未读通知；有未读时铃铛变为主题色并显示红点，通知列表定时刷新。
- 面板支持全部标记已读和滚动列表。
- 通知标题来自 kind，副标题根据 payload 显示具体品种/持仓/金额/比例；平仓通知会显示平仓原因。
- 通知状态由共享 `useState` 管理，顶部面板和设置页保持同步；完整通知历史仍在设置页。

## 9. 部分平仓弹窗

`PartialCloseDialog.vue` 同时用于交易页和持仓页：

- 输入平仓 units；支持 25% / 50% / 75% / 全部
- 显示剩余 units / lots
- 显示预计手续费和预计盈亏（有 ticker 时）
- 提示部分平仓会保留 TP/SL
- 数量不符合 `contractSize × lotStep` 或剩余低于最小手数时禁用确认

## 10. 共享组件

- `AnimatedMoney.vue`：基于 `@number-flow/vue` 的核心金额动画，统一 fallback、locale 与小数位
- `TpSlFields.vue`：止盈止损输入，显示合法价格区间、5/10/25/50/100 pips 快捷设置和对齐校验；pips 使用 ticker 返回的动态 `pipSize`
- `NotificationList.vue`：通知列表与副标题格式化
- `ConfirmDialog.vue`：统一资金/仓位确认框
- `SettingsThemeCard.vue` / `SettingsPnlCard.vue` / `SettingsNotificationsCard.vue`
- `WalletSummaryCards.vue` / `WalletExternalAccountCard.vue` / `WalletDepositCard.vue` / `WalletWithdrawCard.vue` / `WalletHistoryCard.vue`

`AnimatedMoney` 只用于权益、余额、保证金、未实现盈亏等低频核心数字。行情价格、表格行、K 线坐标轴等高频或大列表数字仍使用普通格式化，避免动画噪音和额外渲染开销。

## 11. 二次确认

所有具有资金或仓位影响的操作都有确认流程：

- 下单
- 交易页平仓 / 部分平仓 / 全平
- 持仓列表部分平仓 / 平仓
- 追加/撤出保证金
- 止盈止损（弹窗，含合法区间和快捷设置）、自动平仓设置（按当前保证金率动态显示允许范围）
- 充值 / 提现
- 取消提现
- 解绑外部账户
- 设置默认提现账户

## 12. 响应式

- 桌面端主内容最大宽度 `max-w-7xl`。
- 移动端主导航位于 header 下方并居中，内容过宽时可横向滚动；交易页下单和图表纵向排列。
- 通知、持仓表格、钱包流水使用内部滚动，避免页面无限变长。

## 13. PWA / 安装到桌面

- 应用以 PWA 形式安装到 Android、iOS 和桌面浏览器的主屏幕，安装后以独立窗口运行。
- `public/manifest.webmanifest`：`start_url` / `scope` 为 `/`，`display` 为 `standalone`，并同时提供 192、512 的 `any` 与 `maskable` 图标。
- `public/icons/`：PNG 图标由 `icon.svg`、`icon-maskable.svg` 生成；`apple-touch-icon.png` 为 180×180 不透明图标，供 iOS 使用。
- `app/app.vue` 输出 manifest、`apple-touch-icon` 和 iOS 独立运行相关的 meta；`theme-color` 随亮/暗主题变化。
- `public/sw.js`：生产环境注册的 service worker；只缓存图标、manifest 和离线页，导航请求走网络，失败时显示 `/offline.html`；`/api/` 与 SSE 永不缓存。
- `app/plugins/pwa.client.ts`：仅在生产环境、页面加载完成后注册 worker；开发模式不注册，避免 HMR 与旧缓存互相干扰。
- `nuxt.config.ts` 为 `sw.js`、manifest 和离线页设置缓存头，保证 worker 与 manifest 能及时更新。
- 浏览器要求 HTTPS（`localhost` 除外）才会显示安装入口；iOS 使用 Safari 的“共享 → 添加到主屏幕”。

## 14. 前端依赖边界

- `@vueuse/core` 只用于浏览器生命周期和事件封装，不承载业务规则。
- 账户 SSE 的刷新策略、快照顺序校验、模式隔离仍在 `useAccountSnapshot()` 中显式实现。
- `@number-flow/vue` 只负责展示动画，不参与金额计算；金额仍以 API 返回的十进制字符串为准。
- `AnimatedMoney` 同时把格式化后的值写入宿主元素 `title`；NumberFlow 的数字在 shadow DOM 中，E2E 通过该属性断言数值变化。
- 主题和 PnL 颜色继续使用现有 localStorage + hydration 前应用逻辑，不改为通用状态库。
- 图表继续使用 `lightweight-charts`；SMA 由服务端手写计算，`trading-signals` 保留备用，不接入当前指标链路。
