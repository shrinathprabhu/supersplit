// Charts, drawn with Apache ECharts (vendored in /vendor so the app still
// works offline). The library is fetched the first time a chart is needed,
// which keeps it out of the initial load.
//
// Tooltips are a bonus, not the only way to read a chart: the legend and the
// figures under each chart always spell the numbers out.

import { h, clear, fmtDate } from '../util/dom.js';
import { fmt, currency as curInfo } from '../core/money.js';

export const CHART_COLORS = ['#7C5CFF', '#37D6C3', '#FF5FA2', '#FFB53D', '#5BA8FF', '#C4F04B', '#FF7A5C', '#B77BFF'];

const FONT = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
const INK = '#f5f3ff';
const MUTED = '#8b83ad';
const GRID = 'rgba(255,255,255,0.07)';

const live = new Set();
let loader = null;

function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../../vendor/echarts.common.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => resolve(window.echarts);
      script.onerror = () => reject(new Error('Charts could not be loaded'));
      document.head.appendChild(script);
    }).catch((err) => {
      loader = null;
      throw err;
    });
  }
  return loader;
}

/** Drop instances whose element has left the page. */
export function disposeCharts() {
  for (const entry of [...live]) {
    if (entry.node.isConnected) continue;
    entry.observer?.disconnect();
    entry.chart.dispose();
    live.delete(entry);
  }
}

/** Short money for axis ticks: ₹5k rather than ₹5,000.00. */
function tick(minor, code) {
  const c = curInfo(code);
  const sym = c.symbol.trim();
  const major = Math.abs(minor) / Math.pow(10, c.decimals);
  const sign = minor < 0 ? '-' : '';
  const round = (n) => String(Math.round(n * 10) / 10);
  if (major >= 1000000) return sign + sym + round(major / 1000000) + 'M';
  if (major >= 1000) return sign + sym + round(major / 1000) + 'k';
  return sign + sym + String(Math.round(major));
}

const tooltipStyle = {
  backgroundColor: '#221d40',
  borderColor: 'rgba(255,255,255,0.18)',
  borderWidth: 1,
  padding: [9, 12],
  extraCssText: 'border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.5);',
  textStyle: { color: INK, fontSize: 12, fontFamily: FONT },
};

function mount(box, build, height) {
  box.style.height = height + 'px';
  loadECharts()
    .then((echarts) => {
      if (!box.isConnected) return;
      const chart = echarts.init(box, null, { renderer: 'canvas' });
      chart.setOption(build(echarts));
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(box);
      live.add({ node: box, chart, observer });
      disposeCharts();
    })
    .catch(() => {
      clear(box);
      box.style.height = 'auto';
      box.appendChild(h('div', { class: 'tiny muted', style: { padding: '18px 0' }, text: 'Chart unavailable. The figures below still add up.' }));
    });
  return box;
}

/**
 * lineChart({ points: [{date, values:[n, n]}], series: [{name, color}] })
 * Values are integer minor units.
 */
export function lineChart({ points, series, currency, height = 190 }) {
  const box = h('div', { style: { width: '100%' } });
  const labels = points.map((p) => fmtDate(p.date));
  // A line through one or two points is not a line, so short spans are drawn
  // as bars instead of leaving a stray dot floating in the grid.
  const asBars = points.length <= 3;

  return mount(
    box,
    (echarts) => ({
      animationDuration: 420,
      grid: { left: 4, right: 10, top: 16, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle,
        axisPointer: asBars
          ? { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } }
          : { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1 } },
        formatter: (rows) => {
          const head = `<div style="font-weight:600;margin-bottom:4px">${rows[0].axisValueLabel}</div>`;
          const body = rows
            .map(
              (r) =>
                `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">` +
                `<span style="color:${MUTED}">${r.marker}${r.seriesName}</span>` +
                `<b>${fmt(r.value, currency)}</b></div>`,
            )
            .join('');
          return head + body;
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: asBars,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
        axisLabel: { color: MUTED, fontSize: 10.5, fontFamily: FONT, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { color: MUTED, fontSize: 10.5, fontFamily: FONT, formatter: (v) => tick(v, currency) },
      },
      series: series.map((s, i) =>
        asBars
          ? {
              name: s.name,
              type: 'bar',
              barMaxWidth: 46,
              barGap: '18%',
              itemStyle: { color: s.color, borderRadius: [6, 6, 2, 2] },
              emphasis: { focus: 'series' },
              data: points.map((p) => p.values[i]),
            }
          : {
              name: s.name,
              type: 'line',
              smooth: 0.2,
              symbol: 'circle',
              symbolSize: 6,
              showSymbol: points.length <= 20,
              lineStyle: { width: i === 0 ? 2.4 : 1.8, color: s.color, type: i === 0 ? 'solid' : 'dashed' },
              itemStyle: { color: s.color, borderColor: '#0f0d1a', borderWidth: 1.5 },
              emphasis: { focus: 'series', scale: 1.4 },
              areaStyle:
                i === 0
                  ? {
                      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: withAlpha(s.color, 0.34) },
                        { offset: 1, color: withAlpha(s.color, 0) },
                      ]),
                    }
                  : undefined,
              data: points.map((p) => p.values[i]),
            },
      ),
    }),
    height,
  );
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Coloured key with the totals spelled out. */
export function chartLegend(items, currency) {
  return h(
    'div',
    { class: 'legend' },
    items.map((item) =>
      h(
        'div',
        { class: 'legend__item' },
        h('span', { class: 'legend__dot', style: { background: item.color } }),
        h('span', { class: 'legend__name ellipsis', text: item.name }),
        h('b', { class: 'num', text: fmt(item.value, currency) }),
      ),
    ),
  );
}

/** Doughnut plus the full key, so every slice has its number on the page. */
export function donutChart({ slices, currency, size = 168 }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const box = h('div', { style: { width: size + 'px', flex: 'none' } });

  mount(
    box,
    () => ({
      animationDuration: 420,
      tooltip: {
        trigger: 'item',
        ...tooltipStyle,
        formatter: (p) =>
          `<div style="font-weight:600;margin-bottom:2px">${p.name}</div>` +
          `<div><b>${fmt(p.value, currency)}</b> <span style="color:${MUTED}">${p.percent}%</span></div>`,
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '88%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: '#16132a', borderWidth: 2 },
          emphasis: { scale: true, scaleSize: 4 },
          data: slices.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
        },
      ],
    }),
    size,
  );

  return h(
    'div',
    { class: 'donut' },
    box,
    h(
      'div',
      { class: 'legend grow' },
      slices.map((slice) =>
        h(
          'div',
          { class: 'legend__item' },
          h('span', { class: 'legend__dot', style: { background: slice.color } }),
          h('span', { class: 'legend__name ellipsis', text: slice.name }),
          h('b', { class: 'num', text: fmt(slice.value, currency) }),
          h('span', { class: 'legend__pct num', text: total ? Math.round((slice.value / total) * 100) + '%' : '0%' }),
        ),
      ),
    ),
  );
}

/** A row of plain figures under a chart. */
export function statRow(stats) {
  return h(
    'div',
    { class: 'statrow' },
    stats.map((s) => h('div', { class: 'statrow__cell' }, h('div', { class: 'tiny muted', text: s.label }), h('b', { class: 'num', text: s.value }))),
  );
}
