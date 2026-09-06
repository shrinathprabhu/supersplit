// Group screen: expenses, settle up and people.

import { h, relativeDay, fmtDate, listNames, download } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmSheet, promptSheet, chooseSheet } from './shell.js';
import { avatarNode, avatarStack, emptyState, segmented } from './components.js';
import { fmt, CURRENCIES } from '../core/money.js';
import { getGroup, ledgerFor, updateGroup, deleteGroup, addMember, updateMember, removeMember, memberUsage, deleteExpense } from '../core/store.js';
import { exportGroup } from '../core/transfer.js';
import { newSeed } from '../core/avatar.js';
import { openExpenseEditor } from './expense-editor.js';
import { renderSettleTab } from './settlement.js';
import { openShareSheet } from './share-sheet.js';
import { lineChart, chartLegend, statRow, CHART_COLORS } from './charts.js';
import { groupDaily } from '../core/analytics.js';
import { navigate } from '../app.js';

export function groupScreen(groupId, tab = 'expenses') {
  const group = getGroup(groupId);
  if (!group) {
    navigate('#/');
    return h('div', {});
  }
  const ledger = ledgerFor(groupId);
  const rerender = () => window.dispatchEvent(new CustomEvent('supersplit:refresh'));

  const content = h('div', { class: 'content wrap' });
  const screen = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'appbar' },
      h(
        'div',
        { class: 'appbar__inner wrap' },
        h('button', { class: 'btn btn--icon', 'aria-label': 'Back', onClick: () => navigate('#/') }, icon('back', 20)),
        h(
          'div',
          { class: 'appbar__title' },
          h('span', { text: group.name }),
          h('small', { text: `${group.members.length} ${group.members.length === 1 ? 'person' : 'people'} · ${group.currency}` }),
        ),
        h('button', { class: 'btn btn--icon', 'aria-label': 'Group options', onClick: () => openGroupMenu(group, rerender) }, icon('more', 20)),
      ),
    ),
    content,
  );

  const tabs = segmented(
    [
      { value: 'expenses', label: 'Expenses' },
      { value: 'settle', label: 'Settle up' },
      { value: 'people', label: 'People' },
    ],
    tab,
    (v) => navigate(v === 'expenses' ? `#/g/${groupId}` : `#/g/${groupId}/${v}`),
  );

  content.appendChild(h('div', { style: { marginBottom: '14px' } }, tabs));

  if (tab === 'settle') {
    content.appendChild(renderSettleTab(group, ledger, rerender));
  } else if (tab === 'people') {
    content.appendChild(peopleTab(group, ledger, rerender));
  } else {
    content.appendChild(expensesTab(group, ledger, rerender));
  }

  if (tab !== 'people') {
    screen.appendChild(
      h(
        'button',
        {
          class: 'fab',
          onClick: () => openExpenseEditor({ groupId, onSaved: rerender }),
        },
        icon('plus', 18),
        'Add expense',
      ),
    );
  } else {
    screen.appendChild(
      h('button', { class: 'fab', onClick: () => addPersonFlow(group, rerender) }, icon('plus', 18), 'Add person'),
    );
  }

  return screen;
}

// -------------------------------------------------------------- expenses

