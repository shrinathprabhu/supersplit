// Small reusable pieces shared across screens.

import { h, svg } from '../util/dom.js';
import { avatarSvg } from '../core/avatar.js';
import { currency as cur, toDecimalString, parseAmount, parseNumber } from '../core/money.js';
import { icon } from './icons.js';

export function avatarNode(member, size = 36, opts = {}) {
  if (!member) {
    return h('div', {
      class: 'avatar',
      style: { width: size + 'px', height: size + 'px', display: 'grid', placeItems: 'center', fontSize: size * 0.36 + 'px', fontWeight: '700', color: 'var(--muted)' },
      text: '?',
    });
  }
  const node = h(
    'div',
    { class: 'avatar' + (opts.ring ? ' avatar--ring' : ''), style: { width: size + 'px', height: size + 'px' }, title: member.name },
    svg(avatarSvg(member.avatarSeed || member.name, size)),
  );
  return node;
}

export function avatarStack(members, max = 4, size = 28) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return h(
    'div',
    { class: 'avatar-stack' },
    shown.map((m) => avatarNode(m, size)),
    rest > 0 ? h('div', { class: 'avatar-more', style: { height: size + 'px', minWidth: size + 'px' }, text: '+' + rest }) : null,
  );
}

/**
 * Keep a numeric field to digits and one decimal point. Extra decimal places
 * remain visible while typing and are rounded when the field is committed.
 * A pasted negative is rejected instead of silently turning positive.
 */
function sanitiseNumeric(raw) {
  const text = String(raw ?? '');
  const minus = text.search(/[-−]/);
  const firstDigit = text.search(/\d/);
  if (minus >= 0 && (firstDigit < 0 || minus < firstDigit)) return '';

  let body = text.replace(/[^\d.]/g, '');
  const dot = body.indexOf('.');
  if (dot >= 0) {
    body = body.slice(0, dot + 1) + body.slice(dot + 1).replace(/\./g, '');
  }
  return body;
}

/** Clean the field in place, leaving the caret where the typing left off. */
function guardNumeric(input) {
  const clean = () => {
    const before = input.value;
    const after = sanitiseNumeric(before);
    if (after === before) return;
    const caret = input.selectionStart ?? before.length;
    const kept = sanitiseNumeric(before.slice(0, caret)).length;
    input.value = after;
    try {
      input.setSelectionRange(kept, kept);
    } catch {
      /* some input types refuse a selection range */
    }
  };
  input.addEventListener('input', clean);
  input.addEventListener('paste', () => setTimeout(clean));
  return clean;
}

/**
 * Money input bound to integer minor units.
 * onChange receives (minorUnits|null, rawString).
 */
export function moneyInput({
  currency,
  value,
  onChange,
  size = 'md',
  placeholder = '0',
  autofocus = false,
  bare = false,
}) {
  const c = cur(currency);
  const input = h('input', {
    type: 'text',
    inputmode: c.decimals ? 'decimal' : 'numeric',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder,
    value: value === null || value === undefined || value === 0 ? '' : toDecimalString(value, currency),
    onBlur: () => {
      const parsed = parseAmount(input.value, currency);
      input.value = parsed !== null && parsed > 0 ? toDecimalString(parsed, currency) : '';
      onChange(parsed !== null && parsed > 0 ? parsed : null, input.value);
    },
  });
  // Attached before the change handler so onChange only ever sees a value
  // that has already been cleaned.
  guardNumeric(input);
  input.addEventListener('input', () => onChange(parseAmount(input.value, currency), input.value));
  if (autofocus) setTimeout(() => input.focus(), 300);
  const wrap = h(
    'div',
    { class: `input-money${size === 'big' ? ' input-money--big' : ''}${size === 'sm' ? ' input-money--sm' : ''}` },
    // Inside a split row the currency is obvious, and the symbol costs space.
    bare ? null : h('span', { class: 'input-money__sym', text: c.symbol.trim() }),
    input,
  );
  wrap.input = input;
  return wrap;
}

/** Plain numeric input (percent / share weights). */
export function numberInput({ value, onChange, suffix = '', placeholder = '0', decimals = 2 }) {
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder,
    value: value === null || value === undefined || value === 0 ? '' : String(value),
    onBlur: () => {
      const parsed = parseNumber(input.value);
      if (parsed === null || parsed <= 0) {
        input.value = '';
        onChange(null, input.value);
        return;
      }
      const factor = Math.pow(10, decimals);
      const rounded = roundForInput(parsed, factor);
      input.value = String(rounded);
      onChange(rounded, input.value);
    },
  });
  guardNumeric(input);
  input.addEventListener('input', () => onChange(parseNumber(input.value), input.value));
  const wrap = h(
    'div',
    { class: 'input-money input-money--sm' },
    input,
    suffix ? h('span', { class: 'input-money__sym', text: suffix }) : null,
  );
  wrap.input = input;
  return wrap;
}

function roundForInput(value, factor) {
  // The small relative epsilon keeps decimal ties such as 1.005 on the
  // expected half-up side despite binary floating-point representation.
  return Math.round((value + Number.EPSILON * Math.max(1, value)) * factor) / factor;
}

export function segmented(options, value, onChange, opts = {}) {
  // The selection is tracked on the control itself. Reading it from the
  // argument would freeze it at whatever was selected when it was built, so
  // switching back to the first option would do nothing.
  let current = value;
  const node = h(
    'div',
    { class: 'segment' + (opts.small ? ' segment--sm' : ''), role: 'tablist' },
    options.map((opt) =>
      h(
        'button',
        {
          role: 'tab',
          'aria-selected': String(opt.value === value),
          dataset: { value: opt.value },
          onClick: () => {
            if (opt.value === current) return;
            node.setValue(opt.value);
            onChange(opt.value);
          },
        },
        opt.label,
      ),
    ),
  );
  node.setValue = (v) => {
    current = v;
    for (const b of node.querySelectorAll('button')) {
      b.setAttribute('aria-selected', String(b.dataset.value === v));
    }
  };
  return node;
}

export function checkbox(checked, onToggle) {
  const btn = h('button', { class: 'split-check', 'aria-pressed': String(!!checked), onClick: () => onToggle(btn.getAttribute('aria-pressed') !== 'true') }, icon('check', 13));
  return btn;
}

export function emptyState({ iconName = 'receipt', title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    icon(iconName, 66),
    h('h3', { text: title }),
    text ? h('p', { text }) : null,
    action ? h('div', { style: { marginTop: '16px' } }, action) : null,
  );
}

export function pill(text, kind = '') {
  return h('span', { class: 'pill' + (kind ? ' pill--' + kind : ''), text });
}
