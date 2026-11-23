// One page that says what the working tree changed compared with a git ref (default: the `baseline` tag).
//
//   npm run report
//   npm run report -- --symbols BTCUSDC,ETHUSDC --intervals 15m,1h,4h --bars 5000 --ref baseline
//
// It downloads missing kline files, then puts on one page: test results, the TradingSignal comparison (when
// data/ts/ has samples), the 9/13 backtest before and after, every 9/13 that appeared or disappeared (with
// side-by-side chart pages for the newest ones), and the AI trend panel before and after at three moments.
// Options: --refresh (download klines again), --no-tests, --window 500, --horizons 3,12,24.
// Output: data/report/index.html.

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { INTERVAL_MS, KlineRow, isDemarkInterval } from '../src/services/manager/demark/binance-klines';
import { DemarkInterval } from '../src/services/manager/types/demark-types';
import { INSIGHT_INTERVALS } from '../src/services/manager/types/insight-types';
import { GroupStats, Signal, collectSignals, summarize } from './backtest';
import { SampleReport, compareSample, loadSamples, summaryLine } from './compare-ts';
import { CURRENT, Impl, buildPanel, implAt, loadPanelRows, signalSymbolOf } from './impl';
import { downloadKlines, parseArgs, readKlineFile } from './klines-file';
import { PAGE_CSS, escapeHtml } from './page';
import { panelFields } from './view';

const OUT_DIR = path.join('data', 'report');
const MIN_SAMPLE = 30;
const MAX_VIEW_PAGES = 12;
const KIND_TEXT: Record<string, string> = { setup9: '9', countdown13: '13' };

interface PairResult {
    symbol: string;
    interval: DemarkInterval;
    bars: number;
    from: number;
    to: number;
    before: GroupStats[];
    after: GroupStats[];
    added: { time: number; text: string }[];
    removed: { time: number; text: string }[];
    /** Same bar, kind and side, but a 9 gained or lost perfection. */
    changed: { time: number; text: string }[];
    views: { time: number; file: string }[];
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(':00.000Z', 'Z');
const pct = (x: number | null): string => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);

function signalText(s: Signal): string {
    return `${s.side} ${KIND_TEXT[s.kind]}${s.kind === 'setup9' ? (s.perfected ? ' (perfected)' : '') : ''}`;
}

async function ensureData(symbols: string[], refresh: boolean): Promise<void> {
    mkdirSync('data', { recursive: true });
    for (const symbol of symbols) {
        for (const interval of INSIGHT_INTERVALS) {
            const file = path.join('data', `${symbol}-${interval}.json`);
            if (!refresh && existsSync(file)) {
                continue;
            }
            console.log(`下载 ${symbol} ${interval} K 线…`);
            writeFileSync(file, JSON.stringify(await downloadKlines(symbol, interval, 20000)));
        }
    }
}

function runTests(): { typecheck: boolean; tests: boolean; detail: string } {
    console.log('运行类型检查和测试…');
    const tsc = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8' });
    const jest = spawnSync('npx', ['jest'], { encoding: 'utf8' });
    const line = /Tests:.*$/m.exec(`${jest.stderr}\n${jest.stdout}`)?.[0] ?? 'no test summary';
    return { typecheck: tsc.status === 0, tests: jest.status === 0, detail: line.replace(/^Tests:\s*/, '') };
}

/** Pooled hit rate across pairs for one signal kind and horizon. */
function pooled(results: PairResult[], which: 'before' | 'after', kind: string, h: number): { n: number; hit: number | null; base: number | null } {
    let n = 0;
    let hits = 0;
    let base = 0;
    for (const r of results) {
        const stats = r[which].find((g) => g.group === kind)?.horizons.find((x) => x.h === h);
        if (stats && stats.n > 0 && stats.hitRate !== null && stats.baseRate !== null) {
            n += stats.n;
            hits += stats.hitRate * stats.n;
            base += stats.baseRate * stats.n;
        }
    }
    return { n, hit: n ? hits / n : null, base: n ? base / n : null };
}

