# 行情与 K 线

## 1. biquote 接入

生产模式使用 biquote：

- SignalR hub 接收 `ReceiveTick`
- REST OHLC 拉取历史 K 线
- REST latest 作为断流/半开连接时的补充

REST 客户端由 `packages/clients/src/biquote.ts` 自行维护（`ofetch` + timeout/retry），不使用 npm `biquote` SDK，以保留字符串价格、响应结构兼容和 mock 配置能力。

mock 模式使用 `packages/runtime/src/mock-feed.ts` 生成合成行情，不访问外部网络。

## 2. PriceStore

`packages/runtime/src/price-store.ts` 在内存中维护每个品种的最新快照：

- `bid` / `ask` / `mid`
- `quoteToUsd`
- `marketState`
- `stale`
- `quoteAgeMs`
- `feedGapMs`
- `spreadSpike`
- `sourceTs` / `updatedAt`

`feedGapMs` 使用本地接收时间计算，不使用上游 `sourceTs`，避免 biquote 时钟偏移造成误判断流。

行情源每秒最多落一次快照到 `market_prices`。SSE 从内存读取，不直接读取数据库。

## 3. 价格单位

平台只有一个用户可见价格单位：**FTK**。

### 后端入口

- `quote=USD` 品种保持原始方向。
- `base=USD` 品种自动归一化为「非 USD 货币 / USD」方向，并按非 USD 货币重新排列 bid/ask/mid 与 OHLC；配置中没有反转开关。
- 内部统一使用「USD / 非 USD 单位」保存和计算价格。
- 对外返回前统一转换：

```text
priceFtk = priceUsd ÷ ftkUsdRate
```

`ftkUsdRate` 来自配置，默认 `0.01`，即 1 FTK = 0.01 USD。

`base=USD` 品种的 `pipSize` 配置为原生报价（USD/XXX）的 pip。ticker 对外返回的 `pipSize` 会按当前归一化价格动态换算：`pipSize × P²`，再乘以 FTK 价格因子；前端 pips 快捷设置使用该值。因此 `pricePrecision` 需要 7–9 位，当前配置为 8。

### 覆盖范围

以下接口和推送全部直接返回 FTK 价格：

- ticker 与市场列表
- 市场 SSE
- K 线 OHLC、均线和最后一根实时 K 线
- 持仓 entry / mark / liquidation / TP / SL
- 订单成交价、成交历史
- 下单预览 fill / liquidation
- 强平、通知中的价格

前端不再提供 FTK/USD 切换，也不做任何 FTK 或 USD 反转/换算。用户输入的 TP/SL 按 FTK 解释，后端在进入交易引擎前只转换一次为内部 USD 价格。

### 风险与盈亏

```text
notionalFtk(units, priceFtk) = units × priceFtk
pnlFtk = (markFtk − entryFtk) × units   // long
pnlFtk = (entryFtk − markFtk) × units   // short
```

手续费、保证金、融资、强平罚金和账本金额均以 FTK 计价。

## 4. K 线

- 周期：`1m`、`5m`、`15m`、`30m`、`1h`、`4h`、`1d`
- 来源：本地 `candles` 缓存；缓存陈旧且请求 limit 未满时尝试 biquote REST
- 同一 symbol/interval/limit 的并发 OHLC 请求会 single-flight 合并
- 服务端计算 SMA5/SMA10/SMA20/SMA60（可配置）；当前为手写 Decimal 计算，`trading-signals` 保留备用
- 当前未闭合 K 线会合并最新报价，避免 ticker 与最后一根 K 线不一致
- OHLC 与均线在 API 返回前转换为 FTK
- 前端使用 `lightweight-charts` 渲染，支持 PnL 颜色、主题色

## 5. SSE

### 市场行情

```text
GET /api/stream/market?symbols=EURUSD,USDJPY&interval=1000
```

- 默认每 250ms 推送；交易页只订阅当前 symbol，使用 250ms；页面隐藏时降为 5000ms。
- 仪表盘和行情页使用 `interval=3000`；页面隐藏时暂停市场 SSE。
- 服务端限制 `250–10000ms`。
- 每 15 秒发送 heartbeat。
- biquote REST 元数据（`marketState`/`stale`/`quoteAgeSeconds`）在流健康时约每 30 秒刷新一次；任一品种超过 10 秒没有新 tick 时改为每 5 秒轮询 REST。

### 账户快照

```text
GET /api/stream/account?mode=virtual&interval=2000
```

- 前端可见时使用 2000ms，页面隐藏时降为 8000ms；服务端默认 1000ms，限制 500–10000ms。
- 推送 `snapshot`：钱包、全部持仓、`serverTime`、`sequence`。
- 前端布局层只建立一条连接，页面读取共享快照。
- SSE 断开时前端使用 5s REST 降级轮询。

成交历史、通知和系统状态由页面按需轮询，不再维护独立的事件流或 outbox。

## 6. 市场状态与风控

- 上游只有 REST `/api/latest`、`/api/{symbol}` 返回 `marketState`、`stale`、`quoteAgeSeconds`；SignalR tick 不包含这些字段。
- `marketState` 是**有效状态**：上游 `marketState=closed`，或报价冻结超过 5 分钟（`PriceStore` 的 `closedAfterMs`），都视为闭市。后者用于兜底上游仍报 `open` 但报价已停止的情况。
- SignalR 重放的旧 tick 不会重置 `quoteAgeMs`；只有 `sourceTs` 前进（或 REST 明确给出 `quoteAgeSeconds`）才视为新报价。
- 报价延迟超过 `staleQuoteMs` 标记 stale。
- 点差超过 20 分钟中位数的 3 倍标记 `spreadSpike`；stale/闭市时不计算点差异常，禁止开仓，允许平仓。
- 断流超过 `maxStaleCloseFeedGapMs` 时禁止使用陈旧价格平仓。
- 手动休市/陈旧平仓必须带 `confirmStale`；TP/SL 与自动平仓在 `marketState=closed` 时不会触发，强平还会拒绝 `quoteAgeMs > staleQuoteMs` 的报价。
- 市场时钟接口返回悉尼、东京、伦敦、纽约四个 session 的开市/收市时间，仅供提示，最终状态以 biquote 为准。
