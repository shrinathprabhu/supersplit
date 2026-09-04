// Reviewing an import before anything is written: what is new, what clashes
// with a record already here, and what looks like the same bill twice.

import { h, fmtDate } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './shell.js';
import { segmented } from './components.js';
import { fmt } from '../core/money.js';
import { readPayload, planImport, resolveImport, summarise } from '../core/transfer.js';
import { applyRecords } from '../core/store.js';
import { computeExpense } from '../core/split.js';

/** Ask for a file, then show what importing it would do. */
export function pickImportFile({ expect = null, onDone } = {}) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let payload;
    try {
      payload = readPayload(await file.text());
    } catch (err) {
      toast(err.message || 'That file could not be read', 'bad');
      return;
    }
    if (expect && payload.kind !== expect) {
      const what = payload.kind === 'group' ? 'a single group' : 'a whole profile';
      toast(`That file holds ${what}. Importing it anyway.`);
    }
    openImportReview(payload, onDone);
  });
  document.body.appendChild(input);
  input.click();
}

function describeExpense(expense, code) {
  const c = computeExpense(expense, code);
  return `${fmt(c.total, code)} · ${fmtDate(expense.date)}`;
}

function describeItem(item, code) {
  if (item.type === 'payment') {
    const p = item.incoming;
    return `${fmt(p.amount, code)} · ${fmtDate(p.date)}`;
  }
  return describeExpense(item.incoming, code);
}

function itemTitle(item) {
  return item.type === 'payment' ? 'Settlement' : item.incoming.description || 'Expense';
}

export function openImportReview(payload, onDone) {
  const plan = planImport(payload);
  const needsChoice = plan.groups.flatMap((g) => g.items.filter((i) => i.status === 'conflict' || i.status === 'duplicate'));

  const ctx = openSheet({
    title: plan.kind === 'group' ? 'Import a group' : 'Import a profile',
    subtitle: payload.exportedAt ? `Backed up ${fmtDate(payload.exportedAt.slice(0, 10))}` : undefined,
    full: needsChoice.length > 0,
    render: () => {
      const body = h('div', { class: 'stack' });

      body.appendChild(
        h(
          'div',
          { class: 'card' },
          h('div', { style: { fontWeight: '650' }, text: plan.groups.map((g) => g.incoming.name).join(', ') }),
          h('div', { class: 'small muted', style: { marginTop: '4px' }, text: summarise(plan) }),
        ),
      );

      for (const entry of plan.groups) {
        if (entry.status === 'new') {
          body.appendChild(
            h('div', { class: 'banner banner--good' }, `“${entry.incoming.name}” is not on this device yet, so it comes in whole.`),
          );
        } else if (entry.newMembers.length) {
          body.appendChild(
            h(
              'div',
              { class: 'banner banner--info' },
              `${entry.newMembers.map((m) => m.name).join(', ')} will be added to “${entry.existing.name}”.`,
            ),
          );
        }
      }

      const conflicts = needsChoice.filter((i) => i.status === 'conflict');
      const dupes = needsChoice.filter((i) => i.status === 'duplicate');

      if (conflicts.length) {
        body.appendChild(h('div', { class: 'section-title', text: 'Changed on both sides' }));
        body.appendChild(
          h('p', { class: 'tiny muted', style: { margin: '-6px 2px 6px' } }, 'These exist here already but the details differ. Pick the copy to keep.'),
        );
        for (const item of conflicts) body.appendChild(conflictCard(item, groupCodeFor(plan, item)));
      }

      if (dupes.length) {
        body.appendChild(h('div', { class: 'section-title', text: 'Possible duplicates' }));
        body.appendChild(
          h('p', { class: 'tiny muted', style: { margin: '-6px 2px 6px' } }, 'Same day, same name, same amount, but recorded separately. Skipping is usually right.'),
        );
        for (const item of dupes) body.appendChild(duplicateCard(item, groupCodeFor(plan, item)));
      }

      if (!needsChoice.length && plan.counts.added === 0 && plan.counts.newGroups === 0) {
        body.appendChild(h('div', { class: 'banner banner--good' }, 'Everything in this file is already on this device.'));
      }

      return body;
    },
    footer: () => [
      h(
        'button',
        {
          class: 'btn btn--primary btn--block',
          onClick: async () => {
            const records = resolveImport(plan);
            const count = records.groups.length + records.expenses.length + records.payments.length;
            if (!count) {
              ctx.close();
              toast('Nothing to bring in');
              return;
            }
            await applyRecords(records);
            ctx.close();
            toast(`Imported ${records.expenses.length + records.payments.length} ${records.expenses.length + records.payments.length === 1 ? 'entry' : 'entries'}`, 'good');
            onDone?.();
          },
        },
        icon('download', 18),
        'Import',
      ),
    ],
  });
}

function groupCodeFor(plan, item) {
  const entry = plan.groups.find((g) => g.items.includes(item));
  return entry?.existing?.currency || entry?.incoming?.currency || 'INR';
}

function conflictCard(item, code) {
  const chosen = h('div', { class: 'tiny muted', style: { marginTop: '8px' } });
  const paint = () => {
    chosen.textContent =
      item.choice === 'theirs' ? 'Keeping the version from the file.' : 'Keeping the version already on this device.';
  };
  paint();
  return h(
    'div',
    { class: 'card' },
    h('div', { style: { fontWeight: '650' }, text: itemTitle(item) }),
    h(
      'div',
      { class: 'stack stack--sm', style: { marginTop: '10px' } },
      versionRow('On this device', item.existing, item.type, code),
      versionRow('In the file', item.incoming, item.type, code),
    ),
    h(
      'div',
      { style: { marginTop: '10px' } },
      segmented(
        [
          { value: 'mine', label: 'Keep mine' },
          { value: 'theirs', label: 'Use theirs' },
        ],
        item.choice,
        (v) => {
          item.choice = v;
          paint();
        },
        { small: true },
      ),
    ),
    chosen,
  );
}

function duplicateCard(item, code) {
  const chosen = h('div', { class: 'tiny muted', style: { marginTop: '8px' } });
  const paint = () => {
    chosen.textContent = item.choice === 'skip' ? 'Leaving the one already here.' : 'Both will be kept as separate entries.';
  };
  paint();
  return h(
    'div',
    { class: 'card' },
    h('div', { style: { fontWeight: '650' }, text: itemTitle(item) }),
    h('div', { class: 'small muted', style: { marginTop: '2px' }, text: describeItem(item, code) }),
    h(
      'div',
      { style: { marginTop: '10px' } },
      segmented(
        [
          { value: 'skip', label: 'Skip it' },
          { value: 'both', label: 'Keep both' },
        ],
        item.choice,
        (v) => {
          item.choice = v;
          paint();
        },
        { small: true },
      ),
    ),
    chosen,
  );
}

function versionRow(label, record, type, code) {
  const detail =
    type === 'payment'
      ? `${fmt(record.amount, code)} · ${fmtDate(record.date)}`
      : `${record.description || 'Expense'} · ${describeExpense(record, code)}`;
  return h(
    'div',
    { class: 'split-row' },
    h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'tiny muted', text: label }), h('div', { class: 'small ellipsis', text: detail })),
  );
}
