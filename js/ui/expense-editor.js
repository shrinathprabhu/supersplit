// Add / edit an expense: the amount before tax, any number of taxes and fees,
// an optional bill round-off, who paid, and how it splits.

import { h, clear, replace, fmtDateLong } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmSheet } from './shell.js';
import { avatarNode, moneyInput, numberInput, segmented, checkbox } from './components.js';
import { getGroup, saveExpense, deleteExpense, getExpense, carryBefore } from '../core/store.js';
import { blankExpense, newTax, newDiscount, computeExpense, makeCarry, roundTarget, toDateKey } from '../core/split.js';
import { fmt, allocate, currency as curInfo } from '../core/money.js';
import { findLookalikes } from '../core/transfer.js';

const PAYER_MODES = [
  { value: 'equal', label: 'Equally' },
  { value: 'amount', label: 'Amounts' },
  { value: 'percent', label: 'Percent' },
];
const SPLIT_MODES = [
  { value: 'equal', label: 'Equally' },
  { value: 'amount', label: 'Amounts' },
  { value: 'percent', label: 'Percent' },
  { value: 'shares', label: 'Shares' },
];
const DISCOUNT_STAGE = [
  { value: 'pre', label: 'Before tax' },
  { value: 'post', label: 'After tax' },
];
const TAX_SPREAD = [
  { value: 'proportional', label: 'By share' },
  { value: 'equal', label: 'Equally' },
];