function expensesTab(group, ledger, rerender) {
  const code = group.currency;
  const me = group.meId ? group.members.find((m) => m.id === group.meId) : null;
  const root = h('div', { class: 'stack' });

  const net = me ? ledger.net[me.id] || 0 : null;
  const settled = ledger.expenses.length > 0 && ledger.debts(group.simplify ? 'simplified' : 'actual').length === 0;
  root.appendChild(
    h(
      'div',
      { class: 'hero' },
      h('div', { class: 'tiny muted', style: { letterSpacing: '.08em', fontWeight: '700' }, text: 'TOTAL SPENT' }),
      h('div', { class: 'hero__amount num', text: fmt(ledger.totalSpend, code) }),
      h(
        'div',
        { class: 'row row--between', style: { marginTop: '14px' } },
        settled
          ? h('span', { class: 'pill pill--good', text: 'All settled up' })
          : me
            ? h(
                'div',
                { class: 'row', style: { gap: '8px' } },
                avatarNode(me, 26),
                net === 0
                  ? h('span', { class: 'pill', text: 'You are settled up' })
                  : net > 0
                    ? h('span', { class: 'pill pill--good', text: `You get back ${fmt(net, code)}` })
                    : h('span', { class: 'pill pill--bad', text: `You owe ${fmt(-net, code)}` }),
              )
            : h(
                'button',
                { class: 'btn btn--sm btn--quiet', onClick: () => navigate(`#/g/${group.id}/people`) },
                icon('users', 15),
                'Mark which one is you',
              ),
        avatarStack(group.members, 4, 26),
      ),
    ),
  );

  if (ledger.expenses.length) root.appendChild(spendingCard(group, ledger));

  if (!ledger.expenses.length) {
    root.appendChild(
      emptyState({
        iconName: 'receipt',
        title: 'No expenses yet',
        text: 'Add the first bill and SuperSplit works out who owes what, taxes included.',
        action: h('button', { class: 'btn btn--primary', onClick: () => openExpenseEditor({ groupId: group.id, onSaved: rerender }) }, icon('plus', 16), 'Add an expense'),
      }),
    );
    return root;
  }

  let lastDate = null;
  let list = null;
  for (const expense of ledger.expenses) {
    if (expense.date !== lastDate) {
      lastDate = expense.date;
      root.appendChild(h('div', { class: 'day-head', text: relativeDay(expense.date) }));
      list = h('div', { class: 'list' });
      root.appendChild(list);
    }
    list.appendChild(expenseRow(group, ledger, expense, rerender));
  }
  return root;
}

/** Daily spend for the group, with the figures printed rather than hovered. */
function spendingCard(group, ledger) {
  const code = group.currency;
  const data = groupDaily(ledger);
  if (!data.points.length) return h('div', {});

  const series = [{ name: 'Group total', color: CHART_COLORS[0] }];
  if (data.hasMe) series.push({ name: 'Your share', color: CHART_COLORS[1] });
  const points = data.hasMe ? data.points : data.points.map((p) => ({ date: p.date, values: [p.values[0]] }));

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'chart-head' },
      h('h4', { text: 'Daily spend' }),
      h('span', { class: 'tiny muted', text: `since ${fmtDate(data.from)}` }),
    ),
    chartLegend(
      data.hasMe
        ? [
            { name: 'Group total', color: CHART_COLORS[0], value: data.total },
            { name: 'Your share', color: CHART_COLORS[1], value: data.mine },
          ]
        : [{ name: 'Group total', color: CHART_COLORS[0], value: data.total }],
      code,
    ),
    h('div', { style: { marginTop: '10px' } }, lineChart({ points, series, currency: code })),
    statRow([
      { label: 'Total', value: fmt(data.total, code) },
      { label: 'Per day', value: fmt(data.perDay, code) },
      { label: 'Busiest day', value: data.peak ? fmtDate(data.peak.date) : 'n/a' },
    ]),
    // Without someone marked as "you" there is no second line to draw, so say
    // why rather than quietly leaving it out.
    data.hasMe
      ? null
      : h(
          'button',
          {
            class: 'btn btn--sm btn--quiet',
            style: { marginTop: '12px' },
            onClick: () => navigate(`#/g/${group.id}/people`),
          },
          icon('users', 15),
          'Mark which one is you to chart your share',
        ),
  );
}

function expenseRow(group, ledger, expense, rerender) {
  const code = group.currency;
  const c = ledger.computed.get(expense.id);
  const payerNames = expense.payers.members
    .filter((id) => (c.paid[id] || 0) !== 0)
    .map((id) => group.members.find((m) => m.id === id)?.name)
    .filter(Boolean);
  const me = group.meId;
  const myShare = me ? c.owed[me] || 0 : null;
  const myPaid = me ? c.paid[me] || 0 : null;
  const myNet = me ? myPaid - myShare : null;

  return h(
    'button',
    { class: 'list__item', onClick: () => openExpenseDetail(group, ledger, expense, rerender) },
    h('div', { class: 'expense__icon' }, icon('receipt', 20)),
    h(
      'div',
      { class: 'grow', style: { minWidth: 0 } },
      h('div', { class: 'ellipsis', style: { fontWeight: '650' }, text: expense.description || 'Expense' }),
      h('div', { class: 'expense__meta ellipsis', text: `Paid by ${listNames(payerNames, 2)}` }),
    ),
    h(
      'div',
      { class: 'amount-right' },
      h('b', { class: 'num', text: fmt(c.total, code) }),
      me
        ? h('span', {
            class: myNet === 0 ? '' : myNet > 0 ? 'good' : 'bad',
            text: myNet === 0 ? 'not involved' : myNet > 0 ? `you lent ${fmt(myNet, code)}` : `you owe ${fmt(-myNet, code)}`,
          })
        : h('span', { text: `${c.members.length} way split` }),
    ),
  );
}

