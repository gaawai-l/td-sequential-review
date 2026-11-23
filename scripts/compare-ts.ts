// Compare the engine with TradingSignal's TD output on TradingSignal's own candles, marker by marker.
//
//   npm run compare-ts                 every sample under data/ts/
//   npm run compare-ts -- --ref baseline   run the algorithm as of a git ref instead of the working tree
//   npm run compare-ts -- --json
//
// Samples are local only (data/ is gitignored). A sample is either
//   data/ts/<name>.json                 { candles, result }
//   data/ts/<name>-klines.json + data/ts/<name>-td9.json
//                                       the two raw responses: { candles: [...] } and { result: {...} }
// Candles are { t, h, l, c } objects (o optional) or [t, h, l, c] arrays, t in seconds. The engine runs on those
// candles, so the comparison tests the algorithm only and does not depend on which exchange the data came from.
// Exits 1 when any sample differs.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { CURRENT, Impl, implAt } from './impl';
import { parseArgs } from './klines-file';
import { COLOR, DrawCandle, DrawMarker, chartPage, escapeHtml } from './page';

type TsSide = 'BUY' | 'SELL';

interface TsRunBar {
    ts: number;
    n: number;
    deferred?: boolean;
}

interface TsRun {
    side: TsSide;
    bars: TsRunBar[];
    active: boolean;
    completed?: boolean;
    perfected?: boolean;
    qualified?: boolean;
}

interface TsResult {
    markers: { ts: number; side: TsSide; kind: string; label: string }[];
    setupRuns: TsRun[];
    countdownRuns: TsRun[];
    tdstLines: { side: TsSide; price: number; fromTs: number; toTs: number; endReason: string }[];
    qualified13s: { ts: number; side: TsSide; riskLevel: number; stoppedTs: number | null }[];
}

type TsCandle = { t: number; o?: number; h: number; l: number; c: number } | [number, number, number, number];

export interface TsSample {
    name: string;
    symbol: string;
    timeframe: string;
    candles: { t: number; o: number | null; h: number; l: number; c: number }[];
    result: TsResult;
}

export interface Difference {
    category: string;
    /** 'missing': TradingSignal has it and the engine does not; 'extra': the engine has it and TradingSignal does not. */
    type: 'missing' | 'extra';
    /** Bar open time in seconds. */
    time: number;
    what: string;
}

export interface SampleReport {
    name: string;
    symbol: string;
    timeframe: string;
    bars: number;
    lastBar: number;
    algorithm: string;
    categories: { category: string; ts: number; matched: number }[];
    differences: Difference[];
    equal: boolean;
}

function normalizeCandle(c: TsCandle): TsSample['candles'][number] {
    return Array.isArray(c) ? { t: c[0], o: null, h: c[1], l: c[2], c: c[3] } : { t: c.t, o: c.o ?? null, h: c.h, l: c.l, c: c.c };
}

export function loadSamples(dir: string): TsSample[] {
    if (!existsSync(dir)) {
        return [];
    }
    const read = (file: string) => JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    const samples: TsSample[] = [];
    for (const file of files) {
        if (file.endsWith('-td9.json')) {
            continue;
        }
        const klines = read(file);
        let name = file.replace(/\.json$/, '');
        let result = klines.result;
        if (file.endsWith('-klines.json')) {
            name = file.replace(/-klines\.json$/, '');
            const td9File = `${name}-td9.json`;
            if (!files.includes(td9File)) {
                throw new Error(`${dir}/${file} has no matching ${td9File}`);
            }
            result = read(td9File).result;
        }
        if (!Array.isArray(klines.candles) || typeof result !== 'object' || result === null) {
            throw new Error(`${dir}/${file}: expected "candles" and "result"; see the header of scripts/compare-ts.ts`);
        }
        samples.push({
            name,
            symbol: String(klines.symbol ?? name),
            timeframe: String(klines.timeframe ?? ''),
            candles: (klines.candles as TsCandle[]).map(normalizeCandle),
            result: result as TsResult
        });
    }
    return samples;
}

