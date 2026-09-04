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
 * Money input bound to integer minor units.
 * onChange receives (minorUnits|null, rawString).
 */
export function moneyInput({ currency, value, onChange, size = 'md', placeholder = '0', autofocus = false, bare = false }) {
  const c = cur(currency);
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder,
    value: value === null || value === undefined || value === 0 ? '' : toDecimalString(value, currency),
    onInput: () => {
      const raw = input.value;
      onChange(parseAmount(raw, currency), raw);
    },
    onBlur: () => {
      const parsed = parseAmount(input.value, currency);
      if (parsed !== null) input.value = toDecimalString(parsed, currency);
    },
  });
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
export function numberInput({ value, onChange, suffix = '', placeholder = '0' }) {
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    placeholder,
    value: value === null || value === undefined || value === 0 ? '' : String(value),
    onInput: () => onChange(parseNumber(input.value), input.value),
  });
  const wrap = h(
    'div',
    { class: 'input-money input-money--sm' },
    input,
    suffix ? h('span', { class: 'input-money__sym', text: suffix }) : null,
  );
  wrap.input = input;
  return wrap;
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
