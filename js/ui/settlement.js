// The "Settle up" tab: who owes whom, why, and how to close it out.

import { h, clear, fmtDate } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmSheet } from './shell.js';
import { avatarNode, moneyInput, segmented } from './components.js';
import { fmt } from '../core/money.js';
import { explainSections } from '../core/balances.js';
import { addPayment, deletePayment, updateGroup } from '../core/store.js';
import { toDateKey } from '../core/split.js';
import { openShareSheet } from './share-sheet.js';

const MODE_NOTE = {
  simplified: 'Fewer payments. Balances are re-routed, so you may pay someone you never shared a bill with.',
  actual: 'Everyone pays back exactly whoever covered them.',
};

export function renderSettleTab(group, ledger, rerender) {
  const mode = group.simplify ? 'simplified' : 'actual';
  const debts = ledger.debts(mode);
  const code = group.currency;

  const root = h('div', { class: 'stack' });

  root.appendChild(
    h(
      'div',
      { class: 'stack stack--sm' },
      segmented(
        [
          { value: 'actual', label: 'Actual debts' },
          { value: 'simplified', label: 'Simplify debts' },
        ],
        mode,
        async (v) => {
          await updateGroup(group.id, { simplify: v === 'simplified' });
          rerender();
        },
      ),
      h('div', { class: 'tiny muted', style: { padding: '0 4px' }, text: MODE_NOTE[mode] }),
    ),
  );

  if (!debts.length) {
    root.appendChild(
      h(
        'div',
        { class: 'card center', style: { padding: '30px 20px' } },
        h('div', { style: { color: 'var(--good)', display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, icon('check', 44)),
        h('h3', { style: { margin: '0 0 6px' } }, 'All settled up'),
        h('p', { class: 'small muted', style: { margin: '0 0 16px' } }, ledger.expenses.length ? 'Nobody owes anybody anything.' : 'Add an expense to get started.'),
        ledger.expenses.length
          ? h(
              'button',
              { class: 'btn btn--quiet btn--sm', onClick: () => openShareSheet({ kind: 'summary', ledger, mode }) },
              icon('share', 16),
              'Share summary',
            )
          : null,
      ),
    );
  } else {
    root.appendChild(
      h(
        'div',
        { class: 'row row--between', style: { marginTop: '6px' } },
        h('div', { class: 'section-title', style: { margin: '0' }, text: `${debts.length} payment${debts.length > 1 ? 's' : ''} to go` }),
        h(
          'button',
          { class: 'btn btn--sm btn--quiet', onClick: () => openShareSheet({ kind: 'summary', ledger, mode }) },
          icon('share', 15),
          'Share',
        ),
      ),
    );
    const grid = h('div', { class: 'cards cards--wide' });
    for (const debt of debts) grid.appendChild(debtCard(group, ledger, debt, mode, rerender));
    root.appendChild(grid);
  }

  root.appendChild(
    h(
      'button',
      {
        class: 'btn btn--ghost btn--block',
        style: { marginTop: '6px' },
        onClick: () => openPaymentSheet({ group, ledger, rerender }),
      },
      icon('swap', 18),
      'Record a payment',
    ),
  );

  if (ledger.payments.length) {
    root.appendChild(h('div', { class: 'section-title', text: 'Settlements' }));
    root.appendChild(
      h(
        'div',
        { class: 'list' },
        ledger.payments.map((p) => {
          const from = group.members.find((m) => m.id === p.from);
          const to = group.members.find((m) => m.id === p.to);
          return h(
            'div',
            { class: 'list__item' },
            avatarNode(from, 30),
            h(
              'div',
              { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 'ellipsis', style: { fontWeight: '600' }, text: `${from?.name || '?'} → ${to?.name || '?'}` }),
              h('div', { class: 'tiny muted', text: fmtDate(p.date) + (p.note ? ' · ' + p.note : '') }),
            ),
            h('b', { class: 'num good', text: fmt(p.amount, code) }),
            h(
              'button',
              {
                class: 'btn btn--icon',
                'aria-label': 'Undo settlement',
                onClick: async () => {
                  const ok = await confirmSheet({
                    title: 'Undo this settlement?',
                    message: `${from?.name} → ${to?.name} for ${fmt(p.amount, code)} will be removed and the balance restored.`,
                    confirmLabel: 'Undo',
                    danger: true,
                  });
                  if (!ok) return;
                  await deletePayment(p.id);
                  toast('Settlement removed');
                  rerender();
                },
              },
              icon('undo', 17),
            ),
          );
        }),
      ),
    );
  }

  return root;
}

function debtCard(group, ledger, debt, mode, rerender) {
  const code = group.currency;
  const from = group.members.find((m) => m.id === debt.from);
  const to = group.members.find((m) => m.id === debt.to);
  const details = h('div', { class: 'breakdown', style: { display: 'none' } });
  let built = false;

  const toggle = h(
    'button',
    {
      class: 'btn btn--sm btn--quiet',
      onClick: () => {
        const open = details.style.display !== 'none';
        details.style.display = open ? 'none' : '';
        toggle.lastChild.textContent = open ? 'Why?' : 'Hide';
        if (!built) {
          buildBreakdown(details, ledger, debt, mode, code);
          built = true;
        }
      },
    },
    icon('info', 15),
    h('span', {}, 'Why?'),
  );

  return h(
    'div',
    { class: 'debt', style: { flexDirection: 'column', alignItems: 'stretch' } },
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row', style: { gap: '5px', flex: 'none' } }, avatarNode(from, 32), h('span', { class: 'debt__arrow' }, icon('arrowRight', 15)), avatarNode(to, 32)),
      h(
        'div',
        { class: 'debt__body' },
        h('div', { style: { fontWeight: '650', lineHeight: '1.25' } }, `${from?.name || '?'} owes ${to?.name || '?'}`),
      ),
      h('div', { class: 'debt__amount num', style: { whiteSpace: 'nowrap' } }, fmt(debt.amount, code)),
    ),
    h(
      'div',
      { class: 'debt__actions' },
      h(
        'button',
        {
          class: 'btn btn--sm btn--primary grow',
          onClick: () => openPaymentSheet({ group, ledger, rerender, from: debt.from, to: debt.to, amount: debt.amount }),
        },
        icon('check', 15),
        'Settle',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm btn--quiet',
          onClick: () => openShareSheet({ kind: 'receipt', ledger, mode, from: debt.from, to: debt.to }),
        },
        icon('share', 15),
        'Receipt',
      ),
      toggle,
    ),
    details,
  );
}

