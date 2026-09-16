// Native SVG charts: no large charting runtime, no per-frame JS animations.
// Heights are reserved before rendering; offscreen charts wait until needed.
// The legends and printed summaries remain the canonical accounting values.

import { h, clear, fmtDate } from '../util/dom.js';
import { fmt, currency as curInfo } from '../core/money.js';

export const CHART_COLORS = ['#7C5CFF', '#37D6C3', '#FF5FA2', '#FFB53D', '#5BA8FF', '#C4F04B', '#FF7A5C', '#B77BFF'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const MUTED = '#8b83ad';
const GRID = 'rgba(255,255,255,0.08)';
const live = new Set();
let chartId = 0;

function svgNode(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child) node.appendChild(child);
  return node;
}

export function disposeCharts() {
  for (const entry of [...live]) {
    if (entry.node.isConnected) continue;
    entry.intersection?.disconnect();
    entry.resize?.disconnect();
    if (entry.raf) cancelAnimationFrame(entry.raf);
    live.delete(entry);
  }
}

function mount(box, draw, height, label) {
  box.className = 'chart';
  box.style.height = `${height}px`;
  box.tabIndex = 0;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  const stage = h('div', { class: 'chart__stage', 'aria-hidden': 'true' });
  box.appendChild(stage);
  const entry = { node: box, intersection: null, resize: null, raf: 0, started: false, width: 0 };
  live.add(entry);

  const schedule = () => {
    if (!box.isConnected || entry.raf) return;
    entry.raf = requestAnimationFrame(() => {
      entry.raf = 0;
      if (!box.isConnected) return;
      const width = Math.max(240, Math.round(box.getBoundingClientRect().width));
      if (width === entry.width) return;
      entry.width = width;
      try {
        draw(stage, width, height, box);
      } catch (err) {
        console.warn('Chart could not be rendered:', err);
        clear(stage);
        stage.appendChild(h('div', {
          class: 'tiny muted',
          style: { height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '18px' },
          text: 'Chart unavailable. The figures below still add up.',
        }));
      }
      box.classList.add('chart--ready');
    });
  };

  const start = () => {
    if (entry.started) return;
    entry.started = true;
    entry.intersection?.disconnect();
    schedule();
    if ('ResizeObserver' in window) {
      entry.resize = new ResizeObserver(schedule);
      entry.resize.observe(box);
    }
  };
  if ('IntersectionObserver' in window) {
    entry.intersection = new IntersectionObserver((entries) => {
      if (entries.some((item) => item.isIntersecting)) start();
    }, { rootMargin: '160px 0px' });
    entry.intersection.observe(box);
  } else requestAnimationFrame(start);
  return box;
}

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

function maxValue(points) {
  let max = 0;
  for (const point of points) for (const value of point.values) if (value > max) max = value;
  return max || 1;
}

function labelIndexes(length, width) {
  if (length <= 1) return [0];
  const wanted = width < 380 ? 2 : width < 620 ? 3 : 4;
  const count = Math.min(wanted, length);
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - 1)) / (count - 1)));
}