function hitCell(before: { n: number; hit: number | null; base: number | null }, after: { n: number; hit: number | null; base: number | null }): string {
    if (after.hit === null && before.hit === null) {
        return '<td class="muted">无信号</td>';
    }
    const small = after.n < MIN_SAMPLE;
    const delta = after.hit !== null && before.hit !== null ? after.hit - before.hit : 0;
    const cls = small || Math.abs(delta) < 0.005 ? '' : delta > 0 ? ' class="ok"' : ' class="bad"';
    const change = before.hit === after.hit && before.n === after.n ? pct(after.hit) : `${pct(before.hit)} → ${pct(after.hit)}`;
    return `<td${cls}>${change}<span class="muted">（随机 ${pct(after.base)}，${after.n} 次${small ? '，样本不足' : ''}）</span></td>`;
}

function backtestHtml(results: PairResult[], horizons: number[], refLabel: string): string {
    const head = `<tr><th>标的 / 周期</th><th>信号</th><th>次数（前 → 后）</th>${horizons.map((h) => `<th>${h} 根 K 线后方向命中率</th>`).join('')}</tr>`;
    const rows: string[] = [];
    for (const kind of ['setup9', 'countdown13']) {
        const count = (which: 'before' | 'after') => results.reduce((sum, r) => sum + (r[which].find((g) => g.group === kind)?.signals ?? 0), 0);
        rows.push(
            `<tr><th>全部合计</th><th>${KIND_TEXT[kind]}</th><td class="num">${count('before')} → ${count('after')}</td>${horizons
                .map((h) => hitCell(pooled(results, 'before', kind, h), pooled(results, 'after', kind, h)))
                .join('')}</tr>`
        );
    }
    for (const r of results) {
        for (const kind of ['setup9', 'countdown13']) {
            const b = r.before.find((g) => g.group === kind);
            const a = r.after.find((g) => g.group === kind);
            const cell = (h: number) => {
                const pick = (g: GroupStats | undefined) => {
                    const x = g?.horizons.find((y) => y.h === h);
                    return { n: x?.n ?? 0, hit: x?.hitRate ?? null, base: x?.baseRate ?? null };
                };
                return hitCell(pick(b), pick(a));
            };
            rows.push(
                `<tr><td>${r.symbol} ${r.interval}</td><td>${KIND_TEXT[kind]}</td><td class="num">${b?.signals ?? 0} → ${a?.signals ?? 0}</td>${horizons.map(cell).join('')}</tr>`
            );
        }
    }
    return `<p class="muted">按线上方式逐根重放：每根 K 线收盘时用最近的窗口计算，取当时新出现的 9 和 13。buy 信号看之后是否上涨，sell 信号看之后是否下跌。「随机」是同一段行情里随便挑一根 K 线、按同样方向进场的命中率，命中率要明显高于它才有意义。少于 ${MIN_SAMPLE} 次的结果不下结论。「前」是 ${escapeHtml(refLabel)}，「后」是当前代码。</p><table>${head}${rows.join('')}</table>`;
}

function changesHtml(results: PairResult[]): string {
    const changed = results.filter((r) => r.added.length + r.removed.length + r.changed.length > 0);
    if (changed.length === 0) {
        return '<p class="ok">重放期间出现的 9 和 13 与改动前完全相同。</p>';
    }
    const rows = changed
        .map((r) => {
            const list = (items: PairResult['added']) =>
                items.length === 0
                    ? '-'
                    : items
                          .slice(-8)
                          .map((x) => {
                              const view = r.views.find((v) => v.time === x.time);
                              const text = `${iso(x.time)} ${escapeHtml(x.text)}`;
                              return view ? `<a href="${escapeHtml(view.file)}">${text}</a>` : text;
                          })
                          .join('<br>') + (items.length > 8 ? `<br><span class="muted">更早还有 ${items.length - 8} 个</span>` : '');
            return `<tr><td>${r.symbol} ${r.interval}</td><td class="num">${r.added.length}</td><td>${list(r.added)}</td><td class="num">${r.removed.length}</td><td>${list(r.removed)}</td><td class="num">${r.changed.length}</td><td>${list(r.changed)}</td></tr>`;
        })
        .join('');
    return `<p class="muted">时间是信号所在 K 线的开盘时间（UTC）。带链接的可以点开看改动前后的对比图。</p><table><tr><th>标的 / 周期</th><th>新增</th><th>新增的信号</th><th>消失</th><th>消失的信号</th><th>变化</th><th>变化的信号</th></tr>${rows}</table>`;
}

