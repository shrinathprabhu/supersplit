// Turns one expense record into exact per-person numbers: what each person
// put in, and what each person consumed (their share of the pre-tax amount
// plus their share of every tax/fee attached to it).

import { allocateFair, allocateEqualFair, roundHalfUp, unitScale } from './money.js';

export const PAYER_MODES = ['equal', 'amount', 'percent'];
export const SPLIT_MODES = ['equal', 'amount', 'percent', 'shares'];

/**
 * A running record of who has picked up the odd paisa so far.
 *
 * Rounding one bill is exact, but a run of bills that each leave a unit over
 * will quietly pile those units on the same person. Threading one of these
 * through a group's expenses, oldest first, hands the next leftover to
 * whoever is furthest behind, so the totals come out even whenever the
 * arithmetic allows it.
 */
export function makeCarry(seed = null) {
  const ledgers = new Map();
  if (seed) {
    for (const [name, entries] of Object.entries(seed)) ledgers.set(name, new Map(Object.entries(entries)));
  }
  const of = (name) => {
    if (!ledgers.has(name)) ledgers.set(name, new Map());
    return ledgers.get(name);
  };
  return {
    vector(name, ids) {
      const ledger = of(name);
      return ids.map((id) => ledger.get(id) || 0);
    },
    settle(name, ids, drift) {
      const ledger = of(name);
      ids.forEach((id, i) => ledger.set(id, (ledger.get(id) || 0) + drift[i]));
    },
    /** Plain copy, so a screen can replay from the same starting point. */
    snapshot() {
      const out = {};
      for (const [name, ledger] of ledgers) out[name] = Object.fromEntries(ledger);
      return out;
    },
  };
}

export function blankExpense(groupId, memberIds = []) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    groupId,
    description: '',
    notes: '',
    date: toDateKey(now),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    subtotal: 0,
    taxes: [],
    // Money off the bill. `stage` decides whether it comes off before tax is
    // worked out or off the final total, and `members` limits it to the
    // people it actually applies to.
    discounts: [],
    // Shops round the printed total (₹103.33 -> ₹103 or ₹104). `mode` picks
    // how; `total` holds the exact printed figure when mode is 'exact'.
    roundOff: { enabled: false, mode: 'nearest', total: null },
    // Nobody is assumed to have paid. The user picks.
    payers: { mode: 'equal', members: [], values: {} },
    split: { mode: 'equal', members: [...memberIds], values: {} },
  };
}

export function newTax(label = 'Tax') {
  return {
    id: crypto.randomUUID(),
    label,
    kind: 'percent', // 'percent' of the pre-tax amount, or a flat 'amount'
    value: 0,
    mode: 'proportional', // or 'equal'. How the tax is spread over people
  };
}

export function newDiscount(label = 'Discount') {
  return {
    id: crypto.randomUUID(),
    label,
    kind: 'percent', // 'percent' of what it applies to, or a flat 'amount'
    value: 0,
    stage: 'pre', // 'pre' comes off before tax, 'post' off the final total
    mode: 'proportional', // or 'equal', how it is shared out
    members: [], // empty means everyone in the split
  };
}

export function toDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** Each tax resolved to an integer minor-unit amount. */
/** Nearest whole currency unit, the GST rule: 50 paise and over rounds up. */
export function nearestUnit(minor, code) {
  const scale = unitScale(code);
  if (scale <= 1) return minor;
  return roundHalfUp(minor / scale) * scale;
}

/** Always up to the next whole unit, what a lot of shops actually do. */
export function ceilUnit(minor, code) {
  const scale = unitScale(code);
  if (scale <= 1) return minor;
  return Math.ceil(minor / scale) * scale;
}

/** Where the round-off lands, given the mode the user picked. */
export function roundTarget(rawTotal, roundOff, code) {
  if (roundOff?.mode === 'up') return ceilUnit(rawTotal, code);
  if (roundOff?.mode === 'exact') {
    const value = roundOff.total;
    return value === null || value === undefined ? nearestUnit(rawTotal, code) : Math.trunc(value);
  }
  return nearestUnit(rawTotal, code);
}

/**
 * The adjustment that turns the computed total into the total actually
 * printed on the bill.
 */
