// App chrome: bottom sheets (with real back-button support), toasts and
// confirm dialogs.

import { h, clear } from '../util/dom.js';
import { icon } from './icons.js';

const stack = [];
let toaster = null;

// ----------------------------------------------------------------- toasts

export function toast(message, kind = '') {
  if (!toaster) {
    toaster = h('div', { class: 'toaster' });
    document.body.appendChild(toaster);
  }
  const node = h('div', { class: 'toast' + (kind ? ' toast--' + kind : ''), text: message });
  toaster.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease, transform .25s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, kind === 'bad' ? 3200 : 2100);
}

// ----------------------------------------------------------------- sheets

export function baseHistoryState() {
  // Every route render resets the depth so sheets never leak across screens.
  history.replaceState({ ssDepth: 0 }, '');
}

function lockScroll(on) {
  document.body.style.overflow = on ? 'hidden' : '';
}

/** Tear down one sheet's DOM. History has already moved by this point. */
function dismiss(entry) {
  entry.sheet.classList.remove('sheet--in');
  entry.scrim.classList.remove('scrim--in');
  setTimeout(() => {
    entry.sheet.remove();
    entry.scrim.remove();
    if (!stack.length) lockScroll(false);
  }, 260);
  entry.onClose?.();
}

/** Bring the visible stack in line with the history entry we landed on. */
function syncToDepth(depth) {
  while (stack.length > depth) dismiss(stack.pop());
}

window.addEventListener('popstate', () => {
  syncToDepth(history.state?.ssDepth ?? 0);
});

// Every sheet owns a history entry, so closing one is a back navigation and
// the DOM follows from popstate. Back navigations are queued: a close
// followed by a route change can otherwise race into the wrong entry.
let unwinding = Promise.resolve();

function goBack(steps) {
  unwinding = unwinding.then(
    () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener('popstate', finish);
          resolve();
        };
        window.addEventListener('popstate', finish);
        history.go(-steps);
        setTimeout(finish, 500); // in case popstate never arrives
      }),
  );
  return unwinding;
}

/** Close the top `count` sheets; resolves once history has caught up. */
function requestClose(count = 1) {
  const steps = Math.min(count, stack.length);
  if (steps <= 0) return unwinding;
  // Take them down straight away: a handler that closes one sheet and opens
  // another (detail -> edit) must not have the new sheet swallowed by the
  // back navigation still in flight.
  for (let i = 0; i < steps; i++) dismiss(stack.pop());
  return goBack(steps);
}

/**
 * openSheet({ title, full, render(ctx), footer(ctx), onClose })
 * `render` may return a Node or an array of Nodes; call ctx.refresh() to
 * re-run it in place.
 */
export function openSheet(options) {
  const { title, full = false, render, footer, onClose, subtitle } = options;

  const scrim = h('div', { class: 'scrim', onClick: () => ctx.close() });
  const body = h('div', { class: 'sheet__body' });
  const footNode = footer ? h('div', { class: 'sheet__foot' }) : null;

  const sheet = h(
    'div',
    { class: 'sheet' + (full ? ' sheet--full' : ''), role: 'dialog', 'aria-modal': 'true' },
    full ? null : h('div', { class: 'sheet__grab' }),
    h(
      'div',
      { class: 'sheet__head' },
      h(
        'div',
        { class: 'sheet__title' },
        title,
        subtitle ? h('div', { class: 'tiny muted', style: { fontWeight: '500' }, text: subtitle }) : null,
      ),
      h('button', { class: 'btn btn--icon', 'aria-label': 'Close', onClick: () => ctx.close() }, icon('close', 20)),
    ),
    body,
    footNode,
  );

  const ctx = {
    sheet,
    body,
    footer: footNode,
    close: () => {
      const idx = stack.findIndex((e) => e.sheet === sheet);
      if (idx >= 0) requestClose(stack.length - idx);
    },
    refresh: () => {
      clear(body);
      appendAll(body, render(ctx));
      if (footNode) {
        clear(footNode);
        appendAll(footNode, footer(ctx));
      }
    },
  };

  appendAll(body, render(ctx));
  if (footNode) appendAll(footNode, footer(ctx));

  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  lockScroll(true);
  requestAnimationFrame(() => {
    scrim.classList.add('scrim--in');
    sheet.classList.add('sheet--in');
  });

  stack.push({ sheet, scrim, onClose });
  history.pushState({ ssDepth: stack.length }, '');
  return ctx;
}

function appendAll(parent, content) {
  if (!content) return;
  const list = Array.isArray(content) ? content : [content];
  for (const node of list) if (node) parent.appendChild(node);
}

/** Close every open sheet; resolves once history has caught up. */
export function closeAllSheets() {
  return requestClose(stack.length);
}

// --------------------------------------------------------------- dialogs

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const ctx = openSheet({
      title,
      render: () => h('p', { class: 'dim', style: { margin: '2px 0 4px' }, text: message }),
      footer: () => [
        h('button', { class: 'btn btn--ghost grow', onClick: () => { finish(false); ctx.close(); } }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn grow ' + (danger ? 'btn--danger' : 'btn--primary'),
            onClick: () => { finish(true); ctx.close(); },
          },
          confirmLabel,
        ),
      ],
      onClose: () => finish(false),
    });
  });
}

/** Simple single-field prompt. */
export function promptSheet({ title, label, value = '', placeholder = '', confirmLabel = 'Save', inputMode }) {
  return new Promise((resolve) => {
    let settled = false;
    let input;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      finish(v);
      ctx.close();
    };
    const ctx = openSheet({
      title,
      render: () =>
        h(
          'label',
          { class: 'field' },
          label ? h('span', { class: 'field__label', text: label }) : null,
          (input = h('input', {
            class: 'input',
            value,
            placeholder,
            inputmode: inputMode,
            onKeydown: (e) => {
              if (e.key === 'Enter') submit();
            },
          })),
        ),
      footer: () => [h('button', { class: 'btn btn--primary btn--block', onClick: submit }, confirmLabel)],
      onClose: () => finish(null),
    });
    setTimeout(() => input?.focus(), 260);
  });
}

/** A list of choices; resolves with the chosen value (or null). */
export function chooseSheet({ title, options, selected }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const ctx = openSheet({
      title,
      render: () =>
        h(
          'div',
          { class: 'list' },
          options.map((opt) =>
            h(
              'button',
              {
                class: 'list__item',
                onClick: () => { finish(opt.value); ctx.close(); },
              },
              opt.icon ? icon(opt.icon, 20) : null,
              h('div', { class: 'grow' }, h('div', { text: opt.label }), opt.hint ? h('div', { class: 'tiny muted', text: opt.hint }) : null),
              opt.value === selected ? icon('check', 18) : null,
            ),
          ),
        ),
      onClose: () => finish(null),
    });
  });
}
