# TD Sequential 9/13 图表标记与 AI 趋势面板

这里是线上两样东西背后的算法，原样摘出来供算法调整和回测：

- **K 线图上的 9/13 标记**：9、13、进行中的计数、R、「+」、TDST 线和 Risk 线，全部来自 `buildChart()` 的输出。
- **AI 趋势面板**：卡片（方向、强度、标题、保护建议）和那段趋势说明（结论、各周期、复盘、关注），由 `assembleSnapshot()` 和文案模板生成。

两样用的是同一个九转引擎（`engine.ts`），改了引擎，两边都会跟着变。

**不熟悉代码？** 先看 [`docs/how-to-ask.md`](docs/how-to-ask.md)：里面列了可以直接对 AI 说的话，以及报告怎么看。

## 底部判断 skill

`skills/market-bottom-assessment/SKILL.md` 是一份给 AI agent 用的 skill，用来回答「BTC 是否见底」这类问题。判断方法分三层：
- 多周期的 9/13：本地回放用本仓库的 `td-sequential-v2` 引擎；
- New Trend；
- 链上止损卖盘。

链上数据部分依赖外部的链上数据 MCP，本仓库不提供。怎么使用、怎么测试、怎么交付，见 `skills/market-bottom-assessment/README.md`。

## 快速开始

需要 Node 18 或以上，并且要能联网：`npm install` 访问 npm，取 K 线访问 `fapi.binance.com`。在沙箱里运行时要先放开网络。

```bash
npm install
npm run typecheck
npm test

# 拉 3000 根 BTCUSDC 4h 已收盘 K 线到 data/（Binance USD-M 永续，公开接口）
npm run fetch-klines -- BTCUSDC 4h 3000

# 看接口现在返回什么（和线上同一条代码路径）
npm run chart -- BTCUSDC 4h

# 回测
npm run backtest -- --file data/BTCUSDC-4h.json               # 全量历史一次算完
npm run backtest -- --file data/BTCUSDC-4h.json --window 500  # 按线上方式逐根重放

# AI 趋势面板：现在的样子
npm run insight -- BTCUSDC --lang both
# AI 趋势面板：过去某一时刻的样子（先把五个周期都拉下来）
npm run fetch-klines -- BTCUSDC 5m,15m,1h,4h,1d 3000
npm run insight -- BTCUSDC --at 2026-11-10T08:00:00Z

# 看图：K 线 + 9/13 标记 + TDST/Risk 线 + AI 趋势面板，生成一个 HTML，用浏览器打开
npm run view -- BTCUSDC 4h
npm run view -- BTCUSDC 4h --at 2026-11-10T08:00:00Z
# 和改动前的版本对比：图上用颜色标出新增、消失、变化的标记，下面列出差异表和面板逐项对比
npm run view -- BTCUSDC 4h --compare baseline
```

## 一键报告

```bash
npm run report
```

改完代码后跑这一条，它会生成 `data/report/index.html`，把当前代码和 `baseline`（线上现行算法）放在一起比。缺少的 K 线会自动下载，第一次运行要多等一会儿。

报告顶部有四行结论，下面是明细：

| 项目 | 内容 |
|---|---|
| 测试 | 类型检查和全部单元测试是否通过 |
| 和 TradingSignal 一致 | `data/ts/` 里每个样本是否逐标记一致，改动前后各算一遍 |
| 9 和 13 | 按线上方式逐根重放，改动后新增、消失、变化了哪些 9 和 13；最新的几处附对比图链接 |
| AI 趋势面板 | 每个标的在最新、一天前、三天前三个时刻的卡片和文字，改动前后是否不同 |

回测表里每格的格式是 `改动前 → 改动后（随机 X%，N 次）`：
- 命中率指信号出现后，价格在若干根 K 线后是否按预期方向走：buy 看涨，sell 看跌。
- 「随机」是同一段行情里随便挑一根 K 线、按同样方向进场的命中率，用来做参照。
- 少于 30 次的标「样本不足」，不下结论。

常用参数：
- `--symbols BTCUSDC,ETHUSDC`、`--intervals 15m,1h,4h`：选标的和周期。默认是 BTCUSDC、ETHUSDC、NVDAUSDT 的 15m、1h、4h。
- `--bars 5000`：每个标的周期重放多少根 K 线。
- `--refresh`：重新下载 K 线。
- `--ref <git ref>`：和别的版本比，默认 `baseline`。
- `--no-tests`：跳过测试，出得更快。

## 和 TradingSignal 对比

