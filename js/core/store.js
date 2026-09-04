// Single source of truth. Everything lives in memory for fast rendering and
// is written through to IndexedDB on every change.

import * as db from './db.js';
import { buildLedger, byDateAsc } from './balances.js';
import { newSeed } from './avatar.js';
import { toDateKey, makeCarry, computeExpense } from './split.js';

const listeners = new Set();

export const store = {
  ready: false,
  mode: 'indexeddb',
  groups: [],
  expenses: [],
  payments: [],
  settings: { simplifyDefault: false, lastGroupId: null },
  _rev: 0,
  _ledgers: new Map(),
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  store._rev++;
  store._ledgers.clear();
  for (const fn of listeners) fn(store);
}

export async function init() {
  const info = await db.ready();
  store.mode = info.mode;
  const [groups, expenses, payments, settings] = await Promise.all([
    db.getAll('groups'),
    db.getAll('expenses'),
    db.getAll('payments'),
    db.getAll('settings'),
  ]);
  store.groups = groups.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  store.expenses = expenses;
  store.payments = payments;
  for (const row of settings) store.settings[row.key] = row.value;
  store.ready = true;
  db.requestPersistence();
  emit();
  return store;
}

// ------------------------------------------------------------------ groups

export function getGroup(id) {
  return store.groups.find((g) => g.id === id) || null;
}

export async function createGroup({ name, currency = 'INR', memberNames = [], simplify = false }) {
  const now = new Date().toISOString();
  const group = {
    id: crypto.randomUUID(),
    name: name.trim() || 'New group',
    currency,
    simplify,
    emoji: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    members: memberNames
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => makeMember(n)),
  };
  store.groups.unshift(group);
  await db.put('groups', group);
  await setSetting('lastCurrency', currency);
  emit();
  return group;
}

function makeMember(name) {
  return { id: crypto.randomUUID(), name: name.trim(), avatarSeed: newSeed(name) };
}

export async function updateGroup(id, patch) {
  const group = getGroup(id);
  if (!group) return null;
  Object.assign(group, patch, { updatedAt: new Date().toISOString() });
  await db.put('groups', group);
  emit();
  return group;
}

export async function deleteGroup(id) {
  const expenseIds = store.expenses.filter((e) => e.groupId === id).map((e) => e.id);
  const paymentIds = store.payments.filter((p) => p.groupId === id).map((p) => p.id);
  store.groups = store.groups.filter((g) => g.id !== id);
  store.expenses = store.expenses.filter((e) => e.groupId !== id);
  store.payments = store.payments.filter((p) => p.groupId !== id);
  await Promise.all([
    db.del('groups', id),
    db.delMany('expenses', expenseIds),
    db.delMany('payments', paymentIds),
  ]);
  emit();
}

export async function addMember(groupId, name) {
  const group = getGroup(groupId);
  if (!group) return null;
  const member = makeMember(name);
  group.members.push(member);
  group.updatedAt = new Date().toISOString();
  await db.put('groups', group);
  emit();
  return member;
}

export async function updateMember(groupId, memberId, patch) {
  const group = getGroup(groupId);
  const member = group?.members.find((m) => m.id === memberId);
  if (!member) return null;
  Object.assign(member, patch);
  group.updatedAt = new Date().toISOString();
  await db.put('groups', group);
  emit();
  return member;
}

/** A member can only leave once they appear in nothing. */
export function memberUsage(groupId, memberId) {
  const expenses = expensesFor(groupId).filter(
    (e) => e.payers.members.includes(memberId) || e.split.members.includes(memberId),
  );
  const payments = paymentsFor(groupId).filter((p) => p.from === memberId || p.to === memberId);
  return { expenses: expenses.length, payments: payments.length, blocked: expenses.length + payments.length > 0 };
}

export async function removeMember(groupId, memberId) {
  const group = getGroup(groupId);
  if (!group) return;
  group.members = group.members.filter((m) => m.id !== memberId);
  group.updatedAt = new Date().toISOString();
  await db.put('groups', group);
  emit();
}

