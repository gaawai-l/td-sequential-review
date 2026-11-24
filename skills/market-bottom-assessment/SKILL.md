---
name: market-bottom-assessment
description: Use when someone asks whether the market or BTC has bottomed, asks about a local bottom, seller exhaustion, the last seller, or whether a DeMARK 9 or 13 signal marks a reversal.
---

# Market Bottom Assessment

## Core principle

Treat a bottom as a multi-timeframe and on-chain evidence question. A DeMARK 9 or 13 is a timing clue inside one timeframe. The higher timeframe says whether that clue is occurring inside an uptrend, a downtrend, or a transition. On-chain loss selling says whether the decline has produced an unusually large release of sellers. A signal alone does not confirm a market-wide bottom.

Use the last closed bar for every input. Record the exact close time, timeframe, raw value, category, and any data latency. Never use a forming bar as a confirmed 9 or 13.

Use generic source labels and keep raw data interface names, hosts, endpoint URLs, request details, and API documentation links out of all user-visible output, including progress updates, citations, charts, screenshots, logs, and shared files or their embedded source.

Return the five concise findings below in order. Use Singapore time (UTC+8) for displayed timestamps. Refresh, render, and display the two on-chain charts only when the user asks for charts.

## Required sequence

### 1. Form the 15m conclusion

Use only TD Sequential. Select Sequential on the connected indicator or use `td-sequential-v2` for local replay before reading the on-chain MCP. If Sequential readings are unavailable, report `未取得`.

Start the 15m conclusion with one of two exact labels, `趋势衰减` for a weakening move or `趋势反转` once closed bars confirm a move in the opposite direction. Append `待确认` to the relevant label when evidence is pending. State the direction in a separate phrase, then give the latest confirmed signal, its age, and the price response.

For a qualified 15m 13 with a valid risk level, watch the first two to four closed bars after confirmation (30–60 minutes). A buy 13 points to a possible turn up, and a sell 13 points to a possible turn down. During that hour, use the 13 as a reversal candidate while price confirmation is pending. After 60 minutes, summarize any price reaction as history and base the current direction on the active New Trend.

A confirmed 15m New Trend takes priority as soon as it forms. A forming 15m New Trend gives a tentative direction after the 13 window or when the 13 is invalidated. When a New Trend is cancelled, drop it from the assessment. If no current 15m direction remains, report the aligned 1h and 4h Setup directions as context and leave the 15m direction pending.

For a JavaScript replay, pass `signal13` only for a qualified 13 with a valid risk level and give it the exact elapsed `ageMinutes`. Pass `newTrend` from the latest closed bar only while its Setup is active.

```javascript
function select15mDirection(signal13, newTrend) {
    if (newTrend?.present && newTrend.confirmed) return { direction: newTrend.trend, basis: 'confirmedSetup' };
    if (signal13 && signal13.ageMinutes <= 60) {
        const direction = signal13.side === 'buy' ? 'up' : 'down';
        return { direction, basis: 'recent13' };
    }
    if (newTrend?.present) return { direction: newTrend.trend, basis: 'formingSetup' };
    return null;
}
```

Set base confidence from the closed price response and the selected 15m direction. Start at `低` for a forming 15m Setup or a 13 awaiting price follow-through, `中` for a completed 15m Setup or a 13 with a price reaction, and `高` for confirmed price structure in the selected direction. Raise one grade if the current 1h and 4h Setups both support that direction, and lower one if both oppose it. Count live Setups in progress as directional support and state their steps. For example, an upward 4h Setup at step 7/9 and an upward 1h Setup strengthen an upward 15m reading. Keep confidence at most `中` until the 15m direction is confirmed by price or a completed Setup. Use `证据不足` when the 15m direction is pending.

### 2. Adjust confidence with historical multi-timeframe signals

Check the latest closed bars for these timeframes when the tool supports them:

| Signal timeframe | Higher-timeframe context |
|---|---|
| 5 minutes | 15 minutes |
| 15 minutes | 1 hour |
| 1 hour | 4 hours |
| 4 hours | 1 day, or the highest available context |

Use the confirmed 4h trend as the slope for the 1h signal. An uptrend is uphill, a downtrend is downhill, and a neutral or missing reading should be labeled as such. Summarize the active 1h and 4h Setup or Countdown direction, count and confirmation status. Use the 4h slope to explain whether the 1h move is with the trend or a counter-trend rebound. Use the daily context when assessing a larger bottom.

Compare the latest confirmed historical signal in each of 5m, 1h, 4h, and daily with the direction stated in section 1. Read a buy 9 as the downtrend it counts, a sell 9 as the uptrend it counts, a qualified buy 13 as a potential turn up, and a qualified sell 13 as a potential turn down.

