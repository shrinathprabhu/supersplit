// Money handling. Every amount in the app is stored as an integer number of
// minor units (paise / cents) so that arithmetic is always exact.

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', decimals: 2, name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', decimals: 2, name: 'US Dollar' },
  { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' },
  { code: 'GBP', symbol: '£', decimals: 2, name: 'British Pound' },
  { code: 'AED', symbol: 'AED ', decimals: 2, name: 'UAE Dirham' },
  { code: 'AUD', symbol: 'A$', decimals: 2, name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', decimals: 2, name: 'Canadian Dollar' },
  { code: 'SGD', symbol: 'S$', decimals: 2, name: 'Singapore Dollar' },
  { code: 'JPY', symbol: '¥', decimals: 0, name: 'Japanese Yen' },
  { code: 'CNY', symbol: 'CN¥', decimals: 2, name: 'Chinese Yuan' },
  { code: 'CHF', symbol: 'CHF ', decimals: 2, name: 'Swiss Franc' },
  { code: 'SEK', symbol: 'kr ', decimals: 2, name: 'Swedish Krona' },
  { code: 'NZD', symbol: 'NZ$', decimals: 2, name: 'New Zealand Dollar' },
  { code: 'ZAR', symbol: 'R ', decimals: 2, name: 'South African Rand' },
  { code: 'BRL', symbol: 'R$', decimals: 2, name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'MX$', decimals: 2, name: 'Mexican Peso' },
  { code: 'IDR', symbol: 'Rp ', decimals: 2, name: 'Indonesian Rupiah' },
  { code: 'MYR', symbol: 'RM ', decimals: 2, name: 'Malaysian Ringgit' },
  { code: 'THB', symbol: '฿', decimals: 2, name: 'Thai Baht' },
  { code: 'PHP', symbol: '₱', decimals: 2, name: 'Philippine Peso' },
  { code: 'VND', symbol: '₫', decimals: 0, name: 'Vietnamese Dong' },
  { code: 'KRW', symbol: '₩', decimals: 0, name: 'South Korean Won' },
  { code: 'LKR', symbol: 'Rs ', decimals: 2, name: 'Sri Lankan Rupee' },
  { code: 'NPR', symbol: 'NRs ', decimals: 2, name: 'Nepalese Rupee' },
  { code: 'PKR', symbol: 'PKR ', decimals: 2, name: 'Pakistani Rupee' },
  { code: 'BDT', symbol: '৳', decimals: 2, name: 'Bangladeshi Taka' },
  { code: 'SAR', symbol: 'SAR ', decimals: 2, name: 'Saudi Riyal' },
  { code: 'QAR', symbol: 'QAR ', decimals: 2, name: 'Qatari Riyal' },
  { code: 'TRY', symbol: '₺', decimals: 2, name: 'Turkish Lira' },
  { code: 'PLN', symbol: 'zł ', decimals: 2, name: 'Polish Zloty' },
  { code: 'NOK', symbol: 'kr ', decimals: 2, name: 'Norwegian Krone' },
  { code: 'DKK', symbol: 'kr ', decimals: 2, name: 'Danish Krone' },
  { code: 'HKD', symbol: 'HK$', decimals: 2, name: 'Hong Kong Dollar' },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currency(code) {
  return BY_CODE.get(code) || BY_CODE.get('INR');
}

/** 10^decimals for a currency code. */
export function unitScale(code) {
  return Math.pow(10, currency(code).decimals);
}

/** Round half away from zero, the intuitive behaviour for money. */
export function roundHalfUp(n) {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/**
 * Parse non-negative user input ("1,234.50", "12", ".5") into minor units.
 * Extra decimal places are rounded half up instead of truncated. Returns
 * null when the string is not a usable, safely representable amount.
 */
export function parseAmount(input, code) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[,\s ]/g, '');
  if (raw === '' || raw === '.') return null;
  if (!/^\d*\.?\d*$/.test(raw)) return null;

  const decimals = currency(code).decimals;
  const [whole = '', fraction = ''] = raw.split('.');
  if (!whole && !fraction) return null;

  const scale = BigInt(unitScale(code));
  const kept = fraction.slice(0, decimals).padEnd(decimals, '0');
  let minor = BigInt(whole || '0') * scale + BigInt(kept || '0');
  if (fraction.length > decimals && fraction.charCodeAt(decimals) >= 53) minor += 1n;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** Parse a non-negative plain number (percent, share weight). */
export function parseNumber(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[,\s ]/g, '');
  if (raw === '' || raw === '.') return null;
  if (!/^\d*\.?\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Minor units -> plain decimal string, no symbol. ("1234.50") */
export function toDecimalString(minor, code) {
  const d = currency(code).decimals;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  if (d === 0) return sign + String(abs);
  const s = String(abs).padStart(d + 1, '0');
  return sign + s.slice(0, -d) + '.' + s.slice(-d);
}

/** Minor units -> grouped decimal string without symbol. ("1,234.50") */
export function toGroupedString(minor, code) {
  const plain = toDecimalString(minor, code);
  const neg = plain.startsWith('-');
  const body = neg ? plain.slice(1) : plain;
  const [int, frac] = body.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
}

/** Full display string with the currency symbol. */
export function fmt(minor, code, opts = {}) {
  const c = currency(code);
  const neg = minor < 0;
  const body = toGroupedString(Math.abs(minor), code);
  const s = c.symbol + body;
  if (!neg) return s;
  return opts.parens ? '(' + s + ')' : '-' + s;
}

/**
 * Largest-remainder allocation with a fairness ledger.
 *
 * Splits `total` (integer minor units) across `weights` so the parts are whole
 * numbers, keep the right proportions, and add up to exactly `total`.
 *
 * ₹100 between three people cannot come out even, so somebody gets the odd
 * paisa. Leftovers go to the largest fractional remainders first; where those
 * tie, `carry` decides. Pass the running total of how much each recipient has
 * already been over-allocated and the odd unit goes to whoever is furthest
 * behind, so it evens out across a run of bills instead of landing on the
 * first name in the list every time.
 *
 * Returns the parts plus the drift each one introduced, which is what the
 * caller feeds back into `carry`.
 */
export function allocateFair(total, weights, carry = null) {
  const n = weights.length;
  if (n === 0) return { parts: [], drift: [] };
  const sum = weights.reduce((a, b) => a + b, 0);
  const even = sum === 0;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const exact = even ? weights.map(() => abs / n) : weights.map((w) => (abs * w) / sum);
  const base = exact.map((e) => Math.floor(e));
  let remainder = abs - base.reduce((a, b) => a + b, 0);

  // One criterion, not two. A leftover unit goes to whoever ends up furthest
  // behind without it: their accumulated shortfall minus the fraction they
  // are about to lose. With an empty ledger this is exactly largest-remainder
  // ordering; with a ledger it lets an earlier shortfall outweigh a slightly
  // smaller fraction, which is what makes the totals come out even.
  const behind = (i) => (carry ? carry[i] : 0);
  const need = exact.map((e, i) => behind(i) - (e - Math.floor(e)));
  const order = exact
    .map((_, i) => i)
    .sort((a, b) => need[a] - need[b] || a - b);
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    base[order[k]] += 1;
  }

  return {
    parts: base.map((v) => v * sign),
    drift: base.map((v, i) => (v - exact[i]) * sign),
  };
}

/** Just the parts, for callers with no fairness ledger to keep. */
export function allocate(total, weights, carry = null) {
  return allocateFair(total, weights, carry).parts;
}

/** Even split of `total` into `n` integer parts that sum back to `total`. */
export function allocateEqualFair(total, n, carry = null) {
  return allocateFair(total, new Array(n).fill(1), carry);
}

export function sum(list, pick) {
  let t = 0;
  for (const item of list) t += pick ? pick(item) : item;
  return t;
}