const EVENT_MARKER: Record<string, string> = {
    setup_count: 'setup',
    countdown_count: 'countdown',
    qualified13: 'countdown_13',
    deferred13: 'countdown_def',
    perfected: 'setup_perfected',
    recycled: 'recycle'
};
const TS_END_REASON: Record<string, string | null> = { superseded: 'recycled', open: null };
const price = (value: number | string): string => Number(value).toFixed(6).replace(/\.?0+$/, '');

/** Keys are `time|rest`; time is the bar open time in seconds. */
function diffSets(category: string, ts: string[], ours: string[]): { summary: SampleReport['categories'][number]; differences: Difference[] } {
    const tsSet = new Set(ts);
    const ourSet = new Set(ours);
    const toDifference = (key: string, type: Difference['type']): Difference => {
        const [time, ...rest] = key.split('|');
        // Event keys repeat the kind as the label for everything but counts; say it once.
        const words = rest.filter((word, i) => word !== rest[i - 1]);
        return { category, type, time: Number(time), what: words.join(' ') };
    };
    const differences = [
        ...[...tsSet].filter((k) => !ourSet.has(k)).map((k) => toDifference(k, 'missing')),
        ...[...ourSet].filter((k) => !tsSet.has(k)).map((k) => toDifference(k, 'extra'))
    ];
    return {
        summary: { category, ts: tsSet.size, matched: [...tsSet].filter((k) => ourSet.has(k)).length },
        differences
    };
}