```bash
npm run compare-ts
```

做法是把 TradingSignal 自己的 K 线交给我们的引擎计算，再和它的 TD 结果逐个标记比对。输入是同一份 K 线，所以结果只反映算法是否一致，和我们线上用哪家交易所的数据无关。

比对的内容有八类：全部标记事件、9（含是否 perfected）、13、R、形成中的 Setup、进行中的 Countdown、TDST 线、Risk 线。

输出：
- 每个样本一行结论，例如 `全部标记事件 561/561，9 11/11，13 4/4 …`。
- 有差异时列出是哪根 K 线、哪一类、谁有谁没有。
- 每个样本生成一张图 `data/view/ts-<样本名>.html`，差异直接标在 K 线上。
- 有任何不一致时命令以非 0 退出。加 `--ref baseline` 可以用线上现行算法比，加 `--json` 输出完整结果。

**样本放在哪**：本地的 `data/ts/` 目录。`data/` 已被 gitignore，样本不要提交进仓库。两种放法任选：
- 一个文件 `data/ts/<名字>.json`，内容是 `{ "symbol", "timeframe", "candles", "result" }`。
- 两个文件 `data/ts/<名字>-klines.json` 和 `data/ts/<名字>-td9.json`，分别是 TradingSignal 的 TD 序列页面取 K 线和取 td9 结果的两份原始数据，原样保存即可。

`candles` 每根是 `{ t, o, h, l, c }` 或 `[t, h, l, c]`，`t` 是秒。`result` 里要有 `markers`、`setupRuns`、`countdownRuns`、`tdstLines`、`qualified13s`。

样本由维护方提供；你自己有账号的话，也可以导出同样格式的数据放进去。样本越多越好，尽量覆盖不同标的和周期。

## 时刻参数 `--at`

`chart --file`、`insight`、`view` 都接受 `--at T`，取值可以是 ISO 时间或毫秒。含义统一为：每个窗口取到 T 时刻为止已收盘的最新一根 K 线，也就是线上在 T 时刻展示的内容。

例如 `--at 2026-11-10T08:00:00Z`：
- 1h 的最后一根是 07:00 开盘的那根，08:00 那根还没收盘；
- 4h 的最后一根是 04:00 开盘的那根。

不带 `--at` 时，K 线和面板都用现在的实时数据。

## 看结果

`npm run view` 会打印生成的 HTML 路径，默认在 `data/view/` 下，用浏览器打开即可。页面要从 unpkg 加载图表库，打开时需要联网。

图上进行中的数字带前缀：`S1`–`S8` 是还在形成的 Setup（灰色圆点），`C1`–`C12` 和 `C+` 是正在数的 Countdown（棕色方块）。这个前缀只是看图页面加的，接口返回的 `label` 本身不带前缀。

页面包含：
- K 线图，上面画着接口返回的全部标记和线；
- AI 趋势面板，含卡片、标题、保护建议，以及结论、各周期、复盘、关注的中英文。

**`--compare <git ref>`**
- 把那个版本的 `src/` 取出来，在同一批 K 线上和当前工作区的代码各算一遍。
- `baseline` 是仓库初始提交上的 tag，也就是线上现行算法。
- 对比结果：
  - 图上：蓝色是当前版本新增或有变化的标记，橙色是只有旧版本才有的；
  - 差异表：列出每一处新增、消失、变化；
  - 面板：逐项并排显示，有变化的行标黄。
- 命令行也会输出一行汇总，例如 `chart: 3 added, 1 removed, 2 changed`、`panel: changed 结论, 关注`。

`backtest` 和 `insight` 也接受 `--ref baseline`，用线上现行算法计算，「改动前」的数字随时都能补跑。

建议每次改完都对几个标的、几个周期、几个历史时刻跑一遍 `--compare baseline`。确认差异都是有意为之的，再提交。

## 线上怎么算

每次请求的计算流程：

1. 从 Binance USD-M 永续 `fapi/v1/klines` 取**最近 N 根已收盘** K 线，N 为 500、1000 或 1500，默认 500。
   - 未收盘的那根不参与计算。
   - 收盘后再等 2 秒才算作已收盘。
   - 代码在 `binance-klines.ts`。
2. 价格转成定点整数，避免浮点误差（`fixed-decimal.ts`）。
3. 状态机逐根计算 Setup、Countdown、TDST、Risk（`engine.ts`），输出 sequences 和 events。
4. 把引擎结果投影成图表标记（`chart.ts`），再由 `demark-service.ts` 的 `buildChart()` 包上元数据。