Each usable timeframe contributes one comparison. Exclude missing, unqualified, or invalidated signals. Show the historical direction counts under `多周期共振`. If a recent 13 drives the conclusion and 1h and 4h lack a shared current Setup direction, raise one confidence grade when more historical signals agree, lower one when more oppose, and keep the grade on a tie. Apply at most one alignment adjustment. For a New Trend-led conclusion, use the current 1h and 4h Setup agreement in section 1. Bound confidence to `低 → 中 → 高`.

- Select one signal per timeframe by its most recent confirmation close across buy 9, buy 13, sell 9, and sell 13. Record that signal's close time and bar interval.
- Report each signal's age from its confirmation close to the analysis cutoff in whole elapsed minutes. Show `不到 1 分钟前` for less than one minute, `25 分钟前` for intervals under an hour, and `2 小时 15 分钟前` for longer intervals. Omit zero remaining minutes, as in `1 小时前`. Keep the exact timestamp for time alignment.
- Keep the signal close price and the signed change since that close in the analysis record. Calculate `(latest price / signal price - 1) × 100%` for both buy and sell signals using the same latest closed price at or before the cutoff, from the same instrument and venue. Record the reference price time.
- Label a signal with no match in the checked history `可用历史内未检出`. Use `未取得` when the data is unavailable.
- The higher-timeframe trend or higher-timeframe DeMARK state.
- Whether the higher timeframe is rising, falling, neutral, or unavailable.

#### How to read 9, 13, TDST, and Risk Level

- **Setup 9** establishes the counted trend after nine consecutive closes meet the four-bar comparison. A buy Setup counts a decline. A sell Setup counts a rise. TDST is the highest true high of those nine bars for a buy Setup or the lowest true low for a sell Setup.
- **After 9**, read the Countdown's progress and its TDST. The current engine cancels an unfinished buy Countdown when a closed bar's true low is strictly above TDST, and an unfinished sell Countdown when its true high is strictly below TDST. True high and low include the previous close. A close beyond TDST alone leaves this cancellation condition unmet. An opposite completed Setup can also cancel a live Countdown, and qualifying same-side Setups can recycle it. Use the larger timeframe to determine whether its trend is continuing.
- **Sequential 13** is the strongest exhaustion indication in the 9/13 sequence and is a candidate countertrend turning point. Buy 13 requires its low at or below Countdown 8's close. Sell 13 requires its high at or above Countdown 8's close. If that test fails, show the 13 as deferred. After a qualified 13, a later close below the buy Risk Level or above the sell Risk Level invalidates the reversal thesis. Report the Risk Level and its status when available. Use it as a reference for protection and check the subsequent price response before calling a reversal.
- Read 9 as trend establishment and 13 as exhaustion. Use the larger timeframe for direction and the smaller timeframe for timing.

In the local engine, Countdown can start on the same bar that confirms Setup 9 if that bar qualifies. Countdown bars can be nonconsecutive. The earliest possible qualified 13 is the 21st bar from Setup 1, counting the shared bar once.

If no confirmed 15m 9 or 13 is present in the available history, record that finding and complete the other checks.

#### Assess the possible bottom scale

Use the signal timeframe and its higher-timeframe context to classify the possible scale of the bottom.

| Pattern | Provisional interpretation |
|---|---|
| 5-minute signal while 15-minute or 1-hour trend is falling | Short-term pause or scalp rebound |
| 15-minute signal while 1-hour or 4-hour trend is falling | Local or intraday rebound inside a larger decline |
| 1-hour 13 with 4-hour trend losing downside momentum | Intermediate bottom candidate |
| 4-hour 13 with daily context also losing downside momentum | Larger swing-bottom candidate |
| Signal agrees with a higher-timeframe turn and on-chain exhaustion | Strongest multi-timeframe bottom candidate |

Use “short-term bottom”, “local or intermediate bottom”, and “larger bottom candidate” as scale labels. Do not call any of them a confirmed bottom until the on-chain check and price confirmation support the claim.

The higher timeframe is the slope constraint. A low-timeframe 9 or 13 during a strong higher-timeframe decline normally describes a counter-trend rebound. A low-timeframe signal during a higher-timeframe turn can contribute to a larger bottom thesis.

### 3. Check New Trend formation

Lead with the New Trend direction and Setup count on the latest closed 15m bar. Express the count as `第 N/9 步` and distinguish `形成中`, `已确认`, `已取消`, `未出现`, and `未取得` when supported by the engine. Compare it with the 5m, 1h, 4h, and daily New Trend readings. Include the current 1h and 4h Setup direction and progress when they affect confidence in section 1.

Check whether the same timeframe's New Trend invalidates an active 9 or 13 turning-point thesis. A buy-side turn points up and a sell-side turn points down for this check. A forming New Trend against that turn adds a conflict warning. Mark the old turn `已终止` when the opposing New Trend is confirmed and strong. Use the indicator's strength for that specific New Trend if available. Otherwise require the confirmation bar to close beyond the preceding bar's high for an uptrend or low for a downtrend, and the next and latest closed bars to hold beyond that level. A same-direction New Trend supports the old turn. A higher-timeframe conflict affects risk and confidence.