export function resolveRounding(expense, rawTotal, code) {
  const ro = expense.roundOff;
  if (!ro || !ro.enabled) return { enabled: false, mode: 'nearest', target: rawTotal, amount: 0 };
  const target = roundTarget(rawTotal, ro, code);
  return { enabled: true, mode: ro.mode || 'nearest', target, amount: target - rawTotal };
}

export function taxAmounts(subtotal, taxes = []) {
  return taxes.map((t) => ({
    ...t,
    amount:
      t.kind === 'percent'
        ? roundHalfUp((subtotal * (Number(t.value) || 0)) / 100)
        : Math.trunc(Number(t.value) || 0),
  }));
}

function weightsFor(mode, members, values) {
  return members.map((id) => {
    const v = Number(values?.[id]);
    return Number.isFinite(v) ? v : 0;
  });
}

function positive(weights) {
  const clipped = weights.map((w) => (w > 0 ? w : 0));
  return clipped.some((w) => w > 0) ? clipped : null;
}

/**
 * Who put money in. Returns { byMember, errors } where byMember sums exactly
 * to `total`.
 */
export function resolvePayers(expense, total, carry) {
  const { mode, members, values } = expense.payers;
  const byMember = {};
  const errors = [];
  if (!members.length) {
    errors.push({ field: 'payers', code: 'empty', message: 'Add at least one person who paid.' });
    return { byMember, errors };
  }
  if (members.length === 1) {
    byMember[members[0]] = total;
    return { byMember, errors };
  }
  if (mode === 'equal') {
    const { parts, drift } = allocateEqualFair(total, members.length, carry.vector('paid', members));
    carry.settle('paid', members, drift);
    members.forEach((id, i) => (byMember[id] = parts[i]));
    return { byMember, errors };
  }
  if (mode === 'amount') {
    const w = weightsFor(mode, members, values);
    const entered = w.reduce((a, b) => a + b, 0);
    members.forEach((id, i) => (byMember[id] = Math.trunc(w[i])));
    if (entered !== total) {
      errors.push({
        field: 'payers',
        code: 'sum',
        message: 'Paid amounts must add up to the total.',
        delta: total - entered,
        entered,
        expected: total,
      });
    }
    return { byMember, errors };
  }
  // percent
  const w = weightsFor(mode, members, values);
  const entered = w.reduce((a, b) => a + b, 0);
  const { parts, drift } = allocateFair(total, positive(w) || w.map(() => 1), carry.vector('paid', members));
  carry.settle('paid', members, drift);
  members.forEach((id, i) => (byMember[id] = parts[i]));
  if (Math.abs(entered - 100) > 0.005) {
    errors.push({
      field: 'payers',
      code: 'sum',
      message: 'Paid percentages must add up to 100%.',
      delta: 100 - entered,
      entered,
      expected: 100,
    });
  }
  return { byMember, errors };
}

/**
 * Who consumed what. Splits the pre-tax amount by the chosen rule, then
 * spreads every tax over the same people, proportionally to their pre-tax
 * share by default, so taxes land on whoever actually ordered the expensive
 * thing, or equally when the tax is a flat per-head fee.
 */
/** Who a discount applies to, in group order. Empty means everyone. */
function discountTargets(discount, members) {
  const wanted = discount.members || [];
  if (!wanted.length) return [...members];
  const set = new Set(wanted);
  return members.filter((id) => set.has(id));
}

/**
 * Take one round of discounts off whatever each person currently owes.
 *
 * A percentage is a percentage of what the discount actually applies to: the
 * combined amount owed by the people named on it, not the whole bill. So
 * "20% off my dish" comes off that dish, and a discount for everyone comes
 * off everything.
 */