export function compareSample(impl: Impl, sample: TsSample): SampleReport {
    const times = sample.candles.map((c) => c.t);
    const rows = sample.candles.map((c) => ({ high: String(c.h), low: String(c.l), close: String(c.c) }));
    const { scale, bars } = impl.scaleRows(rows);
    const engineResult = impl.evaluateSequential(bars);
    const ours = impl.projectChart(engineResult, times.map((t) => t * 1000), scale);
    const ts = sample.result;
    const seconds = (ms: number | null): number | null => (ms === null ? null : ms / 1000);
    const lastBar = (run: TsRun): TsRunBar => run.bars[run.bars.length - 1] as TsRunBar;
    const numbered = (run: TsRun, n: number): TsRunBar | undefined => run.bars.find((b) => b.n === n);

    // 1. Every engine event against every TradingSignal marker.
    const ourEvents: string[] = [];
    for (const e of engineResult.events) {
        if (e.kind === 'countdown_count' && e.count === 13) {
            continue; // TradingSignal shows an accepted 13 only as countdown_13.
        }
        const kind =
            e.kind === 'cancelled' ? (e.reason === 'opposite_setup_completed' ? 'cancel_opp' : 'cancel_tdst') : EVENT_MARKER[e.kind];
        if (!kind) {
            continue;
        }
        const label = kind === 'setup' || kind === 'countdown' ? String(e.count) : kind;
        ourEvents.push(`${times[e.bar]}|${e.side.toUpperCase()}|${kind}|${label}`);
    }
    const tsEvents = ts.markers.map((m) => `${m.ts}|${m.side}|${m.kind}|${m.kind === 'setup' || m.kind === 'countdown' ? m.label : m.kind}`);

    // 2. What the chart draws.
    const parts = [
        diffSets('全部标记事件', tsEvents, ourEvents),
        diffSets(
            '9',
            ts.setupRuns.flatMap((r) => (r.completed && numbered(r, 9) ? [`${(numbered(r, 9) as TsRunBar).ts}|${r.side}|${r.perfected ? 'perfected' : 'plain'}`] : [])),
            ours.markers.flatMap((m) => (m.kind === 'setup9' ? [`${seconds(m.time)}|${m.side.toUpperCase()}|${m.perfected ? 'perfected' : 'plain'}`] : []))
        ),
        diffSets(
            '13',
            ts.countdownRuns.flatMap((r) => (r.qualified && numbered(r, 13) ? [`${(numbered(r, 13) as TsRunBar).ts}|${r.side}`] : [])),
            ours.markers.flatMap((m) => (m.kind === 'countdown13' ? [`${seconds(m.time)}|${m.side.toUpperCase()}`] : []))
        ),
        diffSets(
            'R',
            ts.markers.filter((m) => m.kind === 'recycle').map((m) => `${m.ts}|${m.side}`),
            ours.markers.flatMap((m) => (m.kind === 'recycle' ? [`${seconds(m.time)}|${m.side.toUpperCase()}`] : []))
        ),
        diffSets(
            '形成中的 Setup',
            ts.setupRuns.filter((r) => r.active).map((r) => `${lastBar(r).ts}|${r.side}|${r.bars.length}`),
            ours.markers.flatMap((m) => (m.kind === 'setupProgress' ? [`${seconds(m.time)}|${m.side.toUpperCase()}|${m.count}`] : []))
        ),
        diffSets(
            '进行中的 Countdown',
            ts.countdownRuns.filter((r) => r.active && !r.qualified).map((r) => `${lastBar(r).ts}|${r.side}|${lastBar(r).deferred ? '+' : lastBar(r).n}`),
            ours.markers.flatMap((m) => (m.kind === 'countdownProgress' ? [`${seconds(m.time)}|${m.side.toUpperCase()}|${m.label}`] : []))
        ),
        diffSets(
            'TDST 线',
            ts.tdstLines.map((l) => {
                const reason = l.endReason in TS_END_REASON ? TS_END_REASON[l.endReason] : l.endReason;
                return `${l.fromTs}|${l.side}|${price(l.price)}|until ${l.endReason === 'open' ? null : l.toTs}|${reason}`;
            }),
            ours.tdstLines.map((l) => `${seconds(l.startTime)}|${l.side.toUpperCase()}|${price(l.price)}|until ${seconds(l.endTime)}|${l.endReason}`)
        ),
        diffSets(
            'Risk 线',
            ts.qualified13s.map((q) => `${q.ts}|${q.side}|${price(q.riskLevel)}|invalidated ${q.stoppedTs}`),
            ours.riskLines.map((l) => `${seconds(l.time)}|${l.side.toUpperCase()}|${price(l.price)}|invalidated ${seconds(l.invalidatedTime)}`)
        )
    ];
    const differences = parts.flatMap((p) => p.differences).sort((a, b) => a.time - b.time);
    return {
        name: sample.name,
        symbol: sample.symbol,
        timeframe: sample.timeframe,
        bars: sample.candles.length,
        lastBar: times[times.length - 1] ?? 0,
        algorithm: impl.label,
        categories: parts.map((p) => p.summary),
        differences,
        equal: differences.length === 0
    };
}

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

export function summaryLine(report: SampleReport): string {
    const counts = report.categories.map((c) => `${c.category} ${c.matched}/${c.ts}`).join('，');
    const extra = report.differences.filter((d) => d.type === 'extra').length;
    return `${report.symbol} ${report.timeframe}（${report.name}，${report.bars} 根）：${report.equal ? '完全一致' : `不一致，共 ${report.differences.length} 处（其中 ${extra} 处是 TradingSignal 没有的）`}。${counts}`;
}