/** Daily lines, or grouped bars for spans of three days or fewer. */
export function lineChart({ points, series, currency, height = 190 }) {
  const box = h('div');
  if (!points.length) return box;
  const label = `Daily spend chart. ${points.length} ${points.length === 1 ? 'day' : 'days'}, ${series.map((item) => item.name).join(' and ')}. Focus and use the arrow keys to inspect values.`;
  return mount(box, (stage, width, chartHeight, host) => {
    clear(stage);
    for (const tip of host.querySelectorAll('.chart__tooltip')) tip.remove();
    const left = width < 380 ? 48 : 58;
    const right = 10;
    const top = 12;
    const plotW = width - left - right;
    const plotH = chartHeight - top - 27;
    const max = maxValue(points);
    const asBars = points.length <= 3;
    const xAt = (index) => left + (asBars ? ((index + 0.5) * plotW) / points.length : (index * plotW) / (points.length - 1));
    const yAt = (value) => top + plotH - (Math.max(0, value) / max) * plotH;
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${chartHeight}`, preserveAspectRatio: 'none' });

    for (let i = 0; i <= 4; i++) {
      const y = top + (i * plotH) / 4;
      svg.appendChild(svgNode('line', { x1: left, y1: y, x2: width - right, y2: y, stroke: GRID, 'stroke-width': 1 }));
      svg.appendChild(svgNode('text', { x: left - 7, y: y + 3.5, fill: MUTED, 'font-size': 10.5, 'text-anchor': 'end', text: tick((max * (4 - i)) / 4, currency) }));
    }
    for (const index of labelIndexes(points.length, width)) {
      svg.appendChild(svgNode('text', {
        x: xAt(index), y: chartHeight - 5, fill: MUTED, 'font-size': 10.5,
        'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle',
        text: fmtDate(points[index].date),
      }));
    }

    if (!asBars) {
      const id = `chart-gradient-${++chartId}`;
      svg.appendChild(svgNode('defs', {}, svgNode('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' },
        svgNode('stop', { offset: '0%', 'stop-color': series[0].color, 'stop-opacity': 0.32 }),
        svgNode('stop', { offset: '100%', 'stop-color': series[0].color, 'stop-opacity': 0 }),
      )));
      const areaPoints = points.map((point, i) => `${xAt(i)},${yAt(point.values[0] || 0)}`).join(' ');
      svg.appendChild(svgNode('polygon', { points: `${left},${top + plotH} ${areaPoints} ${width - right},${top + plotH}`, fill: `url(#${id})` }));
    }
    series.forEach((item, seriesIndex) => {
      if (asBars) {
        const groupW = Math.min(58, (plotW / points.length) * 0.7);
        const barW = Math.max(4, groupW / series.length - 2);
        points.forEach((point, i) => {
          const value = point.values[seriesIndex] || 0;
          const y = yAt(value);
          svg.appendChild(svgNode('rect', {
            x: xAt(i) - groupW / 2 + seriesIndex * (barW + 2), y, width: barW,
            height: Math.max(1, top + plotH - y), rx: 4, fill: item.color,
          }, svgNode('title', { text: `${fmtDate(point.date)} · ${item.name}: ${fmt(value, currency)}` })));
        });
      } else {
        const path = points.map((point, i) => `${i ? 'L' : 'M'} ${xAt(i)} ${yAt(point.values[seriesIndex] || 0)}`).join(' ');
        svg.appendChild(svgNode('path', {
          d: path, fill: 'none', stroke: item.color,
          'stroke-width': seriesIndex === 0 ? 2.4 : 1.8,
          'stroke-dasharray': seriesIndex === 0 ? null : '6 5',
          'vector-effect': 'non-scaling-stroke',
        }));
      }
    });

    const marker = svgNode('line', { x1: left, y1: top, x2: left, y2: top + plotH, stroke: 'rgba(255,255,255,0.32)', 'stroke-width': 1, display: 'none' });
    svg.appendChild(marker);
    stage.appendChild(svg);
    const tip = h('div', { class: 'chart__tooltip', role: 'status', 'aria-live': 'polite' });
    host.appendChild(tip);
    let selected = points.length - 1;
    let shown = -1;
    const select = (index) => {
      selected = Math.max(0, Math.min(points.length - 1, index));
      if (selected === shown) return;
      shown = selected;
      marker.setAttribute('x1', xAt(selected));
      marker.setAttribute('x2', xAt(selected));
      marker.removeAttribute('display');
      clear(tip);
      tip.appendChild(h('b', { text: fmtDate(points[selected].date) }));
      series.forEach((item, i) => tip.appendChild(h('div', { class: 'chart__tooltip-row' },
        h('span', { class: 'muted', text: item.name }),
        h('b', { class: 'num', text: fmt(points[selected].values[i] || 0, currency) }),
      )));
      tip.classList.add('chart__tooltip--in');
    };
    const hide = () => {
      shown = -1;
      marker.setAttribute('display', 'none');
      tip.classList.remove('chart__tooltip--in');
    };
    svg.addEventListener('pointermove', (event) => {
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - (left / width) * rect.width) / ((plotW / width) * rect.width)));
      select(asBars ? Math.min(points.length - 1, Math.floor(ratio * points.length)) : Math.round(ratio * (points.length - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    host.onfocus = () => select(selected);
    host.onblur = hide;
    host.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') hide();
      else if (event.key === 'Home') select(0);
      else if (event.key === 'End') select(points.length - 1);
      else select(selected + (event.key === 'ArrowRight' ? 1 : -1));
    };
  }, height, label);
}

export function chartLegend(items, currency) {
  return h('div', { class: 'legend' }, items.map((item) => h('div', { class: 'legend__item' },
    h('span', { class: 'legend__dot', style: { background: item.color } }),
    h('span', { class: 'legend__name ellipsis', text: item.name }),
    h('b', { class: 'num', text: fmt(item.value, currency) }),
  )));
}

export function donutChart({ slices, currency, size = 168 }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const box = h('div', { style: { width: `${size}px`, flex: 'none' } });
  mount(box, (stage) => {
    clear(stage);
    const center = size / 2;
    const radius = size * 0.35;
    const svg = svgNode('svg', { viewBox: `0 0 ${size} ${size}` });
    svg.appendChild(svgNode('circle', { cx: center, cy: center, r: radius, fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': size * 0.21 }));
    let offset = 0;
    slices.forEach((slice) => {
      const pct = total ? (slice.value / total) * 100 : 0;
      svg.appendChild(svgNode('circle', {
        cx: center, cy: center, r: radius, fill: 'none', stroke: slice.color,
        'stroke-width': size * 0.21, 'stroke-dasharray': `${pct} ${100 - pct}`,
        'stroke-dashoffset': -offset, 'stroke-linecap': 'butt', pathLength: 100,
        transform: `rotate(-90 ${center} ${center})`,
      }, svgNode('title', { text: `${slice.name}: ${fmt(slice.value, currency)} (${Math.round(pct)}%)` })));
      offset += pct;
    });
    stage.appendChild(svg);
  }, size, `Spending breakdown. ${slices.map((slice) => `${slice.name}: ${fmt(slice.value, currency)}`).join(', ')}.`);
  return h('div', { class: 'donut' }, box, h('div', { class: 'legend grow' }, slices.map((slice) => h('div', { class: 'legend__item' },
    h('span', { class: 'legend__dot', style: { background: slice.color } }),
    h('span', { class: 'legend__name ellipsis', text: slice.name }),
    h('b', { class: 'num', text: fmt(slice.value, currency) }),
    h('span', { class: 'legend__pct num', text: total ? `${Math.round((slice.value / total) * 100)}%` : '0%'}),
  ))));
}

export function statRow(stats) {
  return h('div', { class: 'statrow' }, stats.map((item) => h('div', { class: 'statrow__cell' },
    h('div', { class: 'tiny muted', text: item.label }), h('b', { class: 'num', text: item.value }),
  )));
}