Use the engine's cancellation, recycling, or risk invalidation whenever it applies. Record the affected signal type, the new direction, and the closed-bar time and reason for termination. If the latest confirmed signal has since been terminated, label its status in that timeframe's row and exclude it from current reversal evidence.

### 4. Confirm 15m technical confluence

On the same latest closed 15m bar, check whether the available trend indicators agree with the 15m direction in section 1. Use the active indicators from the panel and identify the readings behind the conclusion. Treat the DeMARK Setup, Countdown and New Trend as one indicator family and use TDST and the relevant Risk Level to check whether that signal remains valid. Classify directional agreement across distinct indicators as `共振`, conflicting directions as `分歧`, and fewer than two usable directional indicators as `证据不足`.

### 5. 链上卖盘枯竭确认

After the DeMARK check, call the connected on-chain MCP. Prefer the project’s loss-selling data and the `onchain-local-last-seller` lens when available. Use the `onchain-market-regime` lens as context when it is available. Treat these readings as descriptive evidence. The current lens evidence does not establish a reliable price-forecast edge.

Anchor the assessment to the latest complete on-chain hour available at the analysis cutoff. Record its end time, timezone, lag and actual filter. Use the prior 180 days of comparable hourly readings for historical medians and percentiles, excluding the hour being assessed. Use the actual lookback when the source provides less history.

#### A. Loss-selling share

Calculate the hourly stop-loss share as combined long-term and short-term realized losses divided by the sum of absolute realized gains and losses from the same cohorts and hour. Use the unsmoothed hourly value in the prose.

Grade selling intensity by the hourly share's own historical percentile. Below the 25th is `偏低`, the 25th to below the 75th is `一般`, the 75th to below the 95th is `偏高`, and the 95th or above is `很高`.

- A combined share around the project’s configured high threshold, initially 70–80% when the metric uses one common denominator, supports concentrated loss selling.
- A historical percentile at or above the project’s extreme cut, normally P95, is stronger evidence than a raw percentage without a reference window.
- If the MCP reports separate percentages with different denominators, do not add them. Report them separately and state that a combined share cannot be inferred.
- A high supply-in-loss or high exposure measure is a stock of holders under water. It does not prove that those holders sold.

#### B. Recent absolute loss volume

Report the latest hour’s realized-loss dollars for the long-term and short-term cohorts and their combined total. Compare the total with its historical median and percentile. Use the preceding complete hours to say whether each cohort’s losses are building, fading after a spike, or broadly steady.

Find the latest confirmed long-term-holder loss-selling event and measure elapsed time from its hourly close to the analysis cutoff. Prefer a long-term-only event reported by the source. If only raw hourly series are available, use the latest complete hour with long-term realized loss at or above its own 95th percentile over the preceding 180 comparable days. Preserve the same filters across the baseline and the event. Use the event's own long-term loss percentile to assign the qualitative `卖盘枯竭概率` grade. State the percentile basis next to the grade. Below the 75th is `一般`, the 75th to below the 95th is `偏高`, the 95th to below the 99th is `高`, and the 99th or above is `极高`. If a value or grade lacks sufficient data, use `未取得`. If no event qualifies in the checked history, use `可用历史内未检出`.

- Compare the latest complete hour with its own recent history or percentile. Dollar totals from different eras are not directly comparable.
- A sudden long-term loss spike, short-term loss spike, or both supports a concentrated sell-off.
- A normal absolute loss reading means the required capitulation-style evidence is absent, even if a DeMARK 9 or 13 is present.
- Realized loss records selling that has happened. It does not by itself prove that selling has ended.

Apply the project’s noise filter when available. Exclude the under-24-hour short-term cohort for the chart workflow, and state the actual filter used. Treat exchange-internal transfers or other flagged abnormal flows as caveats rather than clean sell pressure.

#### Check whether on-chain selling supports the 15m conclusion

Use this decision table.

| Loss share | Absolute loss volume | Chain interpretation |
|---|---|---|
| Extreme | Extreme or sharply expanding | Supports a potential seller-exhaustion event |
| Extreme | Normal | Losses are broad or exposed, but concentrated selling is not confirmed |
| Normal | Extreme or sharply expanding | Selling is active, but exhaustion is not confirmed without broad loss participation |
| Normal | Normal | No on-chain exhaustion evidence |
| Missing or stale | Any | Cannot judge the on-chain leg |

A liquidation-style selling episode needs both a high loss-selling share and an absolute-loss spike in the same period. A single extreme metric gives partial evidence. If both readings are ordinary and there was no recent spike, report that the on-chain data provide no evidence of a selling climax.

