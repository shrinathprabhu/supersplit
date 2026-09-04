// One neutral "document" shape that the text, image and PDF exporters all
// render, so a WhatsApp message and a PDF can never disagree.

import { explainSections } from '../core/balances.js';
import { fmt } from '../core/money.js';
import { fmtDateLong } from '../util/dom.js';

function member(ledger, id) {
  return ledger.group.members.find((m) => m.id === id) || { id, name: 'Unknown', avatarSeed: id };
}

function baseDoc(ledger, mode, kind) {
  return {
    kind,
    mode,
    currency: ledger.group.currency,
    groupName: ledger.group.name,
    generatedAt: new Date(),
    members: ledger.group.members,
  };
}

/** "Who owes whom" for the whole group, the shareable headline. */
export function buildSummaryDoc(ledger, mode) {
  const doc = baseDoc(ledger, mode, 'summary');
  doc.title = ledger.group.name;
  doc.subtitle = mode === 'simplified' ? 'Settle up · simplified' : 'Settle up';
  doc.debts = ledger.debts(mode).map((d) => ({
    from: member(ledger, d.from),
    to: member(ledger, d.to),
    amount: d.amount,
  }));
  doc.balances = ledger.memberIds
    .map((id) => ({ member: member(ledger, id), net: ledger.net[id] || 0 }))
    .sort((a, b) => b.net - a.net);
  doc.stats = [
    { label: 'Total spent', value: fmt(ledger.totalSpend, doc.currency) },
    { label: 'Expenses', value: String(ledger.expenses.length) },
    { label: 'People', value: String(ledger.memberIds.length) },
  ];
  doc.settled = doc.debts.length === 0;
  doc.footerLabel = `${doc.groupName} · settle up`;
  return doc;
}

/** One person's bill: "A owes B ₹x", with the reasoning behind it. */
export function buildReceiptDoc(ledger, from, to, mode) {
  const doc = baseDoc(ledger, mode, 'receipt');
  const explanation = explainSections(ledger, from, to, mode);
  doc.from = member(ledger, from);
  doc.to = member(ledger, to);
  doc.amount = explanation.amount;
  doc.title = `${doc.from.name} → ${doc.to.name}`;
  doc.subtitle = ledger.group.name;
  doc.footerLabel = `${ledger.group.name} · ${doc.from.name} → ${doc.to.name}`;
  doc.note = explanation.note || null;
  doc.sections = explanation.sections;
  doc.totalLabel = explanation.totalLabel;
  doc.stats = [];
  // The detailed (PDF) rendering also shows the bills behind the number.
  const named = new Set(explanation.sections.flatMap((sec) => sec.rows.map((r) => r.label)));
  doc.expenses = ledger.expenses.filter((e) => named.has(e.description)).map((e) => expenseDetail(ledger, e));
  return doc;
}

/** One expense, expanded into everything a statement needs to show. */
export function expenseDetail(ledger, expense) {
  const c = ledger.computed.get(expense.id);
  return {
    id: expense.id,
    description: expense.description || 'Expense',
    date: expense.date,
    dateLong: fmtDateLong(expense.date),
    notes: expense.notes || '',
    subtotal: c.subtotal,
    taxes: c.taxes.map((t) => ({
      label: t.label || 'Tax',
      amount: t.amount,
      kind: t.kind,
      value: t.value,
      mode: t.mode,
    })),
    rounding: c.rounding?.amount || 0,
    total: c.total,
    paidBy: expense.payers.members
      .filter((id) => (c.paid[id] || 0) !== 0)
      .map((id) => ({ member: member(ledger, id), amount: c.paid[id] || 0 })),
    shares: expense.split.members.map((id) => ({
      member: member(ledger, id),
      preTax: c.preTax[id] || 0,
      tax: (c.taxByMember[id] || 0) + (c.rounding?.per?.[id] || 0),
      amount: c.owed[id] || 0,
    })),
    splitMode: expense.split.mode,
    payerMode: expense.payers.mode,
  };
}

/** The long form: every expense, how it was split, and the final position. */
export function buildFullDoc(ledger, mode) {
  const doc = buildSummaryDoc(ledger, mode);
  doc.kind = 'full';
  doc.subtitle = 'Detailed statement';
  doc.footerLabel = `${doc.groupName} · detailed statement`;
  doc.expenses = ledger.expenses.map((expense) => expenseDetail(ledger, expense));
  doc.payments = ledger.payments.map((p) => ({
    from: member(ledger, p.from),
    to: member(ledger, p.to),
    amount: p.amount,
    date: p.date,
    dateLong: fmtDateLong(p.date),
    note: p.note || '',
  }));
  // When a bill does not divide evenly somebody carries the odd paisa, so
  // "equal" shares can end up a unit apart. Worth saying out loud on a
  // statement, since the expense list underneath shows exactly where it went.
  doc.roundingNote = doc.expenses.some(
    (e) => e.splitMode === 'equal' && new Set(e.shares.map((s) => s.amount)).size > 1,
  );
  doc.perPerson = ledger.memberIds.map((id) => ({
    member: member(ledger, id),
    paid: ledger.paid[id] || 0,
    owed: ledger.owed[id] || 0,
    net: ledger.net[id] || 0,
  }));
  return doc;
}

export function docFileName(doc, ext) {
  const slug = (s) =>
    String(s || 'supersplit')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'supersplit';
  const stamp = doc.generatedAt.toISOString().slice(0, 10);
  if (doc.kind === 'receipt') return `${slug(doc.groupName)}-${slug(doc.from.name)}-to-${slug(doc.to.name)}-${stamp}.${ext}`;
  if (doc.kind === 'full') return `${slug(doc.groupName)}-statement-${stamp}.${ext}`;
  return `${slug(doc.groupName)}-settle-up-${stamp}.${ext}`;
}