export function openExpenseEditor({ groupId, expenseId = null, onSaved }) {
  const group = getGroup(groupId);
  if (!group) return;
  const code = group.currency;
  const existing = expenseId ? getExpense(expenseId) : null;
  const draft = existing
    ? normalise(structuredClone(existing))
    : blankExpense(groupId, group.members.map((m) => m.id));

  const memberById = new Map(group.members.map((m) => [m.id, m]));
  const nodes = {};
  // Start the rounding ledger where the group leaves off, so the shares shown
  // here are the ones the saved expense will have.
  let carrySeed = carryBefore(groupId, draft).snapshot();
  const compute = () => computeExpense(draft, code, makeCarry(carrySeed));
  let computed = compute();
  let showErrors = false; // errors appear once the user has tried to save
  let lastDate = draft.date;

  function normalise(expense) {
    // Expenses saved before round-off existed, or before it had modes.
    if (!expense.discounts) expense.discounts = [];
    const ro = expense.roundOff;
    if (!ro) expense.roundOff = { enabled: false, mode: 'nearest', total: null };
    else if (!ro.mode) ro.mode = ro.total === null || ro.total === undefined ? 'nearest' : 'exact';
    return expense;
  }

  // ------------------------------------------------------------ validation

  function hasNonPositiveValue(section) {
    return (
      section.mode !== 'equal' &&
      section.members.some((id) => !Number.isFinite(Number(section.values[id])) || Number(section.values[id]) <= 0)
    );
  }

  function problems() {
    const list = [];
    if (!draft.description.trim()) list.push('Give the expense a title.');
    if (!Number.isFinite(draft.subtotal) || draft.subtotal <= 0) list.push('Enter an amount greater than zero.');
    if (draft.taxes.some((tax) => !Number.isFinite(Number(tax.value)) || Number(tax.value) <= 0)) {
      list.push('Tax and fee values must be greater than zero.');
    }
    if (draft.subtotal > 0 && computed.total <= 0) list.push('The total must be greater than zero.');
    if (!draft.payers.members.length) list.push('Choose who paid.');
    if (hasNonPositiveValue(draft.payers)) {
      list.push('Every payer value must be greater than zero. Deselect anyone who did not pay.');
    }
    if (!draft.split.members.length) list.push('Choose who to split it between.');
    if (hasNonPositiveValue(draft.split)) {
      list.push('Every split value must be greater than zero. Deselect anyone not included.');
    }
    for (const err of computed.errors) {
      if (err.code === 'sum' || err.code === 'over') list.push(err.message);
    }
    return list;
  }

  // ------------------------------------------------------------ derived UI

  function recompute() {
    // Reseeding each time keeps repeated edits from drifting the ledger.
    if (draft.date !== lastDate) {
      lastDate = draft.date;
      carrySeed = carryBefore(groupId, draft).snapshot();
    }
    computed = compute();

    nodes.total.textContent = fmt(computed.total, code);
    const bits = [];
    if (computed.discountTotal) bits.push(`${fmt(computed.discountTotal, code)} off`);
    if (computed.taxTotal) bits.push(`${fmt(computed.taxableTotal, code)} + ${fmt(computed.taxTotal, code)} tax & fees`);
    if (computed.rounding.amount) bits.push(`round off ${signed(computed.rounding.amount, code)}`);
    nodes.totalHint.textContent = bits.length ? bits.join(' · ') : 'No taxes added';

    for (const [id, node] of Object.entries(nodes.taxAmounts || {})) {
      const tax = computed.taxes.find((t) => t.id === id);
      if (tax) node.textContent = fmt(tax.amount, code);
    }
    for (const [id, node] of Object.entries(nodes.discountAmounts || {})) {
      const line = computed.discounts.find((d) => d.discountId === id);
      node.textContent = line ? '-' + fmt(line.amount, code) : '--';
    }
    if (nodes.roundHint) {
      const sym = curInfo(code).symbol.trim();
      nodes.roundHint.textContent = !draft.roundOff.enabled
        ? `Shops often round the printed total to a whole ${sym}1.`
        : computed.rounding.amount === 0
          ? `Already a whole ${sym}1, nothing to round.`
          : `${fmt(computed.rawTotal, code)} → ${fmt(computed.total, code)} · ${signed(computed.rounding.amount, code)} shared across the split`;
    }


    updatePayerHints();
    updateSplitHints();
    renderBanner();
  }

  function renderBanner() {
    const list = showErrors ? problems() : [];
    clear(nodes.banner);
    nodes.banner.style.display = list.length ? '' : 'none';
    if (!list.length) return;
    nodes.banner.appendChild(h('div', { text: list.length === 1 ? 'One thing to fix:' : `${list.length} things to fix:` }));
    nodes.banner.appendChild(h('ul', {}, list.map((message) => h('li', { text: message }))));
  }

  function updatePayerHints() {
    if (!nodes.payerRows) return;
    for (const [id, row] of Object.entries(nodes.payerRows)) {
      row.value.textContent = fmt(computed.paid[id] || 0, code);
    }
    if (!nodes.payerHint) return;
    const error = computed.errors.find((e) => e.field === 'payers' && e.code === 'sum');
    if (!draft.payers.members.length) {
      nodes.payerHint.textContent = 'Tap everyone who put money in.';
      nodes.payerHint.className = 'tiny muted';
    } else if (error) {
      nodes.payerHint.textContent = leftOver(error, draft.payers.mode, code);
      nodes.payerHint.className = 'tiny bad';
    } else {
      nodes.payerHint.textContent =
        draft.payers.members.length > 1 ? 'Adds up to the total ✓' : `${nameOf(draft.payers.members[0])} paid the whole bill`;
      nodes.payerHint.className = 'tiny good';
    }
  }

  function updateSplitHints() {
    if (!nodes.splitRows) return;
    for (const [id, row] of Object.entries(nodes.splitRows)) {
      // The split itself is on the pre-tax amount; tax and rounding are shown
      // separately so the numbers match what the user typed.
      row.value.textContent = fmt(computed.preTax[id] || 0, code);
      const extra =
        (computed.taxByMember[id] || 0) - (computed.discountByMember[id] || 0) + (computed.rounding.per?.[id] || 0);
      if (row.sub) row.sub.textContent = extra ? `${signed(extra, code)} tax & discounts` : '';
    }
    if (!nodes.splitHint) return;
    const error = computed.errors.find((e) => e.field === 'split' && e.code === 'sum');
    if (!draft.split.members.length) {
      nodes.splitHint.textContent = 'Pick at least one person.';
      nodes.splitHint.className = 'tiny bad';
    } else if (error) {
      nodes.splitHint.textContent = leftOver(error, draft.split.mode, code);
      nodes.splitHint.className = 'tiny bad';
    } else {
      const n = draft.split.members.length;
      nodes.splitHint.textContent = `${n} ${n === 1 ? 'person' : 'people'} · splitting ${fmt(draft.subtotal, code)}`;
      nodes.splitHint.className = 'tiny muted';
    }
  }

  const nameOf = (id) => memberById.get(id)?.name || 'Someone';

  // -------------------------------------------------------------- sections

  function taxesSection() {
    const list = h('div', {});
    nodes.taxAmounts = {};

    const renderTaxes = () => {
      clear(list);
      nodes.taxAmounts = {};
      draft.taxes.forEach((tax) => {
        const amountNode = h('b', { class: 'num', text: '--' });
        nodes.taxAmounts[tax.id] = amountNode;

        const valueHolder = h('div', { class: 'grow' });
        const renderValue = () => {
          replace(
            valueHolder,
            tax.kind === 'percent'
              ? numberInput({
                  value: tax.value,
                  suffix: '%',
                  onChange: (v) => {
                    tax.value = v ?? 0;
                    recompute();
                  },
                })
              : moneyInput({
                  currency: code,
                  value: tax.value,
                  size: 'sm',
                  onChange: (v) => {
                    tax.value = v ?? 0;
                    recompute();
                  },
                }),
          );
        };
        renderValue();

        list.appendChild(
          h(
            'div',
            { class: 'tax-card' },
            h(
              'div',
              { class: 'row', style: { gap: '8px' } },
              h('input', {
                class: 'input grow',
                style: { padding: '0.55em 0.7em', borderRadius: '10px' },
                value: tax.label,
                placeholder: 'Tax or fee',
                onInput: (e) => {
                  tax.label = e.target.value;
                },
              }),
              h(
                'button',
                {
                  class: 'btn btn--icon',
                  'aria-label': 'Remove this tax',
                  onClick: () => {
                    draft.taxes = draft.taxes.filter((t) => t.id !== tax.id);
                    renderTaxes();
                    recompute();
                  },
                },
                icon('trash', 17),
              ),
            ),
            h(
              'div',
              { class: 'row', style: { marginTop: '8px', gap: '8px' } },
              segmented(
                [
                  { value: 'percent', label: '%' },
                  { value: 'amount', label: curInfo(code).symbol.trim() },
                ],
                tax.kind,
                (v) => {
                  tax.kind = v;
                  tax.value = 0;
                  renderTaxes();
                  recompute();
                },
                { small: true },
              ),
              valueHolder,
            ),
            h(
              'div',
              { class: 'row row--between', style: { marginTop: '8px' } },
              segmented(
                TAX_SPREAD,
                tax.mode,
                (v) => {
                  tax.mode = v;
                  renderTaxes();
                  recompute();
                },
                { small: true },
              ),
              h('div', { class: 'small', style: { flex: 'none', paddingLeft: '10px' } }, amountNode),
            ),
            h('div', {
              class: 'tiny muted',
              style: { marginTop: '6px' },
              text:
                tax.mode === 'equal'
                  ? 'Split equally: same amount each, like a flat cover charge.'
                  : 'By share: follows the split, so bigger orders carry more of it.',
            }),
          ),
        );
      });
    };
    renderTaxes();

    return h(
      'div',
      { class: 'stack stack--sm' },
      list,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn btn--quiet btn--sm',
            onClick: () => {
              draft.taxes.push({ ...newTax(draft.taxes.length ? 'Fee' : 'Tax'), value: 0 });
              renderTaxes();
              recompute();
            },
          },
          icon('plus', 15),
          'Add tax or fee',
        ),
      ),
    );
  }

  function discountsSection() {
    const list = h('div', {});
    nodes.discountAmounts = {};

    const render = () => {
      clear(list);
      nodes.discountAmounts = {};

      draft.discounts.forEach((discount) => {
        const amountNode = h('b', { class: 'num good', text: '--' });
        nodes.discountAmounts[discount.id] = amountNode;

        const valueHolder = h('div', { class: 'grow' });
        const renderValue = () => {
          replace(
            valueHolder,
            discount.kind === 'percent'
              ? numberInput({
                  value: discount.value,
                  suffix: '%',
                  onChange: (v) => {
                    discount.value = v ?? 0;
                    recompute();
                  },
                })
              : moneyInput({
                  currency: code,
                  value: discount.value,
                  size: 'sm',
                  onChange: (v) => {
                    discount.value = v ?? 0;
                    recompute();
                  },
                }),
          );
        };
        renderValue();

        const everyone = !discount.members.length;
        const applied = everyone ? group.members.map((m) => m.id) : discount.members;

        const card = h(
          'div',
          { class: 'tax-card' },
          h(
            'div',
            { class: 'row', style: { gap: '8px' } },
            h('input', {
              class: 'input grow',
              style: { padding: '0.55em 0.7em', borderRadius: '10px' },
              value: discount.label,
              placeholder: 'Discount',
              onInput: (e) => {
                discount.label = e.target.value;
              },
            }),
            h(
              'button',
              {
                class: 'btn btn--icon',
                'aria-label': 'Remove this discount',
                onClick: () => {
                  draft.discounts = draft.discounts.filter((d) => d.id !== discount.id);
                  render();
                  recompute();
                },
              },
              icon('trash', 17),
            ),
          ),
          h(
            'div',
            { class: 'row', style: { marginTop: '8px', gap: '8px' } },
            segmented(
              [
                { value: 'percent', label: '%' },
                { value: 'amount', label: curInfo(code).symbol.trim() },
              ],
              discount.kind,
              (v) => {
                discount.kind = v;
                discount.value = 0;
                render();
                recompute();
              },
              { small: true },
            ),
            valueHolder,
          ),
          h(
            'div',
            { class: 'row row--between', style: { marginTop: '8px' } },
            segmented(
              DISCOUNT_STAGE,
              discount.stage,
              (v) => {
                discount.stage = v;
                render();
                recompute();
              },
              { small: true },
            ),
            h('div', { class: 'small', style: { flex: 'none', paddingLeft: '10px' } }, amountNode),
          ),
          h('div', {
            class: 'tiny muted',
            style: { marginTop: '6px' },
            text:
              discount.stage === 'pre'
                ? 'Comes off before tax, so tax is worked out on the lower amount.'
                : 'Comes off the final total, after tax has been added.',
          }),
          h('div', { class: 'field__label', style: { margin: '12px 0 6px' }, text: 'Applies to' }),
          h(
            'div',
            { class: 'row row--wrap', style: { gap: '6px' } },
            h(
              'button',
              {
                class: 'chip chip--plain',
                'aria-pressed': String(everyone),
                onClick: () => {
                  discount.members = [];
                  render();
                  recompute();
                },
              },
              'Everyone',
            ),
            group.members.map((m) => {
              const on = !everyone && discount.members.includes(m.id);
              return h(
                'button',
                {
                  class: 'chip',
                  'aria-pressed': String(on),
                  onClick: () => {
                    const current = everyone ? [] : [...discount.members];
                    const next = current.includes(m.id) ? current.filter((id) => id !== m.id) : [...current, m.id];
                    // Naming everybody is the same as naming nobody.
                    discount.members =
                      next.length === group.members.length ? [] : group.members.filter((x) => next.includes(x.id)).map((x) => x.id);
                    render();
                    recompute();
                  },
                },
                avatarNode(m, 22),
                m.name,
              );
            }),
          ),
        );

        if (applied.length > 1) {
          card.appendChild(
            h(
              'div',
              { style: { marginTop: '10px' } },
              segmented(
                TAX_SPREAD,
                discount.mode,
                (v) => {
                  discount.mode = v;
                  render();
                  recompute();
                },
                { small: true },
              ),
            ),
          );
          card.appendChild(
            h('div', {
              class: 'tiny muted',
              style: { marginTop: '6px' },
              text:
                discount.mode === 'equal'
                  ? 'Split equally: the same amount off for each of them.'
                  : 'By share: more off for whoever ordered more.',
            }),
          );
        }

        list.appendChild(card);
      });
    };
    render();

    return h(
      'div',
      { class: 'stack stack--sm' },
      list,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn btn--quiet btn--sm',
            onClick: () => {
              draft.discounts.push(newDiscount());
              render();
              recompute();
            },
          },
          icon('plus', 15),
          'Add discount',
        ),
      ),
    );
  }

  function roundOffSection() {
    const holder = h('div', { class: 'tax-card' });

    const render = () => {
      clear(holder);
      nodes.roundInput = null;
      const ro = draft.roundOff;

      holder.appendChild(
        h(
          'div',
          { class: 'row', style: { gap: '10px' } },
          checkbox(ro.enabled, (next) => {
            ro.enabled = next;
            render();
            recompute();
          }),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: '600' } }, 'Round off the bill')),
        ),
      );

      if (ro.enabled) {
        holder.appendChild(
          h(
            'div',
            { style: { marginTop: '10px' } },
            segmented(
              [
                { value: 'nearest', label: 'Nearest' },
                { value: 'up', label: 'Round up' },
                { value: 'exact', label: 'Exact' },
              ],
              ro.mode,
              (v) => {
                if (v === 'exact' && (ro.total === null || ro.total === undefined)) {
                  ro.total = roundTarget(computed.rawTotal, { mode: ro.mode }, code);
                }
                ro.mode = v;
                render();
                recompute();
              },
              { small: true },
            ),
          ),
        );

        if (ro.mode === 'exact') {
          nodes.roundInput = moneyInput({
            currency: code,
            value: ro.total ?? computed.total,
            size: 'sm',
            onChange: (v) => {
              ro.total = v;
              recompute();
            },
          });
          holder.appendChild(
            h(
              'div',
              { class: 'row', style: { marginTop: '10px', gap: '10px' } },
              h('span', { class: 'tiny muted grow' }, 'Total printed on the bill'),
              h('div', { style: { width: '130px', flex: 'none' } }, nodes.roundInput),
            ),
          );
        }
      }

      nodes.roundHint = h('div', { class: 'tiny muted', style: { marginTop: '8px' } });
      holder.appendChild(nodes.roundHint);
    };

    render();
    return holder;
  }

  function payersSection() {
    const holder = h('div', { class: 'stack stack--sm' });

    const switchPayerMode = (mode) => {
      if (mode === 'amount') {
        draft.payers.values = {};
        for (const id of draft.payers.members) draft.payers.values[id] = computed.paid[id] || 0;
      } else if (mode === 'percent') {
        const weights = draft.payers.members.map((id) => computed.paid[id] || 0);
        const parts = allocate(10000, weights.some((w) => w > 0) ? weights : draft.payers.members.map(() => 1));
        draft.payers.values = {};
        draft.payers.members.forEach((id, i) => (draft.payers.values[id] = parts[i] / 100));
      }
      draft.payers.mode = mode;
      render();
      recompute();
    };

    const render = () => {
      clear(holder);
      nodes.payerRows = {};

      holder.appendChild(
        h(
          'div',
          { class: 'row row--wrap', style: { gap: '8px' } },
          group.members.map((m) => {
            const on = draft.payers.members.includes(m.id);
            return h(
              'button',
              {
                class: 'chip',
                'aria-pressed': String(on),
                onClick: () => {
                  if (on) draft.payers.members = draft.payers.members.filter((id) => id !== m.id);
                  else
                    draft.payers.members = group.members
                      .filter((x) => draft.payers.members.includes(x.id) || x.id === m.id)
                      .map((x) => x.id);
                  delete draft.payers.values[m.id];
                  if (draft.payers.members.length <= 1) draft.payers.mode = 'equal';
                  render();
                  recompute();
                },
              },
              avatarNode(m, 22),
              m.name,
            );
          }),
        ),
      );

      if (draft.payers.members.length > 1) {
        holder.appendChild(h('div', { style: { marginTop: '4px' } }, segmented(PAYER_MODES, draft.payers.mode, switchPayerMode, { small: true })));

        if (draft.payers.mode !== 'equal') {
          holder.appendChild(
            h(
              'div',
              { class: 'stack stack--sm' },
              draft.payers.members.map((id) => {
                const value = h('span', { class: 'split-row__value num', text: '--' });
                nodes.payerRows[id] = { value };
                const input =
                  draft.payers.mode === 'amount'
                    ? moneyInput({
                        currency: code,
                        value: draft.payers.values[id] ?? 0,
                        size: 'sm',
                        bare: true,
                        onChange: (v) => {
                          draft.payers.values[id] = v ?? 0;
                          recompute();
                        },
                      })
                    : numberInput({
                        value: draft.payers.values[id] ?? 0,
                        suffix: '%',
                        onChange: (v) => {
                          draft.payers.values[id] = v ?? 0;
                          recompute();
                        },
                      });
                input.classList.add('split-row__input');
                return h(
                  'div',
                  { class: 'split-row' },
                  avatarNode(memberById.get(id), 26),
                  h('span', { class: 'grow ellipsis', text: nameOf(id) }),
                  draft.payers.mode === 'percent' ? value : null,
                  input,
                );
              }),
            ),
          );
        }
      }

      nodes.payerHint = h('div', { class: 'tiny muted' });
      holder.appendChild(nodes.payerHint);
    };

    render();
    return holder;
  }

  function splitSection() {
    const holder = h('div', { class: 'stack stack--sm' });

    const switchSplitMode = (mode) => {
      if (mode === 'amount') {
        draft.split.values = {};
        for (const id of draft.split.members) draft.split.values[id] = computed.preTax[id] || 0;
      } else if (mode === 'percent') {
        const weights = draft.split.members.map((id) => computed.preTax[id] || 0);
        const parts = allocate(10000, weights.some((w) => w > 0) ? weights : draft.split.members.map(() => 1));
        draft.split.values = {};
        draft.split.members.forEach((id, i) => (draft.split.values[id] = parts[i] / 100));
      } else if (mode === 'shares') {
        draft.split.values = {};
        for (const id of draft.split.members) draft.split.values[id] = 1;
      }
      draft.split.mode = mode;
      render();
      recompute();
    };

    const render = () => {
      clear(holder);
      nodes.splitRows = {};

      holder.appendChild(segmented(SPLIT_MODES, draft.split.mode, switchSplitMode, { small: true }));

      const allOn = draft.split.members.length === group.members.length;
      holder.appendChild(
        h(
          'div',
          { class: 'row row--between', style: { padding: '2px 2px 0' } },
          (nodes.splitHint = h('div', { class: 'tiny muted' })),
          h(
            'button',
            {
              class: 'btn btn--sm btn--quiet',
              onClick: () => {
                draft.split.members = allOn ? [] : group.members.map((m) => m.id);
                render();
                recompute();
              },
            },
            allOn ? 'Clear all' : 'Select all',
          ),
        ),
      );

      holder.appendChild(
        h(
          'div',
          { class: 'stack stack--sm' },
          group.members.map((m) => {
            const on = draft.split.members.includes(m.id);
            const value = h('b', { class: 'num', text: '--' });
            const sub = h('span', { class: 'tiny muted' });
            if (on) nodes.splitRows[m.id] = { value, sub };

            const toggle = () => {
              if (draft.split.members.includes(m.id)) {
                draft.split.members = draft.split.members.filter((id) => id !== m.id);
                delete draft.split.values[m.id];
              } else {
                draft.split.members = group.members
                  .filter((x) => draft.split.members.includes(x.id) || x.id === m.id)
                  .map((x) => x.id);
                if (draft.split.mode === 'shares') draft.split.values[m.id] = 1;
              }
              render();
              recompute();
            };

            let input = null;
            if (on && draft.split.mode !== 'equal') {
              input =
                draft.split.mode === 'amount'
                  ? moneyInput({
                      currency: code,
                      value: draft.split.values[m.id] ?? 0,
                      size: 'sm',
                      bare: true,
                      onChange: (v) => {
                        draft.split.values[m.id] = v ?? 0;
                        recompute();
                      },
                    })
                  : numberInput({
                      value: draft.split.values[m.id] ?? (draft.split.mode === 'shares' ? 1 : 0),
                      suffix: draft.split.mode === 'percent' ? '%' : '×',
                      onChange: (v) => {
                        draft.split.values[m.id] = v ?? 0;
                        recompute();
                      },
                    });
              input.style.width = '88px';
              input.style.flex = 'none';
            }

            return h(
              'div',
              { class: 'split-row', dataset: { off: on ? '' : '1' } },
              checkbox(on, toggle),
              avatarNode(m, 26),
              h('div', { class: 'grow ellipsis', style: { fontWeight: '600', fontSize: '0.93rem' }, text: m.name }),
              input,
              on
                ? h(
                    'div',
                    { style: { textAlign: 'right', flex: 'none', minWidth: '78px' } },
                    value,
                    h('div', { class: 'tiny muted', style: { lineHeight: '1.2' } }, sub),
                  )
                : null,
            );
          }),
        ),
      );
    };

    render();
    return holder;
  }

  // ----------------------------------------------------------------- sheet

  const ctx = openSheet({
    title: existing ? 'Edit expense' : 'Add expense',
    subtitle: group.name,
    full: true,
    render: () => {
      nodes.total = h('b', { class: 'num', style: { fontSize: '1.08rem' } }, '--');
      nodes.totalHint = h('span', { class: 'tiny muted' });
      nodes.banner = h('div', { class: 'banner', style: { display: 'none' } });

      const body = h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'card' },
          h('span', { class: 'field__label', text: 'Amount before tax' }),
          moneyInput({
            currency: code,
            value: draft.subtotal,
            size: 'big',
            autofocus: !existing,
            onChange: (v) => {
              draft.subtotal = v ?? 0;
              recompute();
            },
          }),
          h('input', {
            class: 'input',
            style: { marginTop: '10px' },
            placeholder: 'What was it for?',
            value: draft.description,
            onInput: (e) => {
              draft.description = e.target.value;
              recompute();
            },
          }),
          h('input', {
            class: 'input',
            type: 'date',
            style: { marginTop: '10px' },
            value: draft.date,
            onInput: (e) => {
              draft.date = e.target.value || toDateKey(new Date());
            },
          }),
        ),

        h('div', { class: 'section-title', text: 'Taxes & fees' }),
        taxesSection(),

        h('div', { class: 'section-title', text: 'Discounts' }),
        discountsSection(),

        roundOffSection(),

        h(
          'div',
          { class: 'card row row--between' },
          h('div', {}, h('div', { style: { fontWeight: '650' } }, 'Total'), nodes.totalHint),
          nodes.total,
        ),

        h('div', { class: 'section-title', text: 'Paid by' }),
        payersSection(),

        h('div', { class: 'section-title', text: 'Split between' }),
        h(
          'div',
          { class: 'tiny muted', style: { margin: '-4px 2px 6px' } },
          'Shares below are of the pre-tax amount. Taxes, fees and any round-off are added on top automatically.',
        ),
        splitSection(),

        h(
          'label',
          { class: 'field', style: { marginTop: '8px' } },
          h('span', { class: 'field__label', text: 'Note (optional)' }),
          h('textarea', {
            class: 'input',
            placeholder: 'Anything worth remembering',
            value: draft.notes || '',
            onInput: (e) => {
              draft.notes = e.target.value;
            },
          }),
        ),

        nodes.banner,
      );
      setTimeout(recompute, 0);
      return body;
    },
    footer: () => {
      const save = h(
        'button',
        {
          class: 'btn btn--primary grow',
          onClick: async () => {
            recompute();
            const list = problems();
            if (list.length) {
              // The banner says it all; a toast on top would just repeat it.
              showErrors = true;
              renderBanner();
              nodes.banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
            // Catch the same bill being entered twice before it lands.
            const twins = findLookalikes(groupId, draft);
            if (twins.length) {
              const twin = twins[0];
              const ok = await confirmSheet({
                title: 'Add this anyway?',
                message: `“${twin.description}” for ${fmt(computed.total, code)} on ${fmtDateLong(twin.date)} is already in this group. Add a second one?`,
                confirmLabel: 'Add anyway',
              });
              if (!ok) return;
            }
            await saveExpense(draft);
            ctx.close();
            toast(existing ? 'Expense updated' : 'Expense added', 'good');
            onSaved?.();
          },
        },
        existing ? 'Save changes' : 'Add expense',
      );
      const buttons = [];
      if (existing) {
        buttons.push(
          h(
            'button',
            {
              class: 'btn btn--danger',
              'aria-label': 'Delete expense',
              onClick: async () => {
                const ok = await confirmSheet({
                  title: 'Delete this expense?',
                  message: 'Balances will be recalculated straight away.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) return;
                await deleteExpense(draft.id);
                ctx.close();
                toast('Expense deleted');
                onSaved?.();
              },
            },
            icon('trash', 18),
          ),
        );
      }
      buttons.push(save);
      return buttons;
    },
  });
}

function signed(minor, code) {
  return (minor < 0 ? '−' : '+') + fmt(Math.abs(minor), code);
}

function leftOver(error, mode, code) {
  const delta = error.delta;
  if (mode === 'percent') return `${Math.abs(delta).toFixed(2)}% ${delta > 0 ? 'left' : 'over'}`;
  return `${fmt(Math.abs(delta), code)} ${delta > 0 ? 'left' : 'over'}`;
}
