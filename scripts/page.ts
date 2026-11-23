// The HTML page the scripts write: candles with markers and line segments, plus any HTML above and below the chart.

export interface DrawMarker {
    /** Bar open time in seconds. */
    time: number;
    position: 'aboveBar' | 'belowBar';
    color: string;
    shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
    text: string;
}

export interface DrawLine {
    from: number;
    to: number;
    price: number;
    color: string;
    style: 0 | 2;
    width: 1 | 2;
}

export interface DrawCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export const COLOR = {
    buy: '#089981',
    sell: '#f23645',
    progress: '#787b86',
    countdown: '#b26a00',
    risk: '#9c27b0',
    added: '#2962ff',
    removed: '#ff9800',
    changed: '#2962ff'
};

export const PAGE_CSS = `
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:16px;color:#131722;background:#fff}
h1{font-size:18px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 4px}h3{font-size:14px;margin:14px 0 4px}.muted{color:#787b86}#chart{height:560px;margin:8px 0}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #e0e3eb;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f8f9fd;white-space:nowrap}tr.changed td{background:#fff8e1}tr.added td{color:${COLOR.added}}tr.removed td{color:${COLOR.removed}}tr.changed-marker td{color:${COLOR.changed}}
.ok{color:#089981}.bad{color:#f23645}.warn{color:#b26a00}td.num{text-align:right;font-variant-numeric:tabular-nums}`;

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** `headHtml` goes above the chart, `bodyHtml` below it; both are trusted HTML built by the caller. */
export function chartPage(page: {
    title: string;
    headHtml: string;
    bodyHtml: string;
    candles: DrawCandle[];
    markers: DrawMarker[];
    lines: DrawLine[];
}): string {
    const markers = [...page.markers].sort((a, b) => a.time - b.time);
    const data = JSON.stringify({ candles: page.candles, markers, lines: page.lines }).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<style>${PAGE_CSS}</style></head><body>
<h1>${escapeHtml(page.title)}</h1>
${page.headHtml}
<div id="chart"></div>
${page.bodyHtml}
<script type="application/json" id="data">${data}</script>
<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const el = document.getElementById('chart');
const chart = LightweightCharts.createChart(el, { autoSize: true, layout: { background: { color: '#ffffff' }, textColor: '#131722' },
  grid: { vertLines: { color: '#f0f3fa' }, horzLines: { color: '#f0f3fa' } }, timeScale: { timeVisible: true, secondsVisible: false } });
const candles = chart.addCandlestickSeries({ upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645' });
candles.setData(D.candles);
candles.setMarkers(D.markers);
for (const l of D.lines) {
  const s = chart.addLineSeries({ color: l.color, lineWidth: l.width, lineStyle: l.style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  s.setData([{ time: l.from, value: l.price }, { time: l.to, value: l.price }]);
}
chart.timeScale().fitContent();
</script>
</body></html>
`;
}
