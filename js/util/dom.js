// Minimal hyperscript + DOM helpers. No framework, no build step.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class' || key === 'className') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'ref' && typeof value === 'function') value(el);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Let input and paint run between chunks of non-urgent export work. */
export function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function replace(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export function svg(markup, className) {
  const wrap = document.createElement('span');
  wrap.innerHTML = markup.trim();
  const node = wrap.firstElementChild;
  if (className && node) node.setAttribute('class', className);
  return node;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Mar" / "12 Mar 2024" for dates outside the current year. */
export function fmtDate(dateKey, { long = false } = {}) {
  if (!dateKey) return '';
  const [y, m, d] = String(dateKey).split('-').map(Number);
  if (!y) return dateKey;
  const thisYear = new Date().getFullYear();
  const base = `${d} ${MONTHS[(m || 1) - 1]}`;
  return long || y !== thisYear ? `${base} ${y}` : base;
}

export function fmtDateLong(dateKey) {
  return fmtDate(dateKey, { long: true });
}

export function relativeDay(dateKey) {
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const key = (dt) => `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  if (dateKey === key(today)) return 'Today';
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (dateKey === key(y)) return 'Yesterday';
  return fmtDate(dateKey);
}

/** Format a list as "A, B and C". */
export function listNames(names, max = 3) {
  if (!names.length) return 'nobody';
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
