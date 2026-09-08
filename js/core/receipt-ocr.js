// Client-side receipt OCR. Tesseract, its worker, WebAssembly core and the
// English model are all vendored, so neither the image nor its text leaves
// this browser.

import { parseAmount, unitScale } from './money.js';

const VENDOR = new URL('../../vendor/tesseract/', import.meta.url);
let libraryPromise = null;

const TOTAL_PATTERNS = [
  [/\bgrand\s*total\b/i, 120],
  [/\bamount\s*(?:due|payable)\b/i, 116],
  [/\b(?:net|final)\s*(?:amount|payable|total)\b/i, 112],
  [/\bbalance\s*due\b/i, 110],
  [/\bbill\s*(?:amount|total)\b/i, 108],
  [/\btotal\s*(?:amount|due|payable)\b/i, 106],
  [/\btotal\b/i, 80],
];

const SUBTOTAL_PATTERN = /\b(?:sub\s*total|subtotal|taxable\s*(?:amount|value)|amount\s*before\s*tax)\b/i;
const TAX_PATTERN = /\b(?:total\s*tax|tax\s*total|c?gst|s?gst|igst|vat|cess|service\s*charge|sales\s*tax|tax)\b/i;
const AGGREGATE_TAX_PATTERN = /\b(?:total\s*(?:tax|gst|vat)|(?:tax|gst|vat)\s*total|taxes\s*&?\s*fees)\b/i;

export async function scanReceiptImage(image, code = 'INR', { signal, onProgress } = {}) {
  if (!(image instanceof Blob)) throw new TypeError('Choose an image file to scan.');
  throwIfAborted(signal);
  onProgress?.({ progress: 0, label: 'Loading scanner' });

  const Tesseract = await loadLibrary();
  throwIfAborted(signal);

  let worker = null;
  const onAbort = () => worker?.terminate();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: new URL('worker.min.js', VENDOR).href,
      corePath: new URL('core', VENDOR).href,
      langPath: new URL('lang', VENDOR).href,
      // The app's CSP deliberately disallows blob workers. The local worker
      // is same-origin and works offline, so a blob wrapper is unnecessary.
      workerBlobURL: false,
      logger: (message) => onProgress?.(progressMessage(message)),
      errorHandler: (error) => console.error('Receipt OCR worker failed', error),
    });
    throwIfAborted(signal);

    const result = await worker.recognize(image);
    throwIfAborted(signal);
    onProgress?.({ progress: 1, label: 'Bill scanned' });
    return {
      text: result.data.text || '',
      confidence: Number(result.data.confidence) || 0,
      ...extractReceiptData(result.data.text || '', code),
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await worker?.terminate().catch(() => {});
  }
}

/** Extract the printed total and a conservative tax breakdown from OCR text. */
export function extractReceiptData(text, code = 'INR') {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const totalMatch = findTotal(lines, code);
  if (!totalMatch) {
    return { total: null, subtotal: null, taxes: [], totalConfidence: 'none' };
  }

  const total = totalMatch.amount;
  const subtotalMatch = bestLineAmount(lines, code, (line) => SUBTOTAL_PATTERN.test(line));
  const candidates = taxCandidates(lines, code, total);
  const breakdown = chooseTaxBreakdown(total, subtotalMatch?.amount ?? null, candidates, code);

  if (!breakdown) {
    return {
      total,
      subtotal: total,
      taxes: [],
      totalConfidence: totalMatch.confidence,
    };
  }

  return {
    total,
    subtotal: breakdown.subtotal,
    taxes: breakdown.taxes.map(({ label, amount }) => ({ label, amount })),
    totalConfidence: totalMatch.confidence,
  };
}

function loadLibrary() {
  if (globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if (libraryPromise) return libraryPromise;

  libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('tesseract.min.js', VENDOR).href;
    script.async = true;
    script.onload = () => {
      if (globalThis.Tesseract?.createWorker) resolve(globalThis.Tesseract);
      else reject(new Error('The receipt scanner could not start.'));
    };
    script.onerror = () => reject(new Error('The receipt scanner could not be loaded.'));
    document.head.appendChild(script);
  }).catch((error) => {
    libraryPromise = null;
    throw error;
  });
  return libraryPromise;
}

function findTotal(lines, code) {
  const matches = [];
  lines.forEach((line, index) => {
    if (SUBTOTAL_PATTERN.test(line) || AGGREGATE_TAX_PATTERN.test(line) || /\b(?:discount|saving|change)\b/i.test(line)) return;

    for (const [pattern, base] of TOTAL_PATTERNS) {
      if (!pattern.test(line)) continue;
      let amount = lastAmount(line, code);
      let distancePenalty = 0;
      if (amount === null) {
        const next = lines[index + 1];
        const withoutCurrencyCode = next?.replace(new RegExp(`\\b${code}\\b`, 'gi'), '');
        if (next && !/[a-z]{3,}/i.test(withoutCurrencyCode)) {
          amount = lastAmount(next, code);
          distancePenalty = 6;
        }
      }
      if (amount !== null && amount > 0) {
        matches.push({
          amount,
          score: base + (index / Math.max(1, lines.length - 1)) * 20 - distancePenalty,
          confidence: 'high',
        });
      }
      break;
    }
  });

  if (matches.length) return matches.sort((a, b) => b.score - a.score)[0];

  // Some thermal receipts lose the TOTAL label while retaining the figure.
  // In that case, use the largest money-looking value in the lower half, but
  // mark it as low confidence so the editor can say "Possible total".
  const fallback = [];
  lines.forEach((line, index) => {
    if (index < Math.floor(lines.length * 0.45)) return;
    if (/\b(?:subtotal|tax|gst|vat|cess|change|cash|tender|card|phone|tel|date|time|invoice|order)\b/i.test(line)) return;
    const amount = lastAmount(line, code);
    if (amount === null || amount <= 0) return;
    const looksMonetary = /[₹$€£¥₫₩₱৳฿]|\d[.,]\d{2}\b/.test(line);
    if (!looksMonetary) return;
    fallback.push({ amount, score: amount + index / lines.length, confidence: 'low' });
  });
  return fallback.sort((a, b) => b.score - a.score)[0] || null;
}

