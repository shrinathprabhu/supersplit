// Numbers behind the charts. Everything here is derived from the ledgers, so
// it always agrees with the balances shown elsewhere.

import { toDateKey } from './split.js';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Continuous list of day keys, oldest first. */
export function dayRange(fromKey, toKey) {
  const out = [];
  let cursor = new Date(fromKey + 'T00:00:00');
  const end = new Date(toKey + 'T00:00:00');
  let guard = 800;
  while (cursor <= end && guard-- > 0) {
    out.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * Daily spend for one group: what the group spent, and what the person
 * marked as "you" was on the hook for.
 *
 * The window runs from the first expense to the last, so the chart covers
 * exactly the stretch the group was actually being used, with no empty run
 * of days tacked on either end.
 */
export function groupDaily(ledger) {
  const dates = ledger.expenses.map((e) => e.date).sort();
  if (!dates.length) return { points: [], total: 0, mine: 0, peak: null, perDay: 0, from: null, to: null };

  const start = dates[0];
  const end = dates[dates.length - 1];

  const totals = new Map();
  const mine = new Map();
  const meId = ledger.group.meId;
  for (const expense of ledger.expenses) {
    const c = ledger.computed.get(expense.id);
    totals.set(expense.date, (totals.get(expense.date) || 0) + c.total);
    if (meId) mine.set(expense.date, (mine.get(expense.date) || 0) + (c.owed[meId] || 0));
  }

  const keys = dayRange(start, end);
  const points = keys.map((date) => ({ date, values: [totals.get(date) || 0, mine.get(date) || 0] }));
  const total = points.reduce((a, p) => a + p.values[0], 0);
  const mineTotal = points.reduce((a, p) => a + p.values[1], 0);
  const peak = points.reduce((best, p) => (best === null || p.values[0] > best.values[0] ? p : best), null);
  return {
    points,
    total,
    mine: mineTotal,
    peak,
    perDay: points.length ? Math.round(total / points.length) : 0,
    from: start,
    to: end,
    hasMe: !!meId,
  };
}

/** Daily spend across every group, in the currency each group uses. */
export function allGroupsDaily(groups, ledgerFor, { days = 30 } = {}) {
  const today = toDateKey(new Date());
  const start = toDateKey(addDays(new Date(), -(days - 1)));
  const totals = new Map();
  let any = false;
  for (const group of groups) {
    const ledger = ledgerFor(group.id);
    if (!ledger) continue;
    for (const expense of ledger.expenses) {
      if (expense.date < start || expense.date > today) continue;
      const c = ledger.computed.get(expense.id);
      totals.set(expense.date, (totals.get(expense.date) || 0) + c.total);
      any = true;
    }
  }
  const points = dayRange(start, today).map((date) => ({ date, values: [totals.get(date) || 0] }));
  const total = points.reduce((a, p) => a + p.values[0], 0);
  return { points, total, any, perDay: points.length ? Math.round(total / points.length) : 0 };
}

export function monthKey(dateKey) {
  return String(dateKey).slice(0, 7);
}

/**
 * Per-group spend, both for the current month and as a monthly average over
 * the months the group has actually been used.
 */
export function groupTotals(groups, ledgerFor) {
  const thisMonth = monthKey(toDateKey(new Date()));
  return groups
    .map((group) => {
      const ledger = ledgerFor(group.id);
      if (!ledger) return null;
      let month = 0;
      let all = 0;
      const months = new Set();
      for (const expense of ledger.expenses) {
        const c = ledger.computed.get(expense.id);
        all += c.total;
        months.add(monthKey(expense.date));
        if (monthKey(expense.date) === thisMonth) month += c.total;
      }
      return {
        group,
        month,
        all,
        months: months.size,
        average: months.size ? Math.round(all / months.size) : 0,
      };
    })
    .filter(Boolean);
}

/** True when every group in the list shares one currency. */
export function sharedCurrency(groups) {
  const codes = new Set(groups.map((g) => g.currency));
  return codes.size === 1 ? [...codes][0] : null;
}