引擎配置固定为 `td-sequential-v2`：

| 项 | 取值 |
|---|---|
| price flip | 必须有 |
| perfection | `strict_at_nine`：只看第 9 根 |
| 同向 Setup | `retain_active`：已有 Countdown 在数时，新的同向 9 不重开 |
| recycle | 按幅度判断，或第 22 根 |
| TDST 突破 | 看真实高低点 |
| Risk 失效 | 看收盘价 |

`engine.ts` 文件头有完整说明。

## 接口返回的 `charts[i]`

```json
{
  "symbol": "BTCUSDC",
  "interval": "4h",
  "source": "binance-usdm",
  "ruleset": "td-sequential-v2",
  "bars": 500,
  "firstBarTime": 1783396800000,
  "lastClosedBarTime": 1790582400000,
  "nextUpdateAt": 1790611202000,
  "markers": [
    { "time": 1784001600000, "kind": "setup9", "side": "buy", "label": "9", "perfected": true },
    { "time": 1786982400000, "kind": "recycle", "side": "buy", "label": "R" },
    { "time": 1790006400000, "kind": "countdown13", "side": "sell", "label": "13" },
    { "time": 1790496000000, "kind": "countdownProgress", "side": "sell", "label": "8", "count": 8, "deferred": false },
    { "time": 1790582400000, "kind": "setupProgress", "side": "buy", "label": "5", "count": 5 }
  ],
  "tdstLines": [{ "side": "sell", "price": "80596.4", "startTime": 1789920000000, "endTime": null, "endReason": null }],
  "riskLines": [{ "side": "sell", "price": "88211", "time": 1790006400000, "invalidatedTime": null }]
}
```

字段约定：

**时间与方向**
- 时间都是毫秒，取该 K 线的 open time。
- `side`：`buy` 是下跌中的买入序列，标在 K 线下方；`sell` 是上涨中的卖出序列，标在上方。

**价格**
- 十进制字符串，末尾不带 0。

**markers**
- 按 `time` 升序排列。同一根 K 线上的顺序是 setup9、countdown13、recycle、countdownProgress、setupProgress。
- `setup9`：已完成 Setup 的第 9 根。`perfected` 为 true 时前端画箭头。被打断的 Setup 不画。
- `setupProgress`：最后一段 Setup 还在形成（1 到 8）时，在最后一根已收盘 K 线上标当前数字。
- `countdown13`：合格的 13。
- `countdownProgress`：正在数的 Countdown，标在最后一个计数那根上。13 延期时 `label` 为 `"+"`、`deferred` 为 true、`count` 为 12。被取消或被 recycle 的 Countdown 不画数字。
- `recycle`：标「R」。

**tdstLines**
- 只包含开始过 Countdown 的 Setup。
- `endReason` 取值：`opposite`（被反向 9 取消）、`tdst`（TDST 被突破）、`recycled`、`qualified13`。
- `endTime` 为 null 表示仍在生效。

**riskLines**
- 每个合格 13 一条。
- `invalidatedTime` 是收盘越过风险位的那根。
- 前端从 `time` 画到 `invalidatedTime` 和「之后第 12 根」两者中较早的一根。

## AI 趋势面板怎么算

线上服务每根 5m K 线收盘后，对每个标的跑一遍下面的流程。`scripts/insight.ts` 走的是同一条路径。

1. 5m、15m、1h、4h、1d 各取最近 500 根已收盘 K 线，每个周期用 `summary.ts` 的 `analyzeWindow()` 跑引擎，得到该周期的主序列摘要。
2. **规则层**，代码在 `src/services/manager/demark/`：
   - `regime.ts`：跨周期 regime。
   - `insight-facts.ts`：每个周期的结构（形成中、确立、衰减、反转）、主线、复盘、关注点。
   - `strength.ts`：卡片方向和强度。
   - `protection.ts`：保护建议。
   - `src/services/sync/signal-insight/card-phase.ts`：卡片标题。
3. **文案层**，代码在 `src/services/sync/signal-insight/`：
   - `wording.ts`、`insight-template.ts`：各周期、复盘、关注三段由模板直接生成。
   - `insight-text.ts`：`conclusionClauses()` 用代码算出结论要说的每一句，中英文都有。
   - `llm-client.ts`：线上让 LLM 把这些句子连成一段话。LLM 只负责连句，不许增删内容和数字；输出不合规时整段不展示。系统提示词就在这个文件里。
4. 繁体由 opencc 从简体转换，韩文、日文由代码按同样的句子拼接。