function bestLineAmount(lines, code, predicate) {
  const matches = [];
  lines.forEach((line, index) => {
    if (!predicate(line)) return;
    const amount = lastAmount(line, code);
    if (amount !== null && amount > 0) matches.push({ amount, index });
  });
  return matches.at(-1) || null;
}

function taxCandidates(lines, code, total) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (!TAX_PATTERN.test(line) || /\b(?:tax\s*invoice|tax\s*id|gstin|tin)\b/i.test(line)) continue;
    const token = lastAmountToken(line, code);
    if (!token || token.amount <= 0 || token.amount >= total) continue;
    const label = cleanTaxLabel(line, token) || 'Tax';
    const key = `${label.toLowerCase()}:${token.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, amount: token.amount, aggregate: AGGREGATE_TAX_PATTERN.test(line) });
  }
  return out;
}

function chooseTaxBreakdown(total, printedSubtotal, candidates, code) {
  const tolerance = Math.max(1, unitScale(code));
  if (printedSubtotal !== null && printedSubtotal > 0 && printedSubtotal < total && candidates.length) {
    const expected = total - printedSubtotal;
    const usable = candidates.slice(0, 12);
    let best = null;
    for (let mask = 1; mask < 1 << usable.length; mask += 1) {
      const taxes = usable.filter((_, index) => mask & (1 << index));
      const sum = taxes.reduce((value, tax) => value + tax.amount, 0);
      const rank = [Math.abs(sum - expected), taxes.filter((tax) => tax.aggregate).length, -taxes.length];
      if (!best || compareRank(rank, best.rank) < 0) best = { taxes, sum, rank };
    }
    if (best && Math.abs(best.sum - expected) <= tolerance) {
      return { subtotal: printedSubtotal, taxes: best.taxes };
    }
  }

  if (!candidates.length) return null;
  const aggregate = candidates.find((tax) => tax.aggregate);
  const components = candidates.filter((tax) => !tax.aggregate);
  let taxes = components;
  if (aggregate) {
    const componentSum = components.reduce((sum, tax) => sum + tax.amount, 0);
    taxes = components.length && Math.abs(componentSum - aggregate.amount) <= tolerance ? components : [aggregate];
  }
  const taxTotal = taxes.reduce((sum, tax) => sum + tax.amount, 0);
  if (taxTotal <= 0 || taxTotal >= total || taxTotal > total * 0.5) return null;
  return { subtotal: total - taxTotal, taxes };
}

function compareRank(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function lastAmount(line, code) {
  return lastAmountToken(line, code)?.amount ?? null;
}

function lastAmountToken(line, code) {
  const tokens = [];
  const pattern = /\d{1,3}(?:[,\s]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?/g;
  for (const match of line.matchAll(pattern)) {
    const after = line.slice(match.index + match[0].length);
    if (/^\s*%/.test(after)) continue;
    const value = parseAmount(normaliseNumber(match[0], code), code);
    if (value !== null) tokens.push({ amount: value, start: match.index, end: match.index + match[0].length });
  }
  return tokens.at(-1) || null;
}

function normaliseNumber(value, code) {
  let raw = value.replace(/\s/g, '');
  const decimals = String(unitScale(code)).length - 1;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    raw = raw.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const tail = raw.length - comma - 1;
    raw = tail > 0 && tail <= decimals ? raw.replace(',', '.') : raw.replace(/,/g, '');
  } else if ((raw.match(/\./g) || []).length > 1) {
    const tail = raw.length - dot - 1;
    raw = tail > 0 && tail <= decimals ? raw.slice(0, dot).replace(/\./g, '') + raw.slice(dot) : raw.replace(/\./g, '');
  }
  return raw;
}

function cleanTaxLabel(line, token) {
  return (line.slice(0, token.start) + line.slice(token.end))
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, '')
    .replace(/[₹$€£¥₫₩₱৳฿:=_*|]+/g, ' ')
    .replace(/^[\s.,;\-]+|[\s.,;\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 42);
}

function progressMessage(message) {
  const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
  const stages = {
    'loading tesseract core': [0.02, 0.16, 'Loading scanner'],
    'initializing tesseract': [0.16, 0.1, 'Starting scanner'],
    'loading language traineddata': [0.26, 0.22, 'Loading English text model'],
    'initializing api': [0.48, 0.08, 'Preparing text recognition'],
    'recognizing text': [0.56, 0.44, 'Reading the bill'],
  };
  const [start, span, label] = stages[message.status] || [0, 0, 'Reading the bill'];
  return { progress: Math.min(1, start + span * progress), label };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function abortError() {
  return new DOMException('Receipt scan cancelled.', 'AbortError');
}
