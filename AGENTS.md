# AGENTS.md

本仓库摘自线上服务，包含两样东西，用于算法调整和回测：

- TD Sequential 9/13 图表标记引擎；
- 建在它上面的 AI 趋势面板，包括规则层和文案层。

背景、接口字段、面板的生成流程和已知口径都在 `README.md` 里，动手前先读一遍。

## 和用户沟通

使用这个仓库的人可能不懂编程，也不熟悉 AI 工具。默认按下面的方式配合：

- 用中文、用大白话回答。先说结果，再说原因。不要贴大段代码、JSON 或命令输出。
- 命令都由你来运行，不要让用户自己敲命令。需要联网或权限时，直接说明需要用户点一下允许。
- 生成了页面（`view`、`report`、`compare-ts`）就直接用系统命令打开它，并告诉用户看页面的哪一部分。
- 用户说的时间按他说的时区理解，换算成 UTC 后再传给 `--at`，并把换算结果说出来让他确认。
- 每次改动行为后都运行 `npm run report`，把顶部四行结论原样转述给用户，再打开报告。有红色项时先处理，不要交付。
- git、fork、PR、打补丁这些操作全部代办，只在需要用户登录或授权时才请他操作。
- 用户常说的话和对应做法见 `docs/how-to-ask.md`。

## 环境

- **需要联网。**
  - `npm install` 要访问 npm registry。
  - `fetch-klines`、不带 `--at` 的 `chart`、`insight`、`view` 要访问 `fapi.binance.com`。
  - 如果在沙箱里运行，先放开网络。报错里出现 `Cannot reach … fapi.binance.com` 就是网络不通。
- `npm install` 可能提示 esbuild 的 postinstall 脚本没有被允许运行。这只是警告，不影响使用。
- 第一次 commit 前确认已配置 git 身份（`git config user.name` 和 `user.email`）。

## 命令

**`--at T` 在所有脚本里含义相同**：每个窗口取到 T 时刻为止已收盘的最新一根 K 线。例如 `--at 2026-11-10T08:00:00Z` 时，1h 的最后一根是 07:00 开盘的那根，4h 的最后一根是 04:00 开盘的那根。不带 `--at` 时用的是现在的实时数据。

- `npm run typecheck`：类型检查，覆盖 src、tests、scripts。
- `npm test`：全部单测，不联网。
- `npm run fetch-klines -- SYMBOL 5m,15m,1h,4h,1d [bars]`：从 Binance 公开接口拉 K 线到 `data/`，每个周期一个文件。`data/` 已被 gitignore。要对比别的标的，先给那个标的跑一遍。
- `npm run chart -- SYMBOL INTERVAL [limit]`：输出 9/13 标记接口现在的返回。
  - 加 `--file data/X.json --at T [--limit 500]`：输出 T 时刻接口的返回。
- `npm run backtest -- --file data/X.json [--window 500] [--horizons 1,3,6,12,24] [--json] [--ref REF]`：回测 setup9 和 countdown13 两种信号。
  - 不带 `--window`：全量历史一次算完。
  - `--window 500`：按线上方式逐根重放。
  - 只改了进行中数字、线段等，没有影响 9 和 13 的出现位置时，回测结果前后完全相同是正常的。
- `npm run insight -- SYMBOL [--at T] [--lang zhCN|en|both] [--json] [--ref REF]`：输出 AI 趋势面板，包括卡片、结论、各周期、复盘、关注。
  - 加 `--at`：读 `data/` 里五个周期的文件。
  - `.env` 或 shell 里有 `INSIGHT_LLM_BASE_URL` 和 `INSIGHT_LLM_API_KEY` 时，会额外调用 LLM 输出结论。格式见 `.env.example`。
- `npm run view -- SYMBOL INTERVAL [--at T] [--limit 500] [--compare REF] [--llm] [--out PATH]`：生成看图 HTML（K 线、标记、线、AI 趋势面板），并打印路径。
  - `--compare REF`：与某个 git 版本逐项对比。
  - `--llm`：额外调用 LLM，给当前版本生成线上那样的结论，需要 `.env`。
  - 给用户看结果时，生成这个页面并告诉对方路径；能打开浏览器的话直接打开。
- `npm run report [--symbols A,B] [--intervals 15m,1h,4h] [--bars 5000] [--ref REF] [--refresh] [--no-tests]`：一键报告，生成 `data/report/index.html`。把当前代码和 REF（默认 `baseline`）放在一起比：测试、TradingSignal 一致性、9/13 的变化、回测前后、AI 趋势面板前后。缺的 K 线会自动下载。
- `npm run compare-ts [--ref REF] [--json]`：用 `data/ts/` 里的 TradingSignal 样本逐标记比对，有不一致时以非 0 退出。样本格式见 README「和 TradingSignal 对比」。`data/ts/` 为空时这一项无法检查，要如实告诉用户，不要说成通过。
- `--ref REF` / `--compare REF`：用 git 版本 REF 的 `src/` 计算，而不是当前工作区。`baseline` tag 是线上现行算法，所以「改动前」的输出随时都能用 `--ref baseline` 补跑，不必先 stash。