function buildBreakdown(container, ledger, debt, mode, code) {
  const explanation = explainSections(ledger, debt.from, debt.to, mode);
  clear(container);

  if (!explanation.sections.length) {
    container.appendChild(h('div', { class: 'tiny muted' }, 'No matching bills. This balance comes from settlements only.'));
  }

  for (const section of explanation.sections) {
    container.appendChild(h('div', { class: 'breakdown__head', text: section.title }));
    for (const row of section.rows) {
      container.appendChild(
        h(
          'div',
          { class: 'breakdown__row' },
          h('span', {}, `${row.label}${row.date ? ' · ' + fmtDate(row.date) : ''}`),
          h('span', { class: 'num' }, fmt(row.amount, code)),
        ),
      );
    }
    if (section.rows.length > 1) {
      container.appendChild(
        h(
          'div',
          { class: 'breakdown__row breakdown__row--sub' },
          h('span', {}, 'Subtotal'),
          h('span', { class: 'num' }, fmt(section.subtotal, code)),
        ),
      );
    }
  }

  container.appendChild(
    h(
      'div',
      { class: 'breakdown__row breakdown__row--total' },
      h('span', {}, explanation.totalLabel),
      h('span', { class: 'num' }, fmt(Math.abs(explanation.amount), code)),
    ),
  );
  if (explanation.note) {
    container.appendChild(h('div', { class: 'tiny muted', style: { marginTop: '8px' }, text: explanation.note }));
  }
}

/** Record a payment between two people. */
export function openPaymentSheet({ group, ledger, rerender, from = null, to = null, amount = 0 }) {
  const code = group.currency;
  const draft = {
    from: from || group.meId || group.members[0]?.id,
    to: to || group.members.find((m) => m.id !== (from || group.members[0]?.id))?.id,
    amount,
    date: toDateKey(new Date()),
    note: '',
  };

  const picker = (key, label) =>
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field__label', text: label }),
      h(
        'div',
        { class: 'row row--wrap', style: { gap: '8px' } },
        group.members.map((m) =>
          h(
            'button',
            {
              class: 'chip',
              'aria-pressed': String(draft[key] === m.id),
              onClick: (e) => {
                draft[key] = m.id;
                for (const btn of e.currentTarget.parentElement.children) {
                  btn.setAttribute('aria-pressed', String(btn.dataset.id === m.id));
                }
              },
              dataset: { id: m.id },
            },
            avatarNode(m, 22),
            m.name,
          ),
        ),
      ),
    );

  const amountField = moneyInput({
    currency: code,
    value: amount,
    size: 'big',
    onChange: (v) => {
      draft.amount = v ?? 0;
    },
  });

  const ctx = openSheet({
    title: 'Record a payment',
    subtitle: group.name,
    render: () =>
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'card' }, h('span', { class: 'field__label', text: 'Amount paid' }), amountField),
        picker('from', 'Paid by'),
        picker('to', 'Paid to'),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Date' }),
          h('input', {
            class: 'input',
            type: 'date',
            value: draft.date,
            onInput: (e) => {
              draft.date = e.target.value || toDateKey(new Date());
            },
          }),
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'Note (optional)' }),
          h('input', {
            class: 'input',
            placeholder: 'UPI, cash, bank transfer…',
            onInput: (e) => {
              draft.note = e.target.value;
            },
          }),
        ),
      ),
    footer: () => [
      h(
        'button',
        {
          class: 'btn btn--primary btn--block',
          onClick: async () => {
            if (!draft.amount || draft.amount <= 0) return toast('Enter an amount', 'bad');
            if (!draft.from || !draft.to) return toast('Pick both people', 'bad');
            if (draft.from === draft.to) return toast('Pick two different people', 'bad');
            await addPayment({ groupId: group.id, ...draft });
            ctx.close();
            toast('Settled up', 'good');
            rerender();
          },
        },
        icon('check', 18),
        'Mark as settled',
      ),
    ],
  });
}