// ---------------------------------------------------------------- expenses

export function expensesFor(groupId) {
  return store.expenses.filter((e) => e.groupId === groupId);
}

export function getExpense(id) {
  return store.expenses.find((e) => e.id === id) || null;
}

export async function saveExpense(expense) {
  const record = { ...expense, updatedAt: new Date().toISOString() };
  const idx = store.expenses.findIndex((e) => e.id === record.id);
  if (idx >= 0) store.expenses[idx] = record;
  else store.expenses.push(record);
  await db.put('expenses', record);
  await touchGroup(record.groupId);
  emit();
  return record;
}

export async function deleteExpense(id) {
  const expense = getExpense(id);
  store.expenses = store.expenses.filter((e) => e.id !== id);
  await db.del('expenses', id);
  if (expense) await touchGroup(expense.groupId);
  emit();
}

// ---------------------------------------------------------------- payments

export function paymentsFor(groupId) {
  return store.payments.filter((p) => p.groupId === groupId);
}

export async function addPayment({ groupId, from, to, amount, note = '', date = toDateKey(new Date()) }) {
  const payment = {
    id: crypto.randomUUID(),
    groupId,
    from,
    to,
    amount,
    note,
    date,
    createdAt: new Date().toISOString(),
  };
  store.payments.push(payment);
  await db.put('payments', payment);
  await touchGroup(groupId);
  emit();
  return payment;
}

export async function deletePayment(id) {
  const payment = store.payments.find((p) => p.id === id);
  store.payments = store.payments.filter((p) => p.id !== id);
  await db.del('payments', id);
  if (payment) await touchGroup(payment.groupId);
  emit();
}

async function touchGroup(groupId) {
  const group = getGroup(groupId);
  if (!group) return;
  group.updatedAt = new Date().toISOString();
  await db.put('groups', group);
}

// ------------------------------------------------------------------ ledger

/**
 * The rounding ledger as it stands just before `expense` in a group, so the
 * editor previews the same figures the saved expense will show.
 */
export function carryBefore(groupId, expense) {
  const carry = makeCarry();
  const group = getGroup(groupId);
  if (!group) return carry;
  const earlier = expensesFor(groupId)
    .filter((e) => e.id !== expense.id && byDateAsc(e, expense) < 0)
    .sort(byDateAsc);
  for (const e of earlier) computeExpense(e, group.currency, carry);
  return carry;
}

export function ledgerFor(groupId) {
  if (store._ledgers.has(groupId)) return store._ledgers.get(groupId);
  const group = getGroup(groupId);
  if (!group) return null;
  const ledger = buildLedger(group, expensesFor(groupId), paymentsFor(groupId));
  store._ledgers.set(groupId, ledger);
  return ledger;
}

// ---------------------------------------------------------------- settings

export async function setSetting(key, value) {
  store.settings[key] = value;
  await db.put('settings', { key, value });
  emit();
}

// ------------------------------------------------------------ backup/reset

/** Write a batch of records, replacing anything with the same id. */
export async function applyRecords({ groups = [], expenses = [], payments = [] }) {
  mergeById(store.groups, groups, true);
  mergeById(store.expenses, expenses);
  mergeById(store.payments, payments);
  await Promise.all([
    db.putMany('groups', groups),
    db.putMany('expenses', expenses),
    db.putMany('payments', payments),
  ]);
  emit();
}

function mergeById(target, incoming, front = false) {
  for (const item of incoming) {
    const idx = target.findIndex((x) => x.id === item.id);
    if (idx >= 0) target[idx] = item;
    else if (front) target.unshift(item);
    else target.push(item);
  }
}

export async function resetEverything() {
  await db.clearAll();
  store.groups = [];
  store.expenses = [];
  store.payments = [];
  store.settings = { simplifyDefault: false, lastGroupId: null };
  emit();
}