## 代码边界

**可以改**
- 引擎：`src/services/manager/demark/engine.ts`、`chart.ts`、`fixed-decimal.ts`。
- 面板规则层：`summary.ts`、`regime.ts`、`insight-facts.ts`、`strength.ts`、`protection.ts`。
- 面板文案层：`src/services/sync/signal-insight/` 下的 `card-phase.ts`、`wording.ts`、`insight-template.ts`、`insight-text.ts`、`lean.ts`、`llm-client.ts`（含系统提示词）。
- `binance-klines.ts`、`demark-service.ts`：取数和缓存。只有确实和数据准确性有关时才改。

**不能改**
- 导出函数的签名：`evaluateSequential`、`projectChart`、`buildChart`、`fetchClosedKlines`、`scaleRows`、`analyzeWindow`、`assembleSnapshot`、`templateSections`、`generateInsight`。
- `demark-types.ts`、`insight-types.ts` 里的响应结构。可以新增可选字段，但要在 PR 里说明。
- 文件路径和导出名。改动会按原路径搬回线上服务。
- 占位文件：`src/shared/utils/logger.ts`、`src/services/sync/signal-push/signal-push-task.ts`、`src/services/sync/signal-push/symbols.ts`。它们只为让代码在这里能跑，不会搬回去。

**其它要求**
- 算法和规则代码保持纯函数，不做 I/O、不读时钟。`src/` 不引入新的运行时依赖。
- 面板文案的硬约束由 `tests/unit/signal-insight/` 守着：不出现多空、看涨看跌这类词，不出现指标名，数字原样照抄。改文案时不能放松这些约束。

## 问题分类

用户指出一个问题后，先归到下面四类之一，并说明依据：

1. **算法确实不对**：按 README 的规则说明或公认定义，输出就是错的。
2. **已知口径**：README「已知的口径，不算错误」里已经写到。解释给用户听，不改代码。
3. **前端画法**：数据本身对，是页面画法的问题，不在这个仓库里。
4. **需求或规则变更**：现有输出符合现有规则，但用户希望规则改一下。

第 1 类和第 4 类都按下面的改动规则走。第 4 类改完后，要同步更新 README 里对应的规则描述。

## 改动规则

- 先有能复现问题的测试，再改算法或规则。用例里写清以下几项：
  - symbol、周期、K 线时间（面板问题写时刻）；
  - 期望值、实际值；
  - 期望值的依据。
- 原有测试的期望值只有两种情况可以改：确认原值错了，或者属于第 4 类、规则本身变了。改了要在 commit message 里说明原因。
  - `parity.test.ts`、`summary.test.ts`、`regime.test.ts` 的期望值来自 Python 参考实现，改它们要格外说明。
  - `__snapshots__` 只能在确认新输出正确后才更新。
- 每次改动行为后先跑 `npm run report`。和 TradingSignal 出现不一致时，逐条写明是哪根 K 线、为什么，并写进 `reports/<日期>-<主题>/README.md`。
- 每次改动行为后，在 `reports/<日期>-<主题>/` 下存前后对比，「改动前」用 `--ref baseline` 跑：
  - 改了 9/13：`backtest --json`，全量和 `--window 500` 各一份，存成 `backtest-<标的>-<周期>-<full|w500>.before.json` 和 `.after.json`。
  - 改了面板：挑几个有代表性的时刻跑 `insight --at T --json`，存成 `insight-<标的>-<时刻>.before.json` 和 `.after.json`。
  - 用 `view --compare baseline` 至少生成三个场景的对比页：用户指出的那个，加上另外两个标的或周期。页面在 `data/view/` 下，不提交。
  - `reports/<日期>-<主题>/README.md` 写四件事：改了什么、依据、前后差异的结论，以及用户该运行哪几条 `view --compare baseline` 命令来看效果。
- 不要移动或删除 `baseline` tag。
- 提交前 `npm run typecheck` 和 `npm test` 必须全部通过。
- 不提交 `.env`、API key、`data/` 和 `patches/`。LLM 网关地址和 key 不要写进任何提交、报告或 PR，这是公开仓库。
- 代码、注释、commit message 用英文，commit 遵循 conventional commits（`fix(engine): ...`、`fix(insight): ...`）。
