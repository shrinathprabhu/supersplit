// Canvas drawing primitives shared by the image and PDF exporters, plus the
// SuperSplit mark itself (kept in code so it can be painted at any size).

export const T = {
  bg: '#0B0913',
  bgSoft: '#120F20',
  card: '#17142C',
  cardAlt: '#1E1A38',
  line: 'rgba(255,255,255,0.10)',
  lineSoft: 'rgba(255,255,255,0.06)',
  text: '#F5F3FF',
  dim: '#B3ACCF',
  muted: '#8B83AD',
  brand: '#7C5CFF',
  brand2: '#A855F7',
  brand3: '#FF5FA2',
  good: '#3DE0A0',
  bad: '#FF6B81',
  white: '#FFFFFF',
};

const STACK =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, 'Helvetica Neue', Arial, sans-serif";

/**
 * Canvas silently falls back to a default face if the webfont has not loaded
 * yet, so exporters wait on this first.
 */
export async function fontsReady() {
  if (!document.fonts) return;
  try {
    await Promise.all([500, 600, 650, 700, 750, 800].map((w) => document.fonts.load(`${w} 16px Geist`)));
    await document.fonts.ready;
  } catch {
    /* fall back to the system stack */
  }
}

export function font(weight, size) {
  return `${weight} ${size}px ${STACK}`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw text with top-left origin. Returns the advance height. */
export function text(ctx, str, x, y, opts = {}) {
  const { size = 16, weight = 500, color = T.text, align = 'left', maxWidth, lineHeight } = opts;
  ctx.save();
  ctx.font = font(weight, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const value = maxWidth ? ellipsize(ctx, String(str), maxWidth) : String(str);
  ctx.fillText(value, x, y);
  ctx.restore();
  return lineHeight || size * 1.3;
}

export function measure(ctx, str, size, weight = 500) {
  ctx.save();
  ctx.font = font(weight, size);
  const w = ctx.measureText(String(str)).width;
  ctx.restore();
  return w;
}

export function ellipsize(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(str.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}

export function wrapLines(ctx, str, maxWidth, size, weight = 500) {
  ctx.save();
  ctx.font = font(weight, size);
  const words = String(str).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

export function brandGradient(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, T.brand);
  g.addColorStop(0.55, T.brand2);
  g.addColorStop(1, T.brand3);
  return g;
}

/** Dashed separator, receipt-style. */
export function dashed(ctx, x1, y, x2, color = T.line) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

export function line(ctx, x1, y, x2, color = T.line) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

/**
 * The SuperSplit mark: a receipt with a torn edge whose face is a
 * calculator. Drawn on a 64x64 grid and scaled to `size`.
 */
export function drawLogo(ctx, x, y, size, opts = {}) {
  const k = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);

  if (opts.plate !== false) {
    roundRect(ctx, 0, 0, 64, 64, 15);
    ctx.fillStyle = opts.flat || brandGradient(ctx, 0, 0, 64, 64);
    ctx.fill();
  }

  // Receipt body with a torn bottom edge.
  ctx.beginPath();
  ctx.moveTo(19, 10);
  ctx.lineTo(45, 10);
  ctx.quadraticCurveTo(49, 10, 49, 14);
  ctx.lineTo(49, 46);
  const teeth = 10;
  const step = 34 / teeth;
  for (let i = 1; i <= teeth; i++) {
    ctx.lineTo(49 - i * step, i % 2 === 1 ? 51.5 : 46);
  }
  ctx.lineTo(15, 14);
  ctx.quadraticCurveTo(15, 10, 19, 10);
  ctx.closePath();
  ctx.fillStyle = opts.paper || '#FFFFFF';
  ctx.fill();

  // Display.
  roundRect(ctx, 20, 15, 24, 8, 2.4);
  ctx.fillStyle = opts.ink || '#2A1B57';
  ctx.fill();
  roundRect(ctx, 34.5, 17.5, 8, 3, 1.2);
  ctx.fillStyle = opts.accent || '#7C5CFF';
  ctx.fill();

  // Keys, with the "=" key picked out in brand colour.
  const cols = [20, 29, 38];
  const rows = [27, 36];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      const last = r === rows.length - 1 && c === cols.length - 1;
      roundRect(ctx, cols[c], rows[r], 6, 6, 1.8);
      ctx.fillStyle = last ? opts.accent || '#7C5CFF' : opts.key || '#C9C0E8';
      ctx.fill();
    }
  }
  ctx.restore();
}