/** Tax, discounts and round-off carried by one person on one expense. */
function extraFor(c, id) {
  return (c.taxByMember[id] || 0) - (c.discountByMember?.[id] || 0) + (c.rounding?.per?.[id] || 0);
}

/** One money-off line in the expense breakdown. */
function discountRow(d, code, group) {
  const who = d.everyone
    ? 'everyone'
    : listNames(d.members.map((id) => group.members.find((m) => m.id === id)?.name).filter(Boolean), 2);
  const rate = d.kind === 'percent' ? ` (${d.value}%)` : '';
  return h(
    'div',
    { class: 'breakdown__row' },
    h('span', { text: `${d.label || 'Discount'}${rate} · ${who}` }),
    h('span', { class: 'num good', text: '-' + fmt(d.amount, code) }),
  );
}

function openExpenseDetail(group, ledger, expense, rerender) {
  const code = group.currency;
  const c = ledger.computed.get(expense.id);
  const name = (id) => group.members.find((m) => m.id === id)?.name || 'Unknown';

  const row = (label, value, opts = {}) =>
    h(
      'div',
      { class: 'breakdown__row' + (opts.total ? ' breakdown__row--total' : '') },
      h('span', { text: label }),
      h('span', { class: 'num' + (opts.class ? ' ' + opts.class : ''), text: value }),
    );

  const ctx = openSheet({
    title: expense.description || 'Expense',
    subtitle: fmtDate(expense.date, { long: true }),
    render: () => [
      h(
        'div',
        { class: 'card' },
        row('Amount before tax', fmt(c.subtotal, code)),
        ...(c.discounts || [])
          .filter((d) => d.stage === 'pre')
          .map((d) => discountRow(d, code, group)),
        ...c.taxes.map((t) =>
          row(`${t.label || 'Tax'}${t.kind === 'percent' ? ` (${t.value}%)` : ''} · ${t.mode === 'equal' ? 'split equally' : 'shared by split'}`, fmt(t.amount, code)),
        ),
        ...(c.discounts || [])
          .filter((d) => d.stage === 'post')
          .map((d) => discountRow(d, code, group)),
        c.rounding?.amount ? row('Round off', (c.rounding.amount < 0 ? '−' : '+') + fmt(Math.abs(c.rounding.amount), code)) : null,
        row('Total', fmt(c.total, code), { total: true }),
      ),
      h('div', { class: 'section-title', text: 'Paid by' }),
      h(
        'div',
        { class: 'list' },
        expense.payers.members
          .filter((id) => (c.paid[id] || 0) !== 0)
          .map((id) =>
            h(
              'div',
              { class: 'list__item' },
              avatarNode(group.members.find((m) => m.id === id), 30),
              h('span', { class: 'grow ellipsis', text: name(id) }),
              h('b', { class: 'num', text: fmt(c.paid[id], code) }),
            ),
          ),
      ),
      h('div', { class: 'section-title', text: 'Split between' }),
      h(
        'div',
        { class: 'list' },
        expense.split.members.map((id) =>
          h(
            'div',
            { class: 'list__item' },
            avatarNode(group.members.find((m) => m.id === id), 30),
            h(
              'div',
              { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 'ellipsis', text: name(id) }),
              extraFor(c, id)
                ? h('div', {
                    class: 'tiny muted',
                    text: `${fmt(c.preTax[id], code)} ${extraFor(c, id) < 0 ? '-' : '+'} ${fmt(Math.abs(extraFor(c, id)), code)} tax & discounts`,
                  })
                : null,
            ),
            h('b', { class: 'num', text: fmt(c.owed[id], code) }),
          ),
        ),
      ),
      expense.notes ? h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'small dim', text: expense.notes })) : null,
    ],
    footer: () => [
      h(
        'button',
        {
          class: 'btn btn--danger',
          'aria-label': 'Delete',
          onClick: async () => {
            const ok = await confirmSheet({ title: 'Delete this expense?', message: 'Balances update straight away.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            await deleteExpense(expense.id);
            ctx.close();
            toast('Expense deleted');
            rerender();
          },
        },
        icon('trash', 18),
      ),
      h(
        'button',
        {
          class: 'btn btn--primary grow',
          onClick: () => {
            ctx.close();
            openExpenseEditor({ groupId: group.id, expenseId: expense.id, onSaved: rerender });
          },
        },
        icon('edit', 18),
        'Edit',
      ),
    ],
  });
}