**关于 LLM**
- 不配 LLM 也能看到完整内容：`insight` 脚本会按同样的规则直接把句子拼起来，标成「rule-joined」。
- 想看 LLM 版：
  1. 把 `.env.example` 复制成 `.env`，填上 `INSIGHT_LLM_BASE_URL`（https，兼容 OpenAI Responses API，脚本会请求 `<BASE_URL>/responses`）和 `INSIGHT_LLM_API_KEY`。也可以直接设成 shell 环境变量，shell 里的值优先。
  2. 之后 `insight` 会多输出一行「conclusion (LLM)」；`view` 加 `--llm` 会在页面上多一张「LLM 结论」表，只针对当前版本，每次运行调用一次，最长等 90 秒。
- LLM 每次连句的措辞可能略有不同，所以前后对比以规则拼接版为准，LLM 版只用来看最终效果。
- 模型默认 `gpt-6.1-sol`，和线上一致，一般不用改。
- key 只放在 `.env` 或 shell 里。`.env` 已被 gitignore，不要把 key 或网关地址写进任何提交、报告或 PR。

**其它说明**
- 代码注释里的 `R32`、`R34`、`R35`、`R36` 和「spec section N」是维护方内部的规则编号，含义在相邻的注释和测试名里都写了。
- `src/services/sync/signal-push/` 下两个文件只是占位，替代线上服务的推送模块，不属于算法，不要改。

## 已知的口径，不算错误

对比别的图表工具时，先排除下面几项：

- **只用已收盘 K 线。** 进行中的数字比「含当前未收盘 K 线」的工具慢一根，但标记出现后不会再变。
- **数据源是 Binance USD-M 永续。** 和现货、其它交易所的 K 线不同，数字可能不一样。
- **每次只用最近 500 根算。** 序列状态取决于窗口从哪根开始，所以窗口最左侧的标记会随着新 K 线到来而变化或消失：
  - 9 大约在左边 12 根以内；
  - 13 最远可以到左边约 100 根。
  - 用 `backtest --window 500` 能看到 `vanished markers` 计数。2026-11 BTCUSDC 4h 3000 根上是 93 个，全部出在窗口左侧。最近的标记是稳定的。
- **前端图上的画法**（箭头样式、线段长度）在前端，不在这里。只有当这里输出的数据本身不对，才需要改这个仓库。

## 现有的正确性基线

- `tests/unit/demark/parity.test.ts`、`engine.test.ts`：在两段真实 Binance 行情和 20 个构造用例上，引擎的 sequences 与 events 和一个 Python 参考引擎逐个相同。
- `summary.test.ts`、`regime.test.ts` 和 `insight-compose-*.json` 样本：周期摘要和跨周期 regime 与同一个 Python 参考实现逐字段相同。
- `tests/unit/signal-insight/`：文案规则的约束。例如 `trend-only-wording.test.ts` 保证结论里不出现多空、看涨看跌这类词，也不出现指标名。
- TradingSignal 对照：维护方持有两段 BTC/USDT 样本（15m、4h），现行引擎和它逐个标记一致（561/561、563/563）。样本不随仓库公开，拿到后放进 `data/ts/`，用 `npm run compare-ts` 就能自己验证；改动交回后维护方也会再跑一遍。

## 怎么交付

1. 每发现一处数据不对，先写一个能复现的测试用例。用例可以是构造 K 线，也可以从 `data/` 截一段真实 K 线存进 `tests/unit/demark/fixtures/`。用例要写清楚以下几项：
   - symbol、周期；
   - 哪根 K 线；
   - 期望输出、实际输出；
   - 依据：规则出处，或者对照的工具和截图说明。
2. 改算法，让新用例通过。如果某个原有用例的期望值需要跟着改，在 commit message 里写明原因。
3. 按 `AGENTS.md`「改动规则」把改动前后的对比放进 `reports/<日期>-<主题>/`，改动前的输出用 `--ref baseline` 跑。
4. `npm run typecheck` 和 `npm test` 全部通过。

**不要改的东西**
- 导出函数的签名：`evaluateSequential`、`projectChart`、`buildChart`、`fetchClosedKlines`、`scaleRows`、`analyzeWindow`、`assembleSnapshot`、`templateSections`、`generateInsight`。
- `demark-types.ts`、`insight-types.ts` 里的响应类型。

改动最后会按原路径搬回线上服务，所以文件路径和导出名也要保持不变。如果确实需要新增字段或改输出格式，先在 PR 里说明理由。