function tsHtml(before: SampleReport[], after: SampleReport[], refLabel: string): string {
    if (after.length === 0) {
        return '<p class="warn">没有 TradingSignal 样本（data/ts/ 为空），这一项没有检查。样本格式见 README「和 TradingSignal 对比」。</p>';
    }
    const rows = after
        .map((a, i) => {
            const b = before[i] as SampleReport;
            const cell = (r: SampleReport) => (r.equal ? '<td class="ok">完全一致</td>' : `<td class="bad">${r.differences.length} 处不一致</td>`);
            const marks = a.categories[0];
            return `<tr><td>${escapeHtml(a.symbol)} ${escapeHtml(a.timeframe)}</td><td class="num">${a.bars}</td>${cell(b)}${cell(a)}<td class="num">${marks ? `${marks.matched}/${marks.ts}` : '-'}</td></tr>`;
        })
        .join('');
    const details = after
        .filter((a) => !a.equal)
        .map(
            (a) =>
                `<h3>${escapeHtml(a.symbol)} ${escapeHtml(a.timeframe)} 的差异</h3><table><tr><th>K 线时间 (UTC)</th><th>类别</th><th>差异</th><th>内容</th></tr>${a.differences
                    .slice(0, 40)
                    .map(
                        (d) =>
                            `<tr><td>${iso(d.time * 1000)}</td><td>${escapeHtml(d.category)}</td><td>${d.type === 'missing' ? 'TradingSignal 有，我们没有' : '我们有，TradingSignal 没有'}</td><td>${escapeHtml(d.what)}</td></tr>`
                    )
                    .join('')}</table>${a.differences.length > 40 ? `<p class="muted">共 ${a.differences.length} 处，只列出前 40 处；完整结果运行 npm run compare-ts。</p>` : ''}`
        )
        .join('');
    return `<p class="muted">用 TradingSignal 自己的 K 线运行我们的算法，再逐个标记比对，所以结果不受数据源影响。</p><table><tr><th>样本</th><th>K 线数</th><th>${escapeHtml(refLabel)}</th><th>当前代码</th><th>标记一致数</th></tr>${rows}</table>${details}`;
}