Align the chain observations with the corresponding closed 1h price bars as context for the 15m conclusion. A broad loss-selling spike followed by easing losses and an hourly rebound or stabilization supports a possible turn. If price continues lower or makes new lows, reversal support is weak. Treat a later reading as follow-up evidence when it was unavailable at signal confirmation.

#### Conclude with the bottom scale and status

Use one of these states:

- **No bottom signal** when no relevant DeMARK 9 or 13 is confirmed.
- **Short-term rebound candidate** when only 5-minute or 15-minute signals appear and the higher timeframe is still falling.
- **Intermediate bottom candidate** when 1-hour evidence is present, the 4-hour downside is weakening, and the on-chain leg is at least partial.
- **Larger bottom candidate** when 4-hour evidence is present, the daily context is no longer strongly bearish, and both on-chain conditions are extreme.
- **Potential bottom, pending confirmation** when the DeMARK and on-chain evidence align but price has not yet stopped making lower lows or produced a confirmed reversal structure.
- **Cannot judge** when the required bars, timestamps, or on-chain observations are missing, stale, or not aligned.

Record the dominant counter-evidence, such as a falling higher timeframe, ordinary loss volume, or a mismatch between the signal and on-chain observation times.

Do not say “the market has bottomed” when the evidence only supports a rebound candidate. Use “potential bottom” or “bottom candidate” until a later closed bar confirms that price stopped making new lows and held the reversal.

## Charts on request

When the user explicitly asks for the on-chain charts:

1. Refresh `btc-sell-pressure.html`.
2. Show both charts in the response.
3. Chart one should show the recent seven days of hourly realized loss dollars split between long-term and short-term cohorts.
4. Chart two should show the recent 180 days of 24-hour smoothed loss share and its historical percentile.
5. State the latest complete hour, the timezone, the cohort filter, the smoothing window, and whether the data is delayed.

Use the charts as supporting evidence. The page itself warns that the two charts cannot confirm a reversal on their own.

## Response format

Write five compact Chinese lines in this order. Keep the latest 15m signal and its plain-language interpretation in the first line.

```text
结论　<趋势衰减／趋势反转及确认状态>，<15 分钟当前方向>，<最新信号及距今多久>，<短线反应或新趋势接管>，<置信度>。
多周期共振　<各参考周期最近确认的 9／13 方向>，<一致与反向数量及置信度调整>。
新趋势形成　<15 分钟方向、第 N/9 步和确认状态>，<其余周期是否同向及对结论的影响>。
技术确认　<15 分钟趋势指标是否共振>，<关键依据>。
链上卖盘枯竭确认　过去一个小时止损卖盘占<百分比>，卖盘程度<等级>。上次长期止损放量距今<时长>（按放量的<百分位>估计，卖盘枯竭概率<等级>）。
```

Use `过去一个小时` for the latest available complete hour and relative elapsed time for the long-term event. Add the lag as a duration when the on-chain hour is delayed. Keep calendar dates and clock times out of this line. Spell out percentiles in Chinese, such as `95 百分位`, and label the hourly selling intensity and the qualitative seller-exhaustion probability grade separately. Keep the line concise.

## Common mistakes

- Treating any 9 or 13 as a market-wide bottom.
- Calling 9 and 13 equivalent.
- Treating a 5-minute signal as evidence for a 4-hour or daily bottom.
- Ignoring the higher-timeframe direction.
- Adding percentages that use different denominators.
- Calling a high supply-in-loss value proof that selling already happened.
- Calling a realized-loss spike proof that selling is finished.
- Using a forming bar, a future bar, or a later on-chain observation to justify an earlier signal.
- Comparing hourly percentages against a baseline that uses a different lookback, denominator, or filter.
- Hiding missing data behind a confident conclusion.

## Practical metaphor

Use the user’s mental model when explaining the result. A 9 is like releasing the accelerator as the current move begins to lose force. A 13 is like pressing the brake as the move has decayed further and a reversal becomes possible. The higher timeframe tells whether the move is happening on an uphill path, a downhill path, or during a change of slope. The metaphor explains signal timing and context. It does not replace the on-chain or price confirmation checks.

在中文回答中可直接表达为：9 类似“松开油门”，13 类似“踩刹车”。上一级周期说明当前是在上坡、下坡，还是坡度正在改变。

## Historical snapshot validation

For a historical assessment, use the requested time as the cutoff. Read the saved `insight.json`, technical indicators, and on-chain observations for that case. Use only data that was available at the cutoff. Report unavailable inputs as `未取得`.

In `snapshot.timeframes[]`, `summary.lastSignal.at` is the signal bar's opening time in UTC milliseconds. Add the timeframe duration to get its confirmation close, then measure signal age from that close. Check that both the signal close and `summary.asOf` are at or before the cutoff.

