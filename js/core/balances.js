// Group-level ledger: net balances, who-owes-whom (both the literal trail of
// debts and the simplified minimum set of transfers), plus the breakdowns
// that back every exported receipt.

import { computeExpense, makeCarry } from './split.js';

/**
 * Build everything once, so views and exporters share one consistent view of
 * the numbers.
 */
export function buildLedger(group, expenses, payments) {
  const memberIds = group.members.map((m) => m.id);
  const known = new Set(memberIds);

  const computed = new Map();
  const paid = {};
  const owed = {};
  const raw = {}; // raw[a][b] = minor units a owes b, before netting
  const contribs = []; // per-expense pair contributions, for receipts
  const perMemberExpense = new Map(); // memberId -> [{expenseId, paid, owed, net}]

  for (const id of memberIds) {
    paid[id] = 0;
    owed[id] = 0;
    raw[id] = {};
    perMemberExpense.set(id, []);
  }
  const bump = (a, b, amount) => {
    if (!raw[a]) raw[a] = {};
    raw[a][b] = (raw[a][b] || 0) + amount;
  };

  // Work through the group oldest first, so the rounding ledger can even
  // itself out over its life. The list handed back is newest first, which is
  // how every screen shows it.
  const carry = makeCarry();
  const chrono = [...expenses].sort(byDateAsc);
  for (const expense of chrono) computed.set(expense.id, computeExpense(expense, group.currency, carry));

  for (const expense of chrono) {
    const c = computed.get(expense.id);

    for (const [id, amount] of Object.entries(c.paid)) {
      if (known.has(id)) paid[id] += amount;
    }
    for (const [id, amount] of Object.entries(c.owed)) {
      if (known.has(id)) owed[id] += amount;
    }

    for (const id of memberIds) {
      const p = c.paid[id] || 0;
      const o = c.owed[id] || 0;
      if (p || o) {
        perMemberExpense.get(id).push({ expenseId: expense.id, paid: p, owed: o, net: p - o });
      }
    }

    // Spread each person's share across the people who actually paid.
    const payerIds = c.payerIds.filter((id) => known.has(id) && (c.paid[id] || 0) !== 0);
    const payerWeights = payerIds.map((id) => c.paid[id]);
    const totalPaid = payerWeights.reduce((a, b) => a + b, 0);
    if (!payerIds.length || totalPaid === 0) continue;

    for (const owerId of c.members) {
      if (!known.has(owerId)) continue;
      const amount = c.owed[owerId] || 0;
      if (amount <= 0) continue;
      const { parts, drift } = allocateAcross(amount, payerWeights, carry.vector('attribution', payerIds));
      carry.settle('attribution', payerIds, drift);
      payerIds.forEach((payerId, i) => {
        if (payerId === owerId || parts[i] === 0) return;
        bump(owerId, payerId, parts[i]);
        contribs.push({
          expenseId: expense.id,
          from: owerId,
          to: payerId,
          amount: parts[i],
        });
      });
    }
  }

  // Settlements move money the other way.
  const paymentList = [...payments].sort(byDateDesc);
  for (const p of paymentList) {
    if (!known.has(p.from) || !known.has(p.to)) continue;
    bump(p.from, p.to, -p.amount);
  }

  const net = {};
  for (const id of memberIds) net[id] = paid[id] - owed[id];
  for (const p of paymentList) {
    if (!known.has(p.from) || !known.has(p.to)) continue;
    net[p.from] += p.amount;
    net[p.to] -= p.amount;
  }

  const debtsActual = cancelCycles(netPairs(raw, memberIds), memberIds);
  const debtsSimplified = simplify(net, memberIds);

  const totalSpend = chrono.reduce((a, e) => a + (computed.get(e.id)?.total || 0), 0);

  return {
    group,
    expenses: [...chrono].reverse(),
    payments: paymentList,
    memberIds,
    computed,
    paid,
    owed,
    net,
    raw,
    contribs,
    perMemberExpense,
    debtsActual,
    debtsSimplified,
    totalSpend,
    debts(mode) {
      return mode === 'simplified' ? this.debtsSimplified : this.debtsActual;
    },
  };
}

function byDateDesc(a, b) {
  return -byDateAsc(a, b);
}

/** The order the group actually happened in, and a stable one. */
export function byDateAsc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Largest-remainder allocation, local copy to avoid a cycle with money.js.
 * `offset` rotates who picks up the odd unit, so it does not always fall to
 * whoever happens to be first in the list.
 */
function allocateAcross(total, weights, carry) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return { parts: weights.map(() => 0), drift: weights.map(() => 0) };
  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map((e) => Math.floor(e));
  let rem = total - base.reduce((a, b) => a + b, 0);
  const behind = (i) => (carry ? carry[i] : 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || behind(a.i) - behind(b.i) || a.i - b.i);
  for (let k = 0; k < order.length && rem > 0; k++, rem--) base[order[k].i] += 1;
  return { parts: base, drift: base.map((v, i) => v - exact[i]) };
}

