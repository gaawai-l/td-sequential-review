// Write an HTML page that draws the API's 9/13 markers and lines on the candles, with the AI trend panel below.
//
//   npm run view -- BTCUSDC 4h                          live, last 500 closed bars
//   npm run view -- BTCUSDC 4h --at 2026-11-10T08:00Z   from data/ files, as of a past moment
//   npm run view -- BTCUSDC 4h --compare baseline       overlay another git ref's output and list what changed
// Options: --limit 500|1000|1500, --out PATH, --llm (also ask the LLM in .env / the shell for the current version's
// conclusion, as the live service shows it; one request, up to 90 s). The page is written to data/view/ unless --out is given;
// it loads the chart library from unpkg, so open it with network access.

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { INTERVAL_MS, KlineRow, isDemarkInterval, isDemarkLimit } from '../src/services/manager/demark/binance-klines';
import { DemarkChartResponse, DemarkInterval, DemarkMarker } from '../src/services/manager/types/demark-types';
import { generateInsight, readInsightLlmConfig } from '../src/services/sync/signal-insight/llm-client';
import { loadDotEnv } from './env';
import { CURRENT, Impl, Panel, buildPanel, closedBy, implAt, loadPanelRows, parseAt, signalSymbolOf } from './impl';
import { downloadKlines, parseArgs, readKlineFile, toLoaded } from './klines-file';
import { COLOR, DrawLine, DrawMarker, chartPage, escapeHtml } from './page';

type Status = 'same' | 'added' | 'removed' | 'changed';

interface DiffRow {
    status: Exclude<Status, 'same'>;
    time: number;
    what: string;
}

const STATUS_TEXT: Record<Exclude<Status, 'same'>, string> = { added: '新增', removed: '消失', changed: '变化' };

/** Every field of the marker, so any change (a 9 losing perfection, a deferred count) counts as a difference. */
function markerKey(m: DemarkMarker): string {
    return JSON.stringify(m);
}

function markerText(m: DemarkMarker): string {
    return m.kind === 'setup9' && m.perfected ? '9 (perfected)' : m.label;
}

function toDraw(m: DemarkMarker, status: Status): DrawMarker {
    const strong = m.kind === 'countdown13' || (m.kind === 'setup9' && m.perfected);
    const sideColor =
        m.kind === 'setupProgress' ? COLOR.progress : m.kind === 'countdownProgress' ? COLOR.countdown : COLOR[m.side];
    return {
        time: m.time / 1000,
        position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: status === 'same' ? sideColor : COLOR[status],
        shape: strong ? (m.side === 'buy' ? 'arrowUp' : 'arrowDown') : m.kind === 'countdownProgress' ? 'square' : 'circle',
        // Progress counts get a prefix so a forming setup count and a running countdown count can't be confused.
        text: m.kind === 'setupProgress' ? `S${m.label}` : m.kind === 'countdownProgress' ? `C${m.label}` : m.label
    };
}

/** Line segments as the frontend draws them: TDST to its end (or the last bar), risk to the earlier of invalidation and 12 bars on. */
function segments(chart: DemarkChartResponse, step: number): { key: string; what: string; line: Omit<DrawLine, 'color' | 'style' | 'width'>; kind: 'tdst' | 'risk'; side: 'buy' | 'sell' }[] {
    const last = chart.lastClosedBarTime;
    const out: ReturnType<typeof segments> = [];
    for (const l of chart.tdstLines) {
        const to = Math.min(l.endTime ?? last, last);
        out.push({
            key: `tdst|${l.side}|${l.price}|${l.startTime}|${l.endTime}|${l.endReason}`,
            what: `TDST ${l.side} ${l.price} until ${l.endTime === null ? 'open' : `${new Date(l.endTime).toISOString()} (${l.endReason})`}`,
            line: { from: l.startTime / 1000, to: to / 1000, price: Number(l.price) },
            kind: 'tdst',
            side: l.side
        });
    }
    for (const l of chart.riskLines) {
        const to = Math.min(l.invalidatedTime ?? Number.POSITIVE_INFINITY, l.time + 12 * step, last);
        out.push({
            key: `risk|${l.side}|${l.price}|${l.time}|${l.invalidatedTime}`,
            what: `Risk ${l.side} ${l.price}${l.invalidatedTime === null ? '' : `, invalidated ${new Date(l.invalidatedTime).toISOString()}`}`,
            line: { from: l.time / 1000, to: to / 1000, price: Number(l.price) },
            kind: 'risk',
            side: l.side
        });
    }
    return out;
}

