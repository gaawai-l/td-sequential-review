// The algorithm entry points the scripts call, from the working tree or from any git commit, so a script can run
// the current code and an older version (e.g. the `baseline` tag) side by side.

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { INTERVAL_MS, KlineRow } from '../src/services/manager/demark/binance-klines';
import * as chart from '../src/services/manager/demark/chart';
import * as engine from '../src/services/manager/demark/engine';
import * as fixedDecimal from '../src/services/manager/demark/fixed-decimal';
import * as service from '../src/services/manager/demark/demark-service';
import * as summary from '../src/services/manager/demark/summary';
import { INSIGHT_INTERVALS, InsightInterval, InsightSnapshot } from '../src/services/manager/types/insight-types';
import * as template from '../src/services/sync/signal-insight/insight-template';
import * as text from '../src/services/sync/signal-insight/insight-text';
import * as snapshot from '../src/services/sync/signal-insight/snapshot';
import { SIGNAL_SYMBOLS, SignalSymbol } from '../src/services/sync/signal-push/symbols';
import { downloadKlines, readKlineFile, toLoaded } from './klines-file';

export interface Impl {
    label: string;
    buildChart: typeof service.buildChart;
    evaluateSequential: typeof engine.evaluateSequential;
    scaleRows: typeof fixedDecimal.scaleRows;
    projectChart: typeof chart.projectChart;
    analyzeWindow: typeof summary.analyzeWindow;
    assembleSnapshot: typeof snapshot.assembleSnapshot;
    templateSections: typeof template.templateSections;
    conclusionClauses: typeof text.conclusionClauses;
}

export const CURRENT: Impl = {
    label: 'working tree',
    buildChart: service.buildChart,
    evaluateSequential: engine.evaluateSequential,
    scaleRows: fixedDecimal.scaleRows,
    projectChart: chart.projectChart,
    analyzeWindow: summary.analyzeWindow,
    assembleSnapshot: snapshot.assembleSnapshot,
    templateSections: template.templateSections,
    conclusionClauses: text.conclusionClauses
};

/** `src/` as of `ref`, extracted under .view-baseline/<sha>/ (gitignored) and loaded next to this checkout's node_modules. */
export function implAt(ref: string): Impl {
    const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
    const dir = path.resolve('.view-baseline', sha);
    if (!existsSync(path.join(dir, 'src'))) {
        mkdirSync(dir, { recursive: true });
        const tar = execFileSync('git', ['archive', '--format=tar', sha, 'src'], { maxBuffer: 256 * 1024 * 1024 });
        execFileSync('tar', ['-x', '-C', dir], { input: tar });
    }
    const load = (rel: string) => require(path.join(dir, 'src', rel));
    return {
        label: `${ref} (${sha.slice(0, 8)})`,
        buildChart: load('services/manager/demark/demark-service').buildChart,
        evaluateSequential: load('services/manager/demark/engine').evaluateSequential,
        scaleRows: load('services/manager/demark/fixed-decimal').scaleRows,
        projectChart: load('services/manager/demark/chart').projectChart,
        analyzeWindow: load('services/manager/demark/summary').analyzeWindow,
        assembleSnapshot: load('services/sync/signal-insight/snapshot').assembleSnapshot,
        templateSections: load('services/sync/signal-insight/insight-template').templateSections,
        conclusionClauses: load('services/sync/signal-insight/insight-text').conclusionClauses
    };
}

export function signalSymbolOf(klineSymbol: string): SignalSymbol {
    return (
        SIGNAL_SYMBOLS.find((s) => s.klineSymbol === klineSymbol) ?? {
            klineSymbol,
            displayName: klineSymbol.replace(/USD[TC]$/, '')
        }
    );
}

/** Parses --at: epoch ms or an ISO time. */
export function parseAt(at: string): number {
    const ms = /^\d+$/.test(at) ? Number(at) : Date.parse(at);
    if (!Number.isFinite(ms)) {
        throw new Error(`--at ${at} is neither epoch ms nor an ISO time`);
    }
    return ms;
}

/** Bars closed by `atMs`, newest `limit` of them. */
export function closedBy<T extends { openTime: number }>(rows: readonly T[], interval: keyof typeof INTERVAL_MS, atMs: number, limit: number): T[] {
    return rows.filter((r) => r.openTime + INTERVAL_MS[interval] <= atMs).slice(-limit);
}

export const PANEL_WINDOW = 500;

/** The five windows the panel reads: live from Binance, or from data/ files as of `atMs`. */
export async function loadPanelRows(symbol: string, atMs: number | null): Promise<Record<InsightInterval, KlineRow[]>> {
    const out = {} as Record<InsightInterval, KlineRow[]>;
    for (const interval of INSIGHT_INTERVALS) {
        if (atMs === null) {
            out[interval] = toLoaded(await downloadKlines(symbol, interval, PANEL_WINDOW), `${symbol} ${interval}`).rows;
            continue;
        }
        const file = path.join('data', `${symbol}-${interval}.json`);
        if (!existsSync(file)) {
            throw new Error(`${file} is missing; run: npm run fetch-klines -- ${symbol} 5m,15m,1h,4h,1d 3000`);
        }
        const rows = closedBy(readKlineFile(file).rows, interval, atMs, PANEL_WINDOW);
        if (rows.length === 0) {
            throw new Error(`${file} has no bar closed by ${new Date(atMs).toISOString()}`);
        }
        out[interval] = rows;
    }
    return out;
}

export interface Panel {
    snapshot: InsightSnapshot;
    input: ReturnType<typeof snapshot.assembleSnapshot>['input'];
    /** The conclusion's clauses joined by the rule the LLM is told to follow. */
    conclusion: { zhCN: string; en: string };
    templates: ReturnType<typeof template.templateSections>;
}

export function buildPanel(impl: Impl, symbol: SignalSymbol, rows: Record<InsightInterval, KlineRow[]>): Panel {
    const windows = {} as Record<InsightInterval, summary.WindowAnalysis>;
    for (const interval of INSIGHT_INTERVALS) {
        windows[interval] = impl.analyzeWindow(rows[interval], interval);
    }
    const { snapshot: snap, input } = impl.assembleSnapshot(symbol, windows);
    const clauses = impl.conclusionClauses(input);
    return {
        snapshot: snap,
        input,
        conclusion: {
            zhCN: `${clauses.map((c) => c.zhCN).join('；')}。`,
            en: clauses.map((c) => `${c.en.charAt(0).toUpperCase()}${c.en.slice(1)}.`).join(' ')
        },
        templates: impl.templateSections(input.facts)
    };
}