async function main(): Promise<void> {
    const { flags } = parseArgs(process.argv.slice(2));
    const symbols = (flags.get('symbols') || 'BTCUSDC,ETHUSDC,NVDAUSDT').split(',');
    const intervals = (flags.get('intervals') || '15m,1h,4h').split(',');
    if (!intervals.every(isDemarkInterval)) {
        throw new Error('--intervals takes 1m, 5m, 15m, 1h, 4h or 1d, comma-separated');
    }
    const bars = Number(flags.get('bars') || 5000);
    const window = Number(flags.get('window') || 500);
    const horizons = (flags.get('horizons') || '3,12,24').split(',').map(Number);
    const ref = flags.get('ref') || 'baseline';
    const before: Impl = implAt(ref);
    const after: Impl = CURRENT;

    await ensureData(symbols, flags.has('refresh'));
    const tests = flags.has('no-tests') ? null : runTests();
    mkdirSync(path.join(OUT_DIR, 'views'), { recursive: true });

    // Backtest and signal changes.
    const results: PairResult[] = [];
    const skipped: string[] = [];
    for (const symbol of symbols) {
        for (const interval of intervals) {
            const all = readKlineFile(path.join('data', `${symbol}-${interval}.json`)).rows;
            const rows = all.slice(-(bars + window - 1));
            if (rows.length < window + 100) {
                skipped.push(`${symbol} ${interval}（只有 ${rows.length} 根 K 线）`);
                continue;
            }
            console.log(`回测 ${symbol} ${interval}（${rows.length - window + 1} 根）…`);
            const closes = rows.map((r) => Number(r.close));
            const b = collectSignals(before, interval, rows, window).signals;
            const a = collectSignals(after, interval, rows, window).signals;
            const key = (s: Signal) => `${s.index}|${s.kind}|${s.side}`;
            const bByKey = new Map(b.map((s) => [key(s), s]));
            const bKeys = new Set(bByKey.keys());
            const aKeys = new Set(a.map(key));
            const item = (s: Signal) => ({ time: (rows[s.index] as KlineRow).openTime, text: signalText(s) });
            results.push({
                symbol,
                interval,
                bars: rows.length - window + 1,
                from: (rows[window - 1] as KlineRow).openTime,
                to: (rows[rows.length - 1] as KlineRow).openTime,
                before: summarize(b, closes, horizons),
                after: summarize(a, closes, horizons),
                added: a.filter((s) => !bKeys.has(key(s))).map(item),
                removed: b.filter((s) => !aKeys.has(key(s))).map(item),
                changed: a
                    .filter((s) => bByKey.has(key(s)) && bByKey.get(key(s))?.perfected !== s.perfected)
                    .map((s) => ({ time: (rows[s.index] as KlineRow).openTime, text: `${signalText(bByKey.get(key(s)) as Signal)} → ${signalText(s)}` })),
                views: []
            });
        }
    }

    // Side-by-side chart pages for the newest changes of each pair.
    let pages = 0;
    for (const r of results) {
        const times = [...new Set([...r.added, ...r.removed, ...r.changed].map((x) => x.time))].sort((x, y) => y - x).slice(0, 2);
        for (const time of times) {
            if (pages >= MAX_VIEW_PAGES) {
                break;
            }
            const file = path.join('views', `${r.symbol}-${r.interval}-${time}.html`);
            const at = new Date(time + INTERVAL_MS[r.interval]).toISOString();
            const view = spawnSync('npx', ['tsx', 'scripts/view.ts', r.symbol, r.interval, '--at', at, '--compare', ref, '--out', path.join(OUT_DIR, file)], { encoding: 'utf8' });
            if (view.status === 0) {
                r.views.push({ time, file });
                pages++;
            } else {
                console.error(`对比图生成失败 ${r.symbol} ${r.interval} ${at}: ${view.stderr.trim().split('\n')[0]}`);
            }
        }
    }

    // AI trend panel at three moments per symbol.
    console.log('对比 AI 趋势面板…');
    const panelRows: string[] = [];
    let panelMoments = 0;
    let panelChanged = 0;
    for (const symbol of symbols) {
        const fiveMin = readKlineFile(path.join('data', `${symbol}-5m.json`)).rows;
        const newest = (fiveMin[fiveMin.length - 1] as KlineRow).openTime + INTERVAL_MS['5m'];
        for (const at of [newest, newest - 24 * 3_600_000, newest - 72 * 3_600_000]) {
            try {
                const rows = await loadPanelRows(symbol, at);
                const signalSymbol = signalSymbolOf(symbol);
                const now = panelFields(buildPanel(after, signalSymbol, rows));
                const old = panelFields(buildPanel(before, signalSymbol, rows));
                const diffs = now.filter(([, value], i) => old[i]?.[1] !== value);
                panelMoments++;
                if (diffs.length === 0) {
                    panelRows.push(`<tr><td>${symbol}</td><td>${iso(at)}</td><td class="ok">没有变化</td><td></td><td></td></tr>`);
                    continue;
                }
                panelChanged++;
                now.forEach(([name, value], i) => {
                    if (old[i]?.[1] !== value) {
                        panelRows.push(`<tr class="changed"><td>${symbol}</td><td>${iso(at)}</td><td>${name}</td><td>${escapeHtml(old[i]?.[1] ?? '')}</td><td>${escapeHtml(value)}</td></tr>`);
                    }
                });
            } catch (error) {
                panelRows.push(`<tr><td>${symbol}</td><td>${iso(at)}</td><td class="warn" colspan="3">没有算出来：${escapeHtml(error instanceof Error ? error.message : String(error))}</td></tr>`);
            }
        }
    }

    // TradingSignal.
    const samples = loadSamples(path.join('data', 'ts'));
    const tsBefore = samples.map((s) => compareSample(before, s));
    const tsAfter = samples.map((s) => compareSample(after, s));

    const added = results.reduce((sum, r) => sum + r.added.length, 0);
    const removed = results.reduce((sum, r) => sum + r.removed.length, 0);
    const changed = results.reduce((sum, r) => sum + r.changed.length, 0);
    const tsEqual = tsAfter.filter((r) => r.equal).length;
    const verdicts: [string, string, string][] = [
        tests === null
            ? ['warn', '测试', '本次没有运行']
            : tests.typecheck && tests.tests
              ? ['ok', '测试', `全部通过（${tests.detail}）`]
              : ['bad', '测试', `${tests.typecheck ? '' : '类型检查失败；'}${tests.tests ? '' : `单元测试失败（${tests.detail}）`}`],
        samples.length === 0
            ? ['warn', '和 TradingSignal 一致', '没有样本，未检查']
            : tsEqual === samples.length
              ? ['ok', '和 TradingSignal 一致', `${samples.length} 个样本全部逐标记一致`]
              : ['bad', '和 TradingSignal 一致', `${samples.length} 个样本里有 ${samples.length - tsEqual} 个不一致（改动前有 ${tsBefore.filter((r) => !r.equal).length} 个不一致）`],
        added + removed + changed === 0
            ? ['ok', '9 和 13', '与改动前完全相同']
            : ['warn', '9 和 13', `新增 ${added} 个，消失 ${removed} 个，变化 ${changed} 个`],
        panelChanged === 0 ? ['ok', 'AI 趋势面板', `${panelMoments} 个时刻都没有变化`] : ['warn', 'AI 趋势面板', `${panelMoments} 个时刻里有 ${panelChanged} 个发生变化`]
    ];

    const range = results.length ? `${iso(Math.min(...results.map((r) => r.from)))} 至 ${iso(Math.max(...results.map((r) => r.to)))}` : '-';
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>改动报告</title><style>${PAGE_CSS}</style></head><body>
<h1>改动报告</h1>
<div class="muted">当前代码对比 ${escapeHtml(before.label)} · 生成于 ${new Date().toISOString().slice(0, 16)}Z · 行情范围 ${range} · 标的 ${symbols.join('、')} · 周期 ${intervals.join('、')}</div>
<table>${verdicts.map(([cls, name, text]) => `<tr><th>${name}</th><td class="${cls}">${escapeHtml(text)}</td></tr>`).join('')}</table>
${skipped.length ? `<p class="warn">跳过（K 线太少）：${escapeHtml(skipped.join('；'))}</p>` : ''}
<h2>和 TradingSignal 对比</h2>
${tsHtml(tsBefore, tsAfter, before.label)}
<h2>9 和 13 的变化</h2>
${changesHtml(results)}
<h2>回测</h2>
${backtestHtml(results, horizons, before.label)}
<h2>AI 趋势面板</h2>
<p class="muted">每个标的取三个时刻：最新、一天前、三天前。只列出有变化的项目。</p>
<table><tr><th>标的</th><th>时刻 (UTC)</th><th>项目</th><th>${escapeHtml(before.label)}</th><th>当前代码</th></tr>${panelRows.join('')}</table>
</body></html>
`;
    const out = path.join(OUT_DIR, 'index.html');
    writeFileSync(out, html);
    console.log('');
    for (const [cls, name, text] of verdicts) {
        console.log(`${cls === 'ok' ? '✓' : cls === 'bad' ? '✗' : '!'} ${name}：${text}`);
    }
    tsAfter.filter((r) => !r.equal).forEach((r) => console.log(`  ${summaryLine(r)}`));
    console.log(`\n报告：${path.resolve(out)}`);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