function diffChart(now: DemarkChartResponse, before: DemarkChartResponse | null, step: number) {
    const markers: DrawMarker[] = [];
    const lines: DrawLine[] = [];
    const diff: DiffRow[] = [];
    // A marker is the same one in both versions when bar, kind and side match; it changed when another field differs.
    const slot = (m: DemarkMarker) => `${m.time}|${m.kind}|${m.side}`;
    const oldBySlot = new Map((before?.markers ?? []).map((m) => [slot(m), m]));
    const newSlots = new Set(now.markers.map(slot));
    for (const m of now.markers) {
        const old = oldBySlot.get(slot(m));
        const status: Status =
            before === null ? 'same' : old === undefined ? 'added' : markerKey(old) === markerKey(m) ? 'same' : 'changed';
        markers.push(toDraw(m, status));
        if (status === 'added') diff.push({ status, time: m.time, what: `${m.kind} ${m.side} ${markerText(m)}` });
        if (status === 'changed' && old !== undefined) {
            diff.push({ status, time: m.time, what: `${m.kind} ${m.side} ${markerText(old)} → ${markerText(m)}` });
        }
    }
    for (const [key, m] of oldBySlot) {
        if (!newSlots.has(key)) {
            markers.push(toDraw(m, 'removed'));
            diff.push({ status: 'removed', time: m.time, what: `${m.kind} ${m.side} ${markerText(m)}` });
        }
    }
    const oldSegs = new Map((before === null ? [] : segments(before, step)).map((s) => [s.key, s]));
    const newSegs = segments(now, step);
    const newSegKeys = new Set(newSegs.map((s) => s.key));
    const style = (s: (typeof newSegs)[number], status: Status): DrawLine => ({
        ...s.line,
        color: status === 'same' ? (s.kind === 'risk' ? COLOR.risk : COLOR[s.side]) : COLOR[status],
        style: s.kind === 'tdst' ? 2 : 0,
        width: status === 'same' ? 1 : 2
    });
    for (const s of newSegs) {
        const status: Status = before === null || oldSegs.has(s.key) ? 'same' : 'added';
        lines.push(style(s, status));
        if (status === 'added') diff.push({ status, time: s.line.from * 1000, what: s.what });
    }
    for (const [key, s] of oldSegs) {
        if (!newSegKeys.has(key)) {
            lines.push(style(s, 'removed'));
            diff.push({ status: 'removed', time: s.line.from * 1000, what: s.what });
        }
    }
    diff.sort((a, b) => a.time - b.time || a.status.localeCompare(b.status));
    return { markers, lines: lines.filter((l) => l.to > l.from), diff };
}

export function panelFields(p: Panel): [string, string][] {
    const { card } = p.snapshot;
    const protection = card.protection
        ? `${card.protection.optionType} · ${card.protection.interval} · ${card.protection.durationSeconds / 3600}h` +
          (card.protection.stop ? ` · stop ${card.protection.stop.price} (${card.protection.stop.distancePct}%)` : ' · no stop')
        : '-';
    return [
        ['卡片', `${card.direction} · 强度 ${card.strength} (${card.strengthLabel}) · 锚 ${card.anchorInterval ?? '-'} · 同向 [${card.confluentIntervals.join(', ')}] · 反向 [${card.conflictingIntervals.join(', ')}]`],
        ['标题', `${card.phase.title.zhCN} / ${card.phase.title.en}`],
        ['保护', protection],
        ['结论', p.conclusion.zhCN],
        ['各周期', p.templates.zhCN.timeframes],
        ['复盘', p.templates.zhCN.review],
        ['关注', p.templates.zhCN.watch],
        ['Conclusion', p.conclusion.en],
        ['Timeframes', p.templates.en.timeframes],
        ['Review', p.templates.en.review],
        ['Watch', p.templates.en.watch]
    ];
}