// ---------------------------------------------------------------- people

function peopleTab(group, ledger, rerender) {
  const code = group.currency;
  const root = h('div', { class: 'stack' });

  root.appendChild(
    h(
      'div',
      { class: 'list' },
      group.members.map((m) => {
        const net = ledger.net[m.id] || 0;
        return h(
          'button',
          { class: 'list__item', onClick: () => openMemberSheet(group, m, rerender) },
          avatarNode(m, 38, { ring: group.meId === m.id }),
          h(
            'div',
            { class: 'grow', style: { minWidth: 0 } },
            h(
              'div',
              { class: 'row', style: { gap: '6px' } },
              h('span', { class: 'ellipsis', style: { fontWeight: '650' }, text: m.name }),
              group.meId === m.id ? h('span', { class: 'pill pill--brand', text: 'you' }) : null,
            ),
            h('div', {
              class: 'tiny ' + (net === 0 ? 'muted' : net > 0 ? 'good' : 'bad'),
              text: net === 0 ? 'settled up' : net > 0 ? `gets back ${fmt(net, code)}` : `owes ${fmt(-net, code)}`,
            }),
          ),
          icon('chevronRight', 18),
        );
      }),
    ),
  );

  if (!group.meId) {
    root.appendChild(
      h('div', { class: 'banner banner--info', style: { marginTop: '4px' } }, 'Tap yourself in the list and choose “This is me” to see your own balance everywhere.'),
    );
  }
  return root;
}

async function addPersonFlow(group, rerender) {
  const name = await promptSheet({ title: 'Add a person', label: 'Name', placeholder: 'e.g. Rhea', confirmLabel: 'Add' });
  if (!name) return;
  await addMember(group.id, name);
  toast(`${name} added`, 'good');
  rerender();
}

function openMemberSheet(group, member, rerender) {
  const usage = memberUsage(group.id, member.id);
  const ctx = openSheet({
    title: member.name,
    render: () => [
      h('div', { class: 'row center', style: { justifyContent: 'center', padding: '6px 0 18px' } }, avatarNode(member, 84)),
      h(
        'div',
        { class: 'list' },
        h(
          'button',
          {
            class: 'list__item',
            onClick: async () => {
              const name = await promptSheet({ title: 'Rename', label: 'Name', value: member.name });
              if (!name) return;
              await updateMember(group.id, member.id, { name });
              ctx.close();
              rerender();
            },
          },
          icon('edit', 19),
          h('span', { class: 'grow' }, 'Rename'),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: async () => {
              await updateMember(group.id, member.id, { avatarSeed: newSeed(member.name) });
              ctx.close();
              rerender();
            },
          },
          icon('sparkle', 19),
          h('span', { class: 'grow' }, 'Shuffle avatar'),
        ),
        group.meId === member.id
          ? h(
              'button',
              {
                class: 'list__item',
                onClick: async () => {
                  await updateGroup(group.id, { meId: null });
                  ctx.close();
                  rerender();
                },
              },
              icon('users', 19),
              h('span', { class: 'grow' }, 'Not me after all'),
            )
          : h(
              'button',
              {
                class: 'list__item',
                onClick: async () => {
                  await updateGroup(group.id, { meId: member.id });
                  ctx.close();
                  toast(`Hi ${member.name}`, 'good');
                  rerender();
                },
              },
              icon('users', 19),
              h('span', { class: 'grow' }, 'This is me'),
            ),
        h(
          'button',
          {
            class: 'list__item',
            style: usage.blocked ? { opacity: '.5' } : {},
            onClick: async () => {
              if (usage.blocked) {
                const parts = [];
                if (usage.expenses) parts.push(`${usage.expenses} expense${usage.expenses === 1 ? '' : 's'}`);
                if (usage.payments) parts.push(`${usage.payments} settlement${usage.payments === 1 ? '' : 's'}`);
                toast(`${member.name} appears in ${parts.join(' and ')}. Remove those first.`, 'bad');
                return;
              }
              const ok = await confirmSheet({ title: `Remove ${member.name}?`, message: 'They are not part of any expense, so nothing else changes.', confirmLabel: 'Remove', danger: true });
              if (!ok) return;
              await removeMember(group.id, member.id);
              ctx.close();
              rerender();
            },
          },
          icon('trash', 19),
          h('span', { class: 'grow bad' }, 'Remove from group'),
        ),
      ),
    ],
  });
}