/** The engine's own chart on the sample's candles, with every difference drawn on top. */
function writePage(impl: Impl, sample: TsSample, report: SampleReport, out: string): void {
    const times = sample.candles.map((c) => c.t);
    const { scale, bars } = impl.scaleRows(sample.candles.map((c) => ({ high: String(c.h), low: String(c.l), close: String(c.c) })));
    const ours = impl.projectChart(impl.evaluateSequential(bars), times.map((t) => t * 1000), scale);
    const candles: DrawCandle[] = sample.candles.map((c, i) => ({
        time: c.t,
        open: c.o ?? sample.candles[i - 1]?.c ?? c.c,
        high: c.h,
        low: c.l,
        close: c.c
    }));
    const markers: DrawMarker[] = ours.markers.map((m) => ({
        time: m.time / 1000,
        position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: m.kind === 'setupProgress' ? COLOR.progress : m.kind === 'countdownProgress' ? COLOR.countdown : COLOR[m.side],
        shape: m.kind === 'countdown13' || (m.kind === 'setup9' && m.perfected) ? (m.side === 'buy' ? 'arrowUp' : 'arrowDown') : 'circle',
        text: m.kind === 'setupProgress' ? `S${m.label}` : m.kind === 'countdownProgress' ? `C${m.label}` : m.label
    }));
    for (const d of report.differences.filter((x) => x.category === '全部标记事件')) {
        markers.push({
            time: d.time,
            position: d.what.startsWith('BUY') ? 'belowBar' : 'aboveBar',
            color: d.type === 'missing' ? COLOR.removed : COLOR.added,
            shape: 'square',
            text: `${d.type === 'missing' ? 'TS' : '我们'}:${d.what.split(' ').slice(2).join(' ')}`
        });
    }
    const rows = report.differences
        .map(
            (d) =>
                `<tr class="${d.type === 'missing' ? 'removed' : 'added'}"><td>${iso(d.time)}</td><td>${escapeHtml(d.category)}</td><td>${d.type === 'missing' ? 'TradingSignal 有，我们没有' : '我们有，TradingSignal 没有'}</td><td>${escapeHtml(d.what)}</td></tr>`
        )
        .join('');
    writeFileSync(
        out,
        chartPage({
            title: `TradingSignal 对比 · ${sample.symbol} ${sample.timeframe}`,
            headHtml: `<div class="muted">算法：${escapeHtml(impl.label)} · ${escapeHtml(summaryLine(report))}</div><div><span style="color:${COLOR.removed}">■ TradingSignal 有、我们没有</span> <span style="color:${COLOR.added}">■ 我们有、TradingSignal 没有</span> · 其余是我们算出的标记</div>`,
            bodyHtml: report.equal
                ? '<p class="ok">逐个标记完全一致。</p>'
                : `<table><tr><th>K 线时间 (UTC)</th><th>类别</th><th>差异</th><th>内容</th></tr>${rows}</table>`,
            candles,
            markers,
            lines: []
        })
    );
}

function main(): void {
    const { flags } = parseArgs(process.argv.slice(2));
    const dir = flags.get('dir') || path.join('data', 'ts');
    const samples = loadSamples(dir);
    if (samples.length === 0) {
        throw new Error(`No TradingSignal samples in ${dir}/; see the header of scripts/compare-ts.ts for the file format`);
    }
    const ref = flags.get('ref') || null;
    const impl = ref === null ? CURRENT : implAt(ref);
    const reports = samples.map((s) => compareSample(impl, s));
    if (flags.has('json')) {
        console.log(JSON.stringify(reports, null, 2));
    } else {
        mkdirSync(path.join('data', 'view'), { recursive: true });
        console.log(`算法：${impl.label}`);
        reports.forEach((report, i) => {
            console.log(summaryLine(report));
            for (const d of report.differences.slice(0, 20)) {
                console.log(`  ${iso(d.time)}  ${d.category}  ${d.type === 'missing' ? 'TS 有我们没有' : '我们有 TS 没有'}  ${d.what}`);
            }
            if (report.differences.length > 20) {
                console.log(`  … 还有 ${report.differences.length - 20} 处，见页面`);
            }
            const out = path.join('data', 'view', `ts-${report.name}.html`);
            writePage(impl, samples[i] as TsSample, report, out);
            console.log(`  ${path.resolve(out)}`);
        });
    }
    if (reports.some((r) => !r.equal)) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
