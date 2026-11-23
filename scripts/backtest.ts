// Backtest 9 and 13 markers on a local kline file.
//
//   npm run backtest -- --file data/BTCUSDC-4h.json [--window 500] [--horizons 1,3,6,12,24] [--json] [--ref baseline]
//
// --ref REF      run the algorithm as of git ref REF instead of the working tree (e.g. the `baseline` tag), so the
//                'before' numbers can be produced at any time.
// --window 0     evaluate the whole file once; every setup9 / countdown13 marker is a signal.
// --window N     replay production: at each closed bar, compute the chart on the last N bars (what the
//                API served then) and take the setup9 / countdown13 markers that appear on that newest bar.
//                Also counts markers that vanish from one bar to the next while still inside the window.
//
// Return is measured from the signal bar's close to the close h bars later, signed by the expected
// direction (buy = up, sell = down). Hit rate = share of signals with a positive signed return.
// Base rate = the hit rate the same number of buy and sell entries would get on any bar of the file:
// the share of bars that closed higher (for buys) or lower (for sells) h bars later.

import { KlineRow } from '../src/services/manager/demark/binance-klines';
import { DemarkInterval, DemarkMarker } from '../src/services/manager/types/demark-types';
import { CURRENT, Impl, implAt } from './impl';
import { parseArgs, readKlineFile } from './klines-file';

type SignalKind = 'setup9' | 'countdown13';

export interface Signal {
    index: number;
    kind: SignalKind;
    side: 'buy' | 'sell';
    perfected?: boolean;
}

export interface HorizonStats {
    h: number;
    n: number;
    hitRate: number | null;
    baseRate: number | null;
    meanPct: number | null;
}

export interface GroupStats {
    group: string;
    signals: number;
    horizons: HorizonStats[];
}

function isSignal(m: DemarkMarker): m is Extract<DemarkMarker, { kind: SignalKind }> {
    return m.kind === 'setup9' || m.kind === 'countdown13';
}

function toSignal(m: Extract<DemarkMarker, { kind: SignalKind }>, index: number): Signal {
    return m.kind === 'setup9'
        ? { index, kind: m.kind, side: m.side, perfected: m.perfected }
        : { index, kind: m.kind, side: m.side };
}

export function collectSignals(
    impl: Impl,
    interval: DemarkInterval,
    rows: readonly KlineRow[],
    window: number
): { signals: Signal[]; vanished: number } {
    const markersOf = (slice: readonly KlineRow[]): DemarkMarker[] => impl.buildChart('', interval, slice).markers;
    const indexByTime = new Map(rows.map((r, i) => [r.openTime, i]));
    if (window <= 0) {
        const signals = markersOf(rows)
            .filter(isSignal)
            .map((m) => toSignal(m, indexByTime.get(m.time) as number));
        return { signals, vanished: 0 };
    }
    const signals: Signal[] = [];
    let vanished = 0;
    let previous = new Set<string>();
    for (let t = window - 1; t < rows.length; t++) {
        const start = t - window + 1;
        const markers = markersOf(rows.slice(start, t + 1)).filter(isSignal);
        const current = new Set(markers.map((m) => `${m.time}|${m.kind}|${m.side}`));
        const windowStart = (rows[start] as KlineRow).openTime;
        for (const key of previous) {
            if (Number(key.split('|')[0]) >= windowStart && !current.has(key)) {
                vanished++;
            }
        }
        previous = current;
        const newest = (rows[t] as KlineRow).openTime;
        for (const m of markers) {
            if (m.time === newest) {
                signals.push(toSignal(m, t));
            }
        }
    }
    return { signals, vanished };
}

export function summarize(signals: readonly Signal[], closes: readonly number[], horizons: readonly number[]): GroupStats[] {
    // Share of all bars that closed higher / lower h bars later: what an entry on a random bar would hit.
    const upRate = new Map<number, { up: number; down: number }>();
    for (const h of horizons) {
        let up = 0;
        let down = 0;
        const total = closes.length - h;
        for (let i = 0; i < total; i++) {
            const move = (closes[i + h] as number) - (closes[i] as number);
            if (move > 0) up++;
            if (move < 0) down++;
        }
        upRate.set(h, total > 0 ? { up: up / total, down: down / total } : { up: 0, down: 0 });
    }
    const groups = new Map<string, Signal[]>();
    for (const s of signals) {
        const keys = [`${s.kind} ${s.side}`, s.kind];
        if (s.kind === 'setup9') keys.push(`setup9 ${s.perfected ? 'perfected' : 'plain'}`);
        for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, list]) => ({
            group,
            signals: list.length,
            horizons: horizons.map((h) => {
                const scored = list.filter((s) => closes[s.index + h] !== undefined);
                const returns = scored.map(
                    (s) => ((closes[s.index + h] as number) / (closes[s.index] as number) - 1) * (s.side === 'buy' ? 1 : -1) * 100
                );
                const rates = upRate.get(h) as { up: number; down: number };
                const n = returns.length;
                return {
                    h,
                    n,
                    hitRate: n ? returns.filter((r) => r > 0).length / n : null,
                    baseRate: n ? scored.reduce((sum, s) => sum + (s.side === 'buy' ? rates.up : rates.down), 0) / n : null,
                    meanPct: n ? returns.reduce((a, b) => a + b, 0) / n : null
                };
            })
        }));
}

function main(): void {
    const { flags } = parseArgs(process.argv.slice(2));
    const file = flags.get('file');
    if (!file) {
        throw new Error('Usage: npm run backtest -- --file data/SYMBOL-INTERVAL.json [--window 500] [--horizons 1,3,6,12,24] [--json] [--ref REF]');
    }
    const ref = flags.get('ref') || null;
    const impl = ref === null ? CURRENT : implAt(ref);
    const window = Number(flags.get('window') || 0);
    const horizons = (flags.get('horizons') || '1,3,6,12,24').split(',').map(Number);
    const { symbol, interval, rows } = readKlineFile(file);
    const { signals, vanished } = collectSignals(impl, interval, rows, window);
    const summary = summarize(signals, rows.map((r) => Number(r.close)), horizons);

    const report = { symbol, interval, bars: rows.length, window, algorithm: impl.label, vanishedMarkers: vanished, summary };
    if (flags.has('json')) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    console.log(`${symbol} ${interval}: ${rows.length} bars, window=${window || 'full'}, vanished markers=${vanished}, algorithm=${impl.label}`);
    console.log('each cell: hit rate (base rate) / mean signed return');
    const pct = (x: number | null, digits: number) => (x === null ? '-' : (x * 100).toFixed(digits));
    for (const g of summary) {
        const cells = g.horizons
            .map((x) => `h${x.h}: ${pct(x.hitRate, 1)}% (${pct(x.baseRate, 1)}%) / ${x.meanPct === null ? '-' : x.meanPct.toFixed(2)}%`)
            .join('  ');
        console.log(`${g.group.padEnd(20)} n=${String(g.signals).padStart(4)}  ${cells}`);
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