/** Cancel mutual debts inside every pair. */
function netPairs(raw, memberIds) {
  const out = [];
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const a = memberIds[i];
      const b = memberIds[j];
      const d = (raw[a]?.[b] || 0) - (raw[b]?.[a] || 0);
      if (d > 0) out.push({ from: a, to: b, amount: d });
      else if (d < 0) out.push({ from: b, to: a, amount: -d });
    }
  }
  return out.sort((x, y) => y.amount - x.amount);
}

/**
 * Strip circular debt: if A owes B, B owes C and C owes A, some of that is
 * money going round in a ring that nobody actually has to move. It shows up
 * after settling in the simplified view, where a payment can be routed to
 * someone you never shared a bill with. Cancelling the rings keeps everyone's
 * net position identical while making sure both views agree on whether
 * anything is still owed.
 */
export function cancelCycles(debts, memberIds) {
  const graph = new Map();
  for (const id of memberIds) graph.set(id, new Map());
  for (const d of debts) {
    if (d.amount <= 0) continue;
    const row = graph.get(d.from) || new Map();
    row.set(d.to, (row.get(d.to) || 0) + d.amount);
    graph.set(d.from, row);
  }

  // Each pass removes at least one edge, so this cannot run away.
  let guard = debts.length + memberIds.length + 4;
  while (guard-- > 0) {
    const cycle = findCycle(graph);
    if (!cycle) break;
    let min = Infinity;
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      min = Math.min(min, graph.get(from).get(to));
    }
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      const left = graph.get(from).get(to) - min;
      if (left > 0) graph.get(from).set(to, left);
      else graph.get(from).delete(to);
    }
  }

  const out = [];
  for (const [from, row] of graph) {
    for (const [to, amount] of row) if (amount > 0) out.push({ from, to, amount });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Any directed cycle in the debt graph, as a list of member ids. */
function findCycle(graph) {
  const state = new Map(); // 0 unvisited, 1 on stack, 2 done
  const parent = new Map();

  for (const start of graph.keys()) {
    if (state.get(start)) continue;
    const stack = [start];
    parent.set(start, null);
    while (stack.length) {
      const node = stack[stack.length - 1];
      if (!state.get(node)) state.set(node, 1);
      let advanced = false;
      for (const next of graph.get(node)?.keys() || []) {
        if (state.get(next) === 1) {
          // Walk back up the parent chain to read the ring off.
          const cycle = [next];
          let cur = node;
          while (cur !== next && cur !== null && cur !== undefined) {
            cycle.push(cur);
            cur = parent.get(cur);
          }
          return cycle.reverse();
        }
        if (!state.get(next)) {
          parent.set(next, node);
          stack.push(next);
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        state.set(node, 2);
        stack.pop();
      }
    }
  }
  return null;
}

/**
 * Minimum-ish cash flow: repeatedly settle the biggest debtor against the
 * biggest creditor. Same idea as Splitwise's "simplify debts": fewer
 * payments overall, but a payment may go to someone you never shared a bill
 * with.
 */
export function simplify(net, memberIds) {
  const debtors = [];
  const creditors = [];
  for (const id of memberIds) {
    const v = net[id] || 0;
    if (v < 0) debtors.push({ id, amount: -v });
    else if (v > 0) creditors.push({ id, amount: v });
  }
  const order = new Map(memberIds.map((id, i) => [id, i]));
  const cmp = (a, b) => b.amount - a.amount || order.get(a.id) - order.get(b.id);
  debtors.sort(cmp);
  creditors.sort(cmp);

  const out = [];
  let i = 0;
  let j = 0;
  // Guard against pathological loops; each step zeroes at least one side.
  let guard = memberIds.length * memberIds.length + 16;
  while (i < debtors.length && j < creditors.length && guard-- > 0) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(d.amount, c.amount);
    if (amount > 0) out.push({ from: d.id, to: c.id, amount });
    d.amount -= amount;
    c.amount -= amount;
    if (d.amount === 0) i++;
    if (c.amount === 0) j++;
  }
  return out.sort((x, y) => y.amount - x.amount);
}

/**
 * Why does `from` owe `to` this much? For the literal view we can point at
 * the exact expenses; for the simplified view the transfer is synthetic, so
 * we explain the debtor's whole position instead.
 */
export function explainDebt(ledger, from, to, mode) {
  if (mode === 'simplified') return explainSimplified(ledger, from, to);
  return explainActual(ledger, from, to);
}

function explainActual(ledger, from, to) {
  const rows = [];
  const byExpense = new Map();
  for (const c of ledger.contribs) {
    if (c.from === from && c.to === to) addRow(byExpense, c.expenseId, c.amount);
    else if (c.from === to && c.to === from) addRow(byExpense, c.expenseId, -c.amount);
  }
  for (const expense of ledger.expenses) {
    const amount = byExpense.get(expense.id);
    if (amount === undefined || amount === 0) continue;
    const c = ledger.computed.get(expense.id);
    // A positive amount means `from` owes `to` for this bill, so `to` is the
    // one who covered it; a negative amount is the same story reversed.
    const payer = amount > 0 ? to : from;
    const debtor = amount > 0 ? from : to;
    rows.push({
      kind: 'expense',
      id: expense.id,
      label: expense.description,
      date: expense.date,
      total: c.total,
      payerId: payer,
      payerName: nameOf(ledger, payer),
      payerPaid: c.paid[payer] || 0,
      debtorId: debtor,
      debtorName: nameOf(ledger, debtor),
      share: c.owed[debtor] || 0,
      amount,
    });
  }
  const settlements = [];
  for (const p of ledger.payments) {
    if (p.from === from && p.to === to) {
      settlements.push({
        kind: 'payment',
        id: p.id,
        label: 'Already settled',
        date: p.date,
        payerName: nameOf(ledger, from),
        debtorName: nameOf(ledger, to),
        amount: -p.amount,
      });
    } else if (p.from === to && p.to === from) {
      settlements.push({
        kind: 'payment',
        id: p.id,
        label: 'Already settled',
        date: p.date,
        payerName: nameOf(ledger, to),
        debtorName: nameOf(ledger, from),
        amount: p.amount,
      });
    }
  }
  const all = [...rows, ...settlements];
  const amount = all.reduce((a, r) => a + r.amount, 0);
  return { mode: 'actual', from, to, rows: all, amount };
}

function addRow(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function explainSimplified(ledger, from, to) {
  const rows = [];
  for (const entry of ledger.perMemberExpense.get(from) || []) {
    const expense = ledger.expenses.find((e) => e.id === entry.expenseId);
    if (!expense) continue;
    const c = ledger.computed.get(expense.id);
    rows.push({
      kind: 'expense',
      id: expense.id,
      label: expense.description,
      date: expense.date,
      total: c.total,
      share: entry.owed,
      paid: entry.paid,
      debtorName: nameOf(ledger, from),
      amount: -entry.net, // positive = adds to what they owe the group
    });
  }
  for (const p of ledger.payments) {
    if (p.from === from) {
      rows.push({ kind: 'payment', id: p.id, label: `Already paid ${nameOf(ledger, p.to)}`, date: p.date, amount: -p.amount });
    } else if (p.to === from) {
      rows.push({ kind: 'payment', id: p.id, label: `Already received from ${nameOf(ledger, p.from)}`, date: p.date, amount: p.amount });
    }
  }
  const amount = -(ledger.net[from] || 0);
  return {
    mode: 'simplified',
    from,
    to,
    rows,
    amount,
    note: 'Simplified: this payment clears part of the overall balance and may not match a bill shared directly with this person.',
  };
}

/**
 * The same explanation, arranged as plain lists instead of signed rows:
 * what one person covered for the other, what came back the other way, and
 * anything already settled. Amounts here are all positive.
 */
export function explainSections(ledger, from, to, mode) {
  const explanation = explainDebt(ledger, from, to, mode);
  const fromName = nameOf(ledger, from);
  const toName = nameOf(ledger, to);
  const sections = [];

  const push = (title, rows) => {
    if (!rows.length) return;
    sections.push({ title, rows, subtotal: rows.reduce((a, r) => a + r.amount, 0) });
  };

  const expenses = explanation.rows.filter((r) => r.kind === 'expense');
  const payments = explanation.rows.filter((r) => r.kind === 'payment');

  if (mode === 'simplified') {
    push(
      `${fromName}'s share of the bills`,
      expenses.filter((r) => r.share > 0).map((r) => ({ label: r.label, date: r.date, amount: r.share })),
    );
    push(
      `Bills ${fromName} paid for`,
      expenses.filter((r) => r.paid > 0).map((r) => ({ label: r.label, date: r.date, amount: r.paid })),
    );
  } else {
    push(
      `Bills ${toName} covered for ${fromName}`,
      expenses
        .filter((r) => r.amount > 0)
        .map((r) => ({ label: r.label, date: r.date, amount: r.amount, partOf: r.amount !== r.share ? r.share : null, of: fromName })),
    );
    push(
      `Bills ${fromName} covered for ${toName}`,
      expenses
        .filter((r) => r.amount < 0)
        .map((r) => ({ label: r.label, date: r.date, amount: -r.amount, partOf: -r.amount !== r.share ? r.share : null, of: toName })),
    );
  }

  push(
    'Already settled',
    payments.map((r) => ({ label: r.amount < 0 ? `${fromName} paid ${toName}` : `${toName} paid ${fromName}`, date: r.date, amount: Math.abs(r.amount) })),
  );

  const owes = explanation.amount >= 0;
  return {
    sections,
    amount: explanation.amount,
    totalLabel: owes ? `${fromName} owes ${toName}` : `${toName} owes ${fromName}`,
    note: explanation.note || null,
    mode,
  };
}

export function nameOf(ledger, id) {
  return ledger.group.members.find((m) => m.id === id)?.name || 'Someone';
}

