// Moving data between browsers: export a whole profile or a single group,
// then import it somewhere else. Everything is keyed by the random ids the
// app already assigns, so re-importing a group you already have merges into
// it instead of making a copy.

import { store, getGroup, expensesFor, paymentsFor } from './store.js';

export const FORMAT_VERSION = 2;

export function exportProfile() {
  return {
    app: 'supersplit',
    kind: 'profile',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    groups: store.groups,
    expenses: store.expenses,
    payments: store.payments,
    settings: store.settings,
  };
}

export function exportGroup(groupId) {
  const group = getGroup(groupId);
  if (!group) throw new Error('That group is gone.');
  return {
    app: 'supersplit',
    kind: 'group',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    groups: [group],
    expenses: expensesFor(groupId),
    payments: paymentsFor(groupId),
  };
}

/** Accepts both shapes, and the version 1 files that had no `kind`. */
export function readPayload(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
  }
  if (!data || data.app !== 'supersplit') throw new Error('That is not a SuperSplit backup file.');
  const groups = data.groups || (data.group ? [data.group] : []);
  if (!groups.length) throw new Error('That backup has no groups in it.');
  return {
    kind: data.kind || (groups.length === 1 ? 'group' : 'profile'),
    exportedAt: data.exportedAt || null,
    groups,
    expenses: data.expenses || [],
    payments: data.payments || [],
    settings: data.settings || null,
  };
}

// ------------------------------------------------------------- comparison

const EXPENSE_FIELDS = ['description', 'notes', 'date', 'subtotal', 'taxes', 'roundOff', 'payers', 'split'];
const PAYMENT_FIELDS = ['from', 'to', 'amount', 'note', 'date'];

function fingerprint(item, fields) {
  return JSON.stringify(fields.map((f) => item[f] ?? null));
}

/** Same bill entered twice with different ids. */
function duplicateKey(item, type) {
  if (type === 'payment') return ['p', item.date, item.from, item.to, item.amount].join('|');
  const total = totalOf(item);
  return ['e', item.date, String(item.description || '').trim().toLowerCase(), total].join('|');
}

function totalOf(expense) {
  const taxes = (expense.taxes || []).reduce(
    (sum, t) => sum + (t.kind === 'percent' ? Math.round((expense.subtotal * (Number(t.value) || 0)) / 100) : Math.trunc(Number(t.value) || 0)),
    0,
  );
  return (expense.subtotal || 0) + taxes;
}

/** Existing expenses in a group that look like the one being added. */
export function findLookalikes(groupId, expense) {
  const key = duplicateKey(expense, 'expense');
  return expensesFor(groupId).filter((e) => e.id !== expense.id && duplicateKey(e, 'expense') === key);
}

// ------------------------------------------------------------------- plan

/**
 * Works out exactly what an import would do, without touching anything.
 * The UI shows this, collects decisions, then calls applyImport.
 */
export function planImport(payload) {
  const plan = {
    kind: payload.kind,
    exportedAt: payload.exportedAt,
    groups: [],
    counts: { groups: 0, newGroups: 0, added: 0, identical: 0, conflicts: 0, duplicates: 0, members: 0 },
  };

  for (const incoming of payload.groups) {
    const existing = getGroup(incoming.id);
    const entry = {
      incoming,
      existing,
      status: existing ? 'merge' : 'new',
      newMembers: [],
      items: [],
    };

    if (existing) {
      const known = new Set(existing.members.map((m) => m.id));
      entry.newMembers = (incoming.members || []).filter((m) => !known.has(m.id));
    }

    const localExpenses = existing ? expensesFor(incoming.id) : [];
    const localPayments = existing ? paymentsFor(incoming.id) : [];
    const byId = new Map([...localExpenses, ...localPayments].map((x) => [x.id, x]));
    const byDup = new Map();
    for (const e of localExpenses) byDup.set(duplicateKey(e, 'expense'), e);
    for (const p of localPayments) byDup.set(duplicateKey(p, 'payment'), p);

    const consider = (item, type) => {
      if (item.groupId !== incoming.id) return;
      const fields = type === 'expense' ? EXPENSE_FIELDS : PAYMENT_FIELDS;
      const mine = byId.get(item.id);
      if (mine) {
        const same = fingerprint(mine, fields) === fingerprint(item, fields);
        entry.items.push({
          key: `${type}:${item.id}`,
          type,
          status: same ? 'identical' : 'conflict',
          incoming: item,
          existing: mine,
          // Default to whichever copy was edited most recently.
          choice: same ? 'skip' : (item.updatedAt || '') >= (mine.updatedAt || '') ? 'theirs' : 'mine',
        });
        return;
      }
      const twin = byDup.get(duplicateKey(item, type));
      if (twin) {
        entry.items.push({
          key: `${type}:${item.id}`,
          type,
          status: 'duplicate',
          incoming: item,
          existing: twin,
          choice: 'skip',
        });
        return;
      }
      entry.items.push({ key: `${type}:${item.id}`, type, status: 'new', incoming: item, existing: null, choice: 'theirs' });
    };

    for (const e of payload.expenses) consider(e, 'expense');
    for (const p of payload.payments) consider(p, 'payment');

    plan.groups.push(entry);
    plan.counts.groups += 1;
    if (!existing) plan.counts.newGroups += 1;
    plan.counts.members += entry.newMembers.length;
    for (const item of entry.items) {
      if (item.status === 'new') plan.counts.added += 1;
      else if (item.status === 'identical') plan.counts.identical += 1;
      else if (item.status === 'conflict') plan.counts.conflicts += 1;
      else if (item.status === 'duplicate') plan.counts.duplicates += 1;
    }
  }

  return plan;
}

/** Everything the import would write, ready to hand to the store. */
export function resolveImport(plan) {
  const groups = [];
  const expenses = [];
  const payments = [];

  for (const entry of plan.groups) {
    if (entry.status === 'new') {
      groups.push({ ...entry.incoming });
    } else if (entry.newMembers.length) {
      groups.push({
        ...entry.existing,
        members: [...entry.existing.members, ...entry.newMembers],
        updatedAt: new Date().toISOString(),
      });
    }

    for (const item of entry.items) {
      const takeTheirs =
        (item.status === 'new' && item.choice !== 'skip') ||
        (item.status === 'conflict' && item.choice === 'theirs') ||
        (item.status === 'duplicate' && item.choice === 'both');
      if (!takeTheirs) continue;
      const record =
        item.status === 'duplicate' && item.choice === 'both'
          ? { ...item.incoming, id: crypto.randomUUID() } // keep both copies apart
          : { ...item.incoming };
      if (item.type === 'expense') expenses.push(record);
      else payments.push(record);
    }
  }

  return { groups, expenses, payments };
}

export function summarise(plan) {
  const bits = [];
  const c = plan.counts;
  if (c.newGroups) bits.push(`${c.newGroups} new ${c.newGroups === 1 ? 'group' : 'groups'}`);
  if (c.members) bits.push(`${c.members} new ${c.members === 1 ? 'person' : 'people'}`);
  if (c.added) bits.push(`${c.added} new ${c.added === 1 ? 'entry' : 'entries'}`);
  if (c.identical) bits.push(`${c.identical} already here`);
  if (c.conflicts) bits.push(`${c.conflicts} ${c.conflicts === 1 ? 'conflict' : 'conflicts'}`);
  if (c.duplicates) bits.push(`${c.duplicates} possible ${c.duplicates === 1 ? 'duplicate' : 'duplicates'}`);
  return bits.length ? bits.join(', ') : 'Nothing new to bring in';
}