function applyDiscounts(discounts, stage, ctx) {
  const detail = [];
  let total = 0;

  for (const discount of discounts) {
    if ((discount.stage || 'pre') !== stage) continue;
    const targets = discountTargets(discount, ctx.members);
    if (!targets.length) continue;

    const base = targets.reduce((a, id) => a + Math.max(0, ctx.remaining[id] || 0), 0);
    const amount =
      discount.kind === 'percent'
        ? roundHalfUp((base * (Number(discount.value) || 0)) / 100)
        : Math.trunc(Number(discount.value) || 0);

    const per = {};
    if (amount !== 0) {
      const weights = targets.map((id) => Math.max(0, ctx.remaining[id] || 0));
      const spread = discount.mode === 'equal' || !weights.some((w) => w > 0);
      const out = spread
        ? allocateEqualFair(amount, targets.length, ctx.ledger(targets))
        : allocateFair(amount, weights, ctx.ledger(targets));
      // Money off means owing less, so the fairness ledger moves the other
      // way from a tax.
      ctx.settle(targets, out.drift.map((d) => -d));
      targets.forEach((id, i) => {
        per[id] = out.parts[i];
        ctx.remaining[id] -= out.parts[i];
      });
    } else {
      for (const id of targets) per[id] = 0;
    }

    detail.push({
      discountId: discount.id,
      label: discount.label,
      stage,
      kind: discount.kind,
      value: discount.value,
      mode: discount.mode,
      amount,
      base,
      per,
      members: targets,
      everyone: !(discount.members || []).length,
    });
    total += amount;
  }

  return { detail, total };
}

/**
 * Who consumed what. Splits the pre-tax amount by the chosen rule, takes off
 * any before-tax discounts, spreads every tax over what is left, then takes
 * off any after-tax discounts.
 */
export function resolveSplit(expense, carry) {
  const { mode, members, values } = expense.split;
  const errors = [];
  // Pre-tax share, discounts, tax and the round-off all land on one ledger,
  // because what a person owes is the sum of them.
  const share = () => carry.vector('owed', members);
  const keep = (drift) => carry.settle('owed', members, drift);
  const preTax = {};
  const taxByMember = {};
  const discountByMember = {};
  const taxDetail = [];
  const owed = {};

  const empty = {
    preTax,
    taxByMember,
    discountByMember,
    taxDetail,
    discountDetail: [],
    discountTotals: { pre: 0, post: 0 },
    taxes: taxAmounts(0, expense.taxes),
    taxTotal: 0,
    taxableTotal: 0,
    owed,
    errors,
  };
  if (!members.length) {
    errors.push({ field: 'split', code: 'empty', message: 'Pick at least one person to split between.' });
    return empty;
  }

  let parts;
  if (mode === 'equal') {
    const out = allocateEqualFair(expense.subtotal, members.length, share());
    keep(out.drift);
    parts = out.parts;
  } else if (mode === 'amount') {
    const w = weightsFor(mode, members, values);
    const entered = w.reduce((a, b) => a + b, 0);
    parts = w.map((v) => Math.trunc(v));
    if (entered !== expense.subtotal) {
      errors.push({
        field: 'split',
        code: 'sum',
        message: 'Split amounts must add up to the pre-tax amount.',
        delta: expense.subtotal - entered,
        entered,
        expected: expense.subtotal,
      });
    }
  } else if (mode === 'percent') {
    const w = weightsFor(mode, members, values);
    const entered = w.reduce((a, b) => a + b, 0);
    const out = allocateFair(expense.subtotal, positive(w) || w.map(() => 1), share());
    keep(out.drift);
    parts = out.parts;
    if (Math.abs(entered - 100) > 0.005) {
      errors.push({
        field: 'split',
        code: 'sum',
        message: 'Split percentages must add up to 100%.',
        delta: 100 - entered,
        entered,
        expected: 100,
      });
    }
  } else {
    // shares
    const w = weightsFor(mode, members, values);
    const pos = positive(w);
    if (!pos) {
      errors.push({ field: 'split', code: 'sum', message: 'Give at least one person a share.' });
      const out = allocateEqualFair(expense.subtotal, members.length, share());
      keep(out.drift);
      parts = out.parts;
    } else {
      const out = allocateFair(expense.subtotal, pos, share());
      keep(out.drift);
      parts = out.parts;
    }
  }

  const remaining = {};
  members.forEach((id, i) => {
    preTax[id] = parts[i];
    taxByMember[id] = 0;
    discountByMember[id] = 0;
    remaining[id] = parts[i];
  });

  const ctx = {
    members,
    remaining,
    ledger: (ids) => carry.vector('owed', ids),
    settle: (ids, drift) => carry.settle('owed', ids, drift),
  };

  const discounts = expense.discounts || [];
  const before = applyDiscounts(discounts, 'pre', ctx);
  for (const line of before.detail) {
    for (const [id, amount] of Object.entries(line.per)) discountByMember[id] += amount;
  }

  // Tax is worked out on what is left after the before-tax discounts, which
  // is what a bill does, and it follows the discounted amounts too.
  const taxableTotal = members.reduce((a, id) => a + remaining[id], 0);
  const taxes = taxAmounts(taxableTotal, expense.taxes);
  const taxableWeights = members.map((id) => remaining[id]);

  for (const tax of taxes) {
    let out;
    if (tax.mode === 'equal') {
      out = allocateEqualFair(tax.amount, members.length, share());
    } else {
      const pos = positive(taxableWeights);
      out = pos ? allocateFair(tax.amount, pos, share()) : allocateEqualFair(tax.amount, members.length, share());
    }
    keep(out.drift);
    const per = {};
    members.forEach((id, i) => {
      per[id] = out.parts[i];
      taxByMember[id] += out.parts[i];
      remaining[id] += out.parts[i];
    });
    taxDetail.push({ taxId: tax.id, label: tax.label, amount: tax.amount, per });
  }

  const after = applyDiscounts(discounts, 'post', ctx);
  for (const line of after.detail) {
    for (const [id, amount] of Object.entries(line.per)) discountByMember[id] += amount;
  }

  for (const id of members) owed[id] = remaining[id];

  if (members.some((id) => owed[id] < 0)) {
    errors.push({
      field: 'discounts',
      code: 'over',
      message: 'A discount is bigger than the amount it comes off.',
    });
  }

  return {
    preTax,
    taxByMember,
    discountByMember,
    taxDetail,
    discountDetail: [...before.detail, ...after.detail],
    discountTotals: { pre: before.total, post: after.total },
    taxes,
    taxTotal: taxes.reduce((a, t) => a + t.amount, 0),
    taxableTotal,
    owed,
    errors,
  };
}