// ------------------------------------------------------------- group menu

/**
 * Deleting a group with money still moving would quietly write off whatever
 * people owe each other, so it stays locked until the balances are clear.
 */
function deleteGroupItem(group, ledger, closeMenu) {
  const outstandingMembers = ledger.memberIds.filter((id) => (ledger.net[id] || 0) !== 0);
  const outstanding = outstandingMembers.length > 0;

  return h(
    'button',
    {
      class: 'list__item',
      'aria-disabled': String(outstanding),
      style: outstanding ? { opacity: '0.55' } : {},
      onClick: async () => {
        if (outstanding) {
          const names = outstandingMembers.map((id) => group.members.find((m) => m.id === id)?.name).filter(Boolean);
          toast(`${listNames(names, 2)} still have balances to settle`, 'bad');
          closeMenu();
          navigate(`#/g/${group.id}/settle`);
          return;
        }
        const ok = await confirmSheet({
          title: `Delete “${group.name}”?`,
          message: `Everyone is settled up. ${ledger.expenses.length} expense${ledger.expenses.length === 1 ? '' : 's'} and the whole history will be gone for good.`,
          confirmLabel: 'Delete group',
          danger: true,
        });
        if (!ok) return;
        await deleteGroup(group.id);
        navigate('#/');
        toast('Group deleted');
      },
    },
    icon('trash', 19),
    h(
      'div',
      { class: 'grow' },
      h('div', { class: outstanding ? '' : 'bad' }, 'Delete group'),
      outstanding ? h('div', { class: 'tiny muted' }, 'Settle up first') : null,
    ),
  );
}

function openGroupMenu(group, rerender) {
  const ledger = ledgerFor(group.id);
  const ctx = openSheet({
    title: group.name,
    render: () => [
      h(
        'div',
        { class: 'list' },
        h(
          'button',
          {
            class: 'list__item',
            onClick: () => {
              ctx.close();
              openShareSheet({ kind: 'summary', ledger, mode: group.simplify ? 'simplified' : 'actual' });
            },
          },
          icon('share', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Share or export'), h('div', { class: 'tiny muted' }, 'Text, image or a detailed PDF')),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: async () => {
              const name = await promptSheet({ title: 'Rename group', label: 'Group name', value: group.name });
              if (!name) return;
              await updateGroup(group.id, { name });
              ctx.close();
              rerender();
            },
          },
          icon('edit', 19),
          h('span', { class: 'grow' }, 'Rename group'),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: async () => {
              const value = await chooseSheet({
                title: 'Currency',
                selected: group.currency,
                options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol.trim()}  ${c.code}`, hint: c.name })),
              });
              if (!value || value === group.currency) return;
              await updateGroup(group.id, { currency: value });
              toast('Currency changed. Amounts are not converted.', 'bad');
              ctx.close();
              rerender();
            },
          },
          icon('wallet', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Currency'), h('div', { class: 'tiny muted' }, group.currency)),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: () => {
              download(
                new Blob([JSON.stringify(exportGroup(group.id), null, 2)], { type: 'application/json' }),
                `${group.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-group.json`,
              );
              toast('Group exported', 'good');
              ctx.close();
            },
          },
          icon('download', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Export this group'), h('div', { class: 'tiny muted' }, 'Share it with someone, or move it to another browser')),
        ),
        // openSheet renders synchronously, before `ctx` is assigned. Deferring
        // the lookup inside a callback keeps the menu safe to construct.
        deleteGroupItem(group, ledger, () => ctx.close()),
      ),
    ],
  });
}