function panelHtml(now: Panel | null, before: Panel | null, beforeLabel: string, panelError: string | null): string {
    if (now === null) {
        return `<p class="muted">AI 趋势面板未生成：${escapeHtml(panelError ?? '')}</p>`;
    }
    const nowFields = panelFields(now);
    const oldFields = before === null ? null : panelFields(before);
    const head = oldFields === null ? '<tr><th></th><th>当前</th></tr>' : `<tr><th></th><th>${escapeHtml(beforeLabel)}</th><th>当前</th></tr>`;
    const rows = nowFields
        .map(([name, value], i) => {
            const old = oldFields?.[i]?.[1];
            const changed = old !== undefined && old !== value;
            const cls = changed ? ' class="changed"' : '';
            return old === undefined
                ? `<tr><th>${name}</th><td>${escapeHtml(value)}</td></tr>`
                : `<tr${cls}><th>${name}</th><td>${escapeHtml(old)}</td><td>${escapeHtml(value)}</td></tr>`;
        })
        .join('\n');
    return `<p class="muted">as of ${new Date(now.snapshot.asOf).toISOString()}；结论为规则拼接版（线上由 LLM 按同样规则连句）。</p><table class="panel">${head}${rows}</table>`;
}

async function main(): Promise<void> {
    const { flags, positional } = parseArgs(process.argv.slice(2));
    const [symbol, interval] = positional;
    if (!symbol || !interval || !isDemarkInterval(interval)) {
        throw new Error('Usage: npm run view -- SYMBOL INTERVAL [--limit 500] [--at ISO|ms] [--compare REF] [--out PATH]');
    }
    const limit = Number(flags.get('limit') || 500);
    if (!isDemarkLimit(limit)) {
        throw new Error('--limit must be 500, 1000 or 1500');
    }
    const atRaw = flags.get('at');
    const atMs = atRaw === undefined ? null : parseAt(atRaw);
    const compareRef = flags.get('compare') ?? null;
    if (compareRef === '') {
        throw new Error('--compare needs a git ref, e.g. --compare baseline');
    }

    let rows: KlineRow[];
    let opens: Map<number, string>;
    if (atMs === null) {
        ({ rows, opens } = toLoaded(await downloadKlines(symbol, interval, limit), `${symbol} ${interval}`));
    } else {
        const file = path.join('data', `${symbol}-${interval}.json`);
        if (!existsSync(file)) {
            throw new Error(`${file} is missing; run: npm run fetch-klines -- ${symbol} ${interval} 3000`);
        }
        const loaded = readKlineFile(file);
        rows = closedBy(loaded.rows, interval, atMs, limit);
        opens = loaded.opens;
    }
    if (rows.length === 0) {
        throw new Error('No closed bars in the window');
    }

    const implBefore: Impl | null = compareRef === null ? null : implAt(compareRef);
    const chartNow = CURRENT.buildChart(symbol, interval as DemarkInterval, rows);
    const chartBefore = implBefore === null ? null : implBefore.buildChart(symbol, interval as DemarkInterval, rows);
    const step = INTERVAL_MS[interval];
    const { markers, lines, diff } = diffChart(chartNow, chartBefore, step);
    const count = (status: DiffRow['status']) => diff.filter((d) => d.status === status).length;

    let panelNow: Panel | null = null;
    let panelBefore: Panel | null = null;
    let panelError: string | null = null;
    try {
        // Live pages read the panel live too; --at pages read it from data/ as of the same moment.
        const panelRows = await loadPanelRows(symbol, atMs);
        const signalSymbol = signalSymbolOf(symbol);
        panelNow = buildPanel(CURRENT, signalSymbol, panelRows);
        panelBefore = implBefore === null ? null : buildPanel(implBefore, signalSymbol, panelRows);
    } catch (error) {
        panelError = error instanceof Error ? error.message : String(error);
    }

    let llmHtml = '';
    if (flags.has('llm') && panelNow !== null) {
        loadDotEnv();
        const config = readInsightLlmConfig(process.env, { info: () => undefined, error: (m) => console.error(m) });
        if (config === null) {
            llmHtml = '<p class="muted">--llm：没有配置 INSIGHT_LLM_BASE_URL / INSIGHT_LLM_API_KEY，跳过 LLM 结论。</p>';
            console.log('llm skipped: INSIGHT_LLM_BASE_URL / INSIGHT_LLM_API_KEY not set');
        } else {
            const result = await generateInsight(panelNow.input, config);
            llmHtml = result.ok
                ? `<h3>LLM 结论（当前版本，${escapeHtml(config.model)}）</h3><table class="panel"><tr><th>结论</th><td>${escapeHtml(result.sections.zhCN.conclusion)}</td></tr><tr><th>Conclusion</th><td>${escapeHtml(result.sections.en.conclusion)}</td></tr></table>`
                : `<p class="muted">LLM 结论生成失败：${escapeHtml(result.reason)}</p>`;
            console.log(result.ok ? 'llm: ok' : `llm failed: ${result.reason}`);
        }
    }

    const candles = rows.map((r, i) => {
        const prevClose = rows[i - 1]?.close ?? r.close;
        return {
            time: r.openTime / 1000,
            open: Number(opens.get(r.openTime) ?? prevClose),
            high: Number(r.high),
            low: Number(r.low),
            close: Number(r.close)
        };
    });
    const title = `${symbol} ${interval}`;
    const beforeLabel = implBefore?.label ?? '';
    const summary =
        implBefore === null
            ? `${chartNow.markers.length} 个标记，${chartNow.tdstLines.length} 条 TDST，${chartNow.riskLines.length} 条 Risk`
            : `对比 ${escapeHtml(beforeLabel)}：新增 ${count('added')}，消失 ${count('removed')}，变化 ${count('changed')}`;
    const diffTable =
        implBefore === null
            ? ''
            : diff.length === 0
              ? '<p>图表数据与对比版本完全相同。</p>'
              : `<table class="diff"><tr><th>K 线时间 (UTC)</th><th>变化</th><th>内容</th></tr>${diff
                    .map(
                        (d) =>
                            `<tr class="${d.status === 'changed' ? 'changed-marker' : d.status}"><td>${new Date(d.time).toISOString().replace('.000Z', 'Z')}</td><td>${STATUS_TEXT[d.status]}</td><td>${escapeHtml(d.what)}</td></tr>`
                    )
                    .join('')}</table>`;
    const legend =
        implBefore === null
            ? `<span style="color:${COLOR.buy}">■ buy</span> <span style="color:${COLOR.sell}">■ sell</span> <span style="color:${COLOR.progress}">● S1–S8 形成中的 Setup</span> <span style="color:${COLOR.countdown}">■ C1–C12 / C+ 进行中的 Countdown</span> <span style="color:${COLOR.risk}">— Risk</span> · 虚线 = TDST · 箭头 = perfected 9 / 13`
            : `<span style="color:${COLOR.added}">■ 当前版本新增或有变化</span> <span style="color:${COLOR.removed}">■ 只有 ${escapeHtml(beforeLabel)} 有</span> · 其余为两版相同`;

    const html = chartPage({
        title,
        headHtml: `<div class="muted">窗口 ${rows.length} 根已收盘 K 线，${new Date((rows[0] as KlineRow).openTime).toISOString()} .. ${new Date((rows[rows.length - 1] as KlineRow).openTime).toISOString()} · ${summary}</div>\n<div>${legend}</div>`,
        bodyHtml: `${diffTable}\n<h2>AI 趋势面板</h2>\n${panelHtml(panelNow, panelBefore, beforeLabel, panelError)}\n${llmHtml}`,
        candles,
        markers,
        lines
    });
    const suffix = `${atMs === null ? '' : `-at-${new Date(atMs).toISOString().replace(/[:.]/g, '')}`}${compareRef === null ? '' : `-vs-${compareRef.replace(/[^A-Za-z0-9._-]/g, '_')}`}`;
    const out = flags.get('out') || path.join('data', 'view', `${symbol}-${interval}${suffix}.html`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log(path.resolve(out));
    if (implBefore !== null) {
        console.log(`chart: ${count('added')} added, ${count('removed')} removed, ${count('changed')} changed vs ${beforeLabel}`);
        if (panelNow && panelBefore) {
            const changed = panelFields(panelNow).filter(([, v], i) => panelFields(panelBefore as Panel)[i]?.[1] !== v).map(([n]) => n);
            console.log(`panel: ${changed.length === 0 ? 'unchanged' : `changed ${changed.join(', ')}`}`);
        }
    }
    if (panelError !== null) {
        console.log(`panel skipped: ${panelError}`);
    }
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exit(1);
    });
}