/** Everything the UI and the exporters need about a single expense. */
export function computeExpense(expense, code = 'INR', carry = makeCarry()) {
  // The split has to come first now: before-tax discounts change what is
  // taxable, and the taxes change the total the payers have to match.
  const split = resolveSplit(expense, carry);
  const rawTotal =
    expense.subtotal - split.discountTotals.pre + split.taxTotal - split.discountTotals.post;
  const rounding = resolveRounding(expense, rawTotal, code);
  const total = rounding.target;

  // The round-off rides along with everyone's share of the bill.
  const roundPer = {};
  const splitIds = expense.split.members;
  if (rounding.amount !== 0 && splitIds.length) {
    const ids = splitIds;
    const weights = ids.map((id) => Math.max(0, split.owed[id] || 0));
    const out = weights.some((w) => w > 0)
      ? allocateFair(rounding.amount, weights, carry.vector('owed', ids))
      : allocateEqualFair(rounding.amount, ids.length, carry.vector('owed', ids));
    carry.settle('owed', ids, out.drift);
    ids.forEach((id, i) => {
      roundPer[id] = out.parts[i];
      split.owed[id] += out.parts[i];
    });
  }

  const { byMember: paid, errors: payerErrors } = resolvePayers(expense, total, carry);

  const errors = [...payerErrors, ...split.errors];
  if (total === 0) {
    errors.push({ field: 'amount', code: 'zero', message: 'Enter an amount.' });
  }
  return {
    id: expense.id,
    subtotal: expense.subtotal,
    taxes: split.taxes,
    taxTotal: split.taxTotal,
    taxableTotal: split.taxableTotal,
    discounts: split.discountDetail,
    discountTotals: split.discountTotals,
    discountTotal: split.discountTotals.pre + split.discountTotals.post,
    rawTotal,
    rounding: { ...rounding, per: roundPer },
    total,
    paid,
    preTax: split.preTax,
    taxByMember: split.taxByMember,
    discountByMember: split.discountByMember,
    taxDetail: split.taxDetail,
    owed: split.owed,
    members: expense.split.members,
    payerIds: expense.payers.members,
    errors,
    valid: errors.length === 0,
  };
}
