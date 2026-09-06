// Shared layout for the visual exports. Content is built as a list of blocks
// with a known height, so the image exporter can size one tall canvas and the
// PDF exporter can flow the same blocks across pages.

import { T, roundRect, text, measure, ellipsize, wrapLines, brandGradient, dashed, line, drawLogo, font } from './paint.js';
import { drawAvatar } from '../core/avatar.js';
import { fmt } from '../core/money.js';
import { fmtDate, fmtDateLong } from '../util/dom.js';

let measurer = null;
function mctx() {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  return measurer;
}

const PAD = 22; // inner padding of a card
const ROW = 56;

function card(ctx, x, y, w, h, opts = {}) {
  ctx.save();
  if (opts.torn) tornPath(ctx, x, y, w, h, 22);
  else roundRect(ctx, x, y, w, h, opts.radius || 22);
  ctx.fillStyle = opts.fill || T.card;
  ctx.fill();
  if (opts.stroke !== false) {
    ctx.strokeStyle = opts.strokeColor || T.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Rounded card whose bottom edge is torn like a paper receipt. */
function tornPath(ctx, x, y, w, h, r) {
  const depth = 13;
  const teeth = Math.max(6, Math.round(w / 30));
  const step = w / teeth;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - depth);
  for (let i = 1; i <= teeth; i++) {
    ctx.lineTo(x + w - i * step, y + h - (i % 2 === 1 ? 0 : depth));
  }
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function money(ctx, value, x, y, opts = {}) {
  ctx.save();
  ctx.font = font(opts.weight || 700, opts.size || 17);
  ctx.fillStyle = opts.color || T.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
  ctx.restore();
}

// ------------------------------------------------------------------ blocks

export function headerBlock(doc, w) {
  const titleSize = 30;
  const titleLines = wrapLines(mctx(), doc.title, w - 40, titleSize, 800);
  const h = 46 + 18 + titleLines.length * (titleSize + 6) + 26;
  return {
    h,
    draw(ctx, x, y) {
      drawLogo(ctx, x, y, 42);
      text(ctx, 'SuperSplit', x + 54, y + 5, { size: 16, weight: 750, color: T.text });
      text(ctx, 'offline bill splitter', x + 54, y + 24, { size: 12, weight: 500, color: T.muted });
      ctx.save();
      ctx.textAlign = 'right';
      ctx.font = font(500, 12.5);
      ctx.fillStyle = T.muted;
      ctx.textBaseline = 'top';
      ctx.fillText(fmtDateLong(doc.generatedAt.toISOString().slice(0, 10)), x + w, y + 14);
      ctx.restore();

      let cy = y + 64;
      for (const l of titleLines) {
        text(ctx, l, x, cy, { size: titleSize, weight: 800 });
        cy += titleSize + 6;
      }
      text(ctx, doc.subtitle, x, cy + 2, { size: 14, weight: 600, color: T.brand2 });
    },
  };
}

export function statsBlock(doc, w) {
  const h = 86;
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 14, { fill: T.cardAlt });
      const cellW = w / doc.stats.length;
      doc.stats.forEach((s, i) => {
        const cx = x + cellW * i + PAD;
        text(ctx, s.label.toUpperCase(), cx, y + 16, { size: 10.5, weight: 700, color: T.muted, maxWidth: cellW - PAD });
        text(ctx, s.value, cx, y + 33, { size: 19, weight: 750, maxWidth: cellW - PAD });
      });
    },
  };
}

export function sectionTitle(label, w, extra) {
  return {
    h: 44,
    draw(ctx, x, y) {
      text(ctx, label.toUpperCase(), x, y + 14, { size: 11.5, weight: 750, color: T.muted });
      if (extra) {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.font = font(600, 11.5);
        ctx.fillStyle = T.brand2;
        ctx.textBaseline = 'top';
        ctx.fillText(extra, x + w, y + 14);
        ctx.restore();
      }
    },
  };
}

export function debtsBlock(doc, w) {
  if (!doc.debts.length) {
    const h = 130;
    return {
      h,
      draw(ctx, x, y) {
        card(ctx, x, y, w, h - 14, { fill: 'rgba(61,224,160,0.10)', strokeColor: 'rgba(61,224,160,0.35)' });
        ctx.save();
        ctx.strokeStyle = T.good;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const cx = x + w / 2;
        ctx.beginPath();
        ctx.arc(cx, y + 40, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 9, y + 40);
        ctx.lineTo(cx - 2, y + 47);
        ctx.lineTo(cx + 10, y + 32);
        ctx.stroke();
        ctx.restore();
        text(ctx, 'All settled up', x + w / 2, y + 72, { size: 18, weight: 750, align: 'center' });
        text(ctx, 'Nobody owes anybody anything.', x + w / 2, y + 96, { size: 13, weight: 500, color: T.muted, align: 'center' });
      },
    };
  }
  const h = doc.debts.length * ROW + 16;
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 12);
      doc.debts.forEach((d, i) => {
        const ry = y + 8 + i * ROW;
        if (i > 0) line(ctx, x + PAD, ry, x + w - PAD, T.lineSoft);
        const cy = ry + (ROW - 34) / 2;
        drawAvatar(ctx, d.from.avatarSeed || d.from.name, x + PAD, cy, 34);
        drawAvatar(ctx, d.to.avatarSeed || d.to.name, x + PAD + 44, cy, 34);
        const amountStr = fmt(d.amount, doc.currency);
        const amountW = measure(ctx, amountStr, 17, 750) + 10;
        const nameW = w - PAD * 2 - 88 - amountW;
        ctx.save();
        ctx.font = font(650, 15);
        const label = ellipsize(ctx, `${d.from.name} → ${d.to.name}`, nameW);
        ctx.restore();
        text(ctx, label, x + PAD + 88, ry + 18, { size: 15, weight: 650 });
        money(ctx, amountStr, x + w - PAD, ry + 17, { size: 17, weight: 750, color: T.text });
      });
    },
  };
}

export function balancesBlock(doc, w) {
  const rows = doc.balances;
  const h = rows.length * 44 + 16;
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 12);
      rows.forEach((b, i) => {
        const ry = y + 8 + i * 44;
        if (i > 0) line(ctx, x + PAD, ry, x + w - PAD, T.lineSoft);
        drawAvatar(ctx, b.member.avatarSeed || b.member.name, x + PAD, ry + 7, 28);
        text(ctx, b.member.name, x + PAD + 38, ry + 13, { size: 14, weight: 600, maxWidth: w - 240 });
        const label = b.net === 0 ? 'settled' : b.net > 0 ? 'gets back ' + fmt(b.net, doc.currency) : 'owes ' + fmt(-b.net, doc.currency);
        money(ctx, label, x + w - PAD, ry + 13, {
          size: 14,
          weight: 700,
          color: b.net === 0 ? T.muted : b.net > 0 ? T.good : T.bad,
        });
      });
    },
  };
}

export function receiptHeadBlock(doc, w) {
  const h = 118;
  const owes = doc.amount >= 0;
  const from = owes ? doc.from : doc.to;
  const to = owes ? doc.to : doc.from;
  const amount = Math.abs(doc.amount);
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 14, { fill: T.cardAlt, strokeColor: 'rgba(124,92,255,0.35)' });
      const cy = y + 22;
      // Two faces, the payer first. The caption carries the direction.
      drawAvatar(ctx, from.avatarSeed || from.name, x + PAD, cy, 40);
      ctx.save();
      ctx.fillStyle = T.cardAlt;
      ctx.beginPath();
      ctx.arc(x + PAD + 50, cy + 20, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawAvatar(ctx, to.avatarSeed || to.name, x + PAD + 30, cy, 40);

      const amountStr = fmt(amount, doc.currency);
      const amountW = measure(ctx, amountStr, 30, 800) + 16;
      const textX = x + PAD + 86;
      text(ctx, `${from.name} owes ${to.name}`, textX, cy + 4, {
        size: 15.5,
        weight: 700,
        maxWidth: w - PAD * 2 - 86 - amountW,
      });
      text(ctx, doc.mode === 'simplified' ? 'simplified settlement' : 'from the bills below', textX, cy + 26, {
        size: 12,
        weight: 500,
        color: T.muted,
        maxWidth: w - PAD * 2 - 86 - amountW,
      });

      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = font(800, 30);
      ctx.fillStyle = brandGradient(ctx, x + w - PAD - amountW, cy, amountW, 36);
      ctx.fillText(amountStr, x + w - PAD, cy + 8);
      ctx.restore();
    },
  };
}

export function receiptRowsBlock(doc, w) {
  const sections = (doc.sections || []).filter((sec) => sec.rows.length);
  const rowH = 34;
  const headH = 30;
  const subH = 26;
  const bodyH = sections.reduce((a, sec) => a + headH + sec.rows.length * rowH + subH, 0);
  const h = 44 + bodyH + 52 + 20;

  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 14, { torn: true });
      let cy = y + 18;
      text(ctx, 'WHAT THIS IS FOR', x + PAD, cy, { size: 10.5, weight: 750, color: T.muted });
      cy += 26;

      for (const section of sections) {
        text(ctx, section.title, x + PAD, cy, { size: 12.5, weight: 700, color: T.brand2, maxWidth: w - PAD * 2 });
        cy += headH;

        for (const row of section.rows) {
          const amountStr = fmt(row.amount, doc.currency);
          const amountW = measure(ctx, amountStr, 13.5, 650) + 14;
          const date = row.date ? fmtDate(row.date) : '';
          const dateW = date ? measure(ctx, date, 11.5, 500) + 12 : 0;
          text(ctx, row.label, x + PAD + 8, cy, { size: 13.5, weight: 550, maxWidth: w - PAD * 2 - amountW - dateW - 8 });
          if (date) {
            money(ctx, date, x + w - PAD - amountW, cy + 1, { size: 11.5, weight: 500, color: T.muted });
          }
          money(ctx, amountStr, x + w - PAD, cy, { size: 13.5, weight: 650 });
          cy += rowH;
        }

        line(ctx, x + PAD + 8, cy - 6, x + w - PAD, T.lineSoft);
        text(ctx, 'Subtotal', x + PAD + 8, cy + 2, { size: 12, weight: 600, color: T.muted });
        money(ctx, fmt(section.subtotal, doc.currency), x + w - PAD, cy + 2, { size: 12.5, weight: 700, color: T.dim });
        cy += subH;
      }

      dashed(ctx, x + PAD, cy + 2, x + w - PAD);
      const totalStr = fmt(Math.abs(doc.amount), doc.currency);
      const totalW = measure(ctx, totalStr, 18, 800) + 14;
      text(ctx, doc.totalLabel || 'Total', x + PAD, cy + 16, { size: 13, weight: 700, color: T.dim, maxWidth: w - PAD * 2 - totalW });
      money(ctx, totalStr, x + w - PAD, cy + 11, { size: 18, weight: 800 });
    },
  };
}

export function noteBlock(message, w, kind = 'info') {
  const lines = wrapLines(mctx(), message, w - PAD * 2 - 26, 12.5, 500);
  const h = lines.length * 18 + 30;
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 12, {
        fill: kind === 'info' ? 'rgba(124,92,255,0.12)' : 'rgba(255,255,255,0.04)',
        strokeColor: kind === 'info' ? 'rgba(124,92,255,0.3)' : T.line,
        radius: 14,
      });
      let cy = y + 12;
      for (const l of lines) {
        text(ctx, l, x + PAD, cy, { size: 12.5, weight: 500, color: kind === 'info' ? T.brand2 : T.muted });
        cy += 18;
      }
    },
  };
}

/** One expense, stated plainly: what it cost, who paid, what each owes. */
export function expenseBlock(expense, doc, w) {
  const discounts = expense.discounts || [];
  const before = discounts.filter((d) => d.stage === 'pre');
  const after = discounts.filter((d) => d.stage === 'post');
  // Not called `money`: that name is the canvas helper that draws right
  // aligned text, and shadowing it silently blanks every amount below.
  const cash = (n) => fmt(n, doc.currency);
  const label = (d) => `${d.label}${d.everyone ? '' : ' for ' + d.names.join(' and ')}`;
  const makeup = [
    `Bill ${cash(expense.subtotal)}`,
    ...before.map((d) => `less ${label(d)} ${cash(d.amount)}`),
    ...expense.taxes.map((t) => `plus ${t.label} ${cash(t.amount)}`),
    ...after.map((d) => `less ${label(d)} ${cash(d.amount)}`),
    expense.rounding
      ? `round off ${expense.rounding < 0 ? '-' : '+'}${cash(Math.abs(expense.rounding))}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  const hasMakeup = expense.taxes.length || expense.rounding || discounts.length;
  const makeupLines = hasMakeup ? wrapLines(mctx(), makeup, w - PAD * 2, 12, 500) : [];
  const noteLines = expense.notes ? wrapLines(mctx(), expense.notes, w - PAD * 2, 12, 500) : [];
  const h =
    62 + makeupLines.length * 18 + 24 + expense.paidBy.length * 22 + 24 + expense.shares.length * 22 + noteLines.length * 16 + 22;

  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 14);
      let cy = y + 16;
      const totalStr = fmt(expense.total, doc.currency);
      const totalW = measure(ctx, totalStr, 17, 750) + 12;
      text(ctx, expense.description, x + PAD, cy, { size: 16, weight: 700, maxWidth: w - PAD * 2 - totalW });
      money(ctx, totalStr, x + w - PAD, cy, { size: 17, weight: 750 });
      cy += 22;
      text(ctx, expense.dateLong, x + PAD, cy, { size: 11.5, weight: 500, color: T.muted });
      cy += 22;

      for (const l of makeupLines) {
        text(ctx, l, x + PAD, cy, { size: 12, weight: 500, color: T.muted });
        cy += 18;
      }
      if (makeupLines.length) cy += 4;

      const kv = (label, value, opts = {}) => {
        text(ctx, label, x + PAD + 8, cy, { size: 12.5, weight: 550, color: opts.color || T.text, maxWidth: w - PAD * 2 - 130 });
        money(ctx, value, x + w - PAD, cy, { size: 12.5, weight: 650, color: opts.color || T.text });
        cy += 22;
      };

      text(ctx, 'PAID BY', x + PAD, cy, { size: 10, weight: 750, color: T.muted });
      cy += 20;
      for (const p of expense.paidBy) kv(p.member.name, fmt(p.amount, doc.currency));

      text(ctx, 'EACH PERSON OWES', x + PAD, cy, { size: 10, weight: 750, color: T.muted });
      cy += 20;
      for (const s of expense.shares) kv(s.member.name, fmt(s.amount, doc.currency));

      if (noteLines.length) {
        cy += 2;
        for (const l of noteLines) {
          text(ctx, l, x + PAD, cy, { size: 12, weight: 500, color: T.muted });
          cy += 16;
        }
      }
    },
  };
}

export function paymentsBlock(doc, w) {
  const h = doc.payments.length * 44 + 16;
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 12);
      doc.payments.forEach((p, i) => {
        const ry = y + 8 + i * 44;
        if (i > 0) line(ctx, x + PAD, ry, x + w - PAD, T.lineSoft);
        text(ctx, `${p.from.name} → ${p.to.name}`, x + PAD, ry + 8, { size: 13.5, weight: 600, maxWidth: w - 260 });
        text(ctx, p.dateLong + (p.note ? ' · ' + p.note : ''), x + PAD, ry + 25, { size: 11, weight: 500, color: T.muted, maxWidth: w - 260 });
        money(ctx, fmt(p.amount, doc.currency), x + w - PAD, ry + 13, { size: 14, weight: 700, color: T.good });
      });
    },
  };
}

export function perPersonBlock(doc, w) {
  const rows = doc.perPerson;
  const note = doc.roundingNote
    ? 'A bill that does not divide evenly leaves one paisa over, so a single bill can show shares a paisa apart. It is tracked across the group, so it evens out rather than falling to the same person every time.'
    : null;
  const noteLines = note ? wrapLines(mctx(), note, w - PAD * 2, 11.5, 500) : [];
  const h = rows.length * 46 + 46 + (noteLines.length ? noteLines.length * 16 + 12 : 0);
  return {
    h,
    draw(ctx, x, y) {
      card(ctx, x, y, w, h - 12);
      const colR = x + w - PAD;
      const colOwed = colR - 110;
      const colPaid = colOwed - 110;
      text(ctx, 'PERSON', x + PAD, y + 14, { size: 10, weight: 750, color: T.muted });
      money(ctx, 'PAID', colPaid, y + 14, { size: 10, weight: 750, color: T.muted });
      money(ctx, 'SHARE', colOwed, y + 14, { size: 10, weight: 750, color: T.muted });
      money(ctx, 'BALANCE', colR, y + 14, { size: 10, weight: 750, color: T.muted });
      rows.forEach((p, i) => {
        const ry = y + 36 + i * 46;
        line(ctx, x + PAD, ry, x + w - PAD, T.lineSoft);
        drawAvatar(ctx, p.member.avatarSeed || p.member.name, x + PAD, ry + 10, 26);
        text(ctx, p.member.name, x + PAD + 34, ry + 15, { size: 13, weight: 600, maxWidth: colPaid - x - PAD - 110 });
        money(ctx, fmt(p.paid, doc.currency), colPaid, ry + 15, { size: 12.5, weight: 600, color: T.dim });
        money(ctx, fmt(p.owed, doc.currency), colOwed, ry + 15, { size: 12.5, weight: 600, color: T.dim });
        money(ctx, (p.net > 0 ? '+' : '') + fmt(p.net, doc.currency), colR, ry + 15, {
          size: 13,
          weight: 750,
          color: p.net === 0 ? T.muted : p.net > 0 ? T.good : T.bad,
        });
      });

      let ny = y + 36 + rows.length * 46 + 10;
      for (const l of noteLines) {
        text(ctx, l, x + PAD, ny, { size: 11.5, weight: 500, color: T.muted });
        ny += 16;
      }
    },
  };
}

export function footerBlock(w, note) {
  const h = 58;
  return {
    h,
    draw(ctx, x, y) {
      dashed(ctx, x, y + 10, x + w);
      drawLogo(ctx, x, y + 22, 20);
      text(ctx, note || 'Made with SuperSplit. Offline bill splitting, no accounts, no cloud.', x + 28, y + 26, {
        size: 11.5,
        weight: 500,
        color: T.muted,
        maxWidth: w - 30,
      });
    },
  };
}

// --------------------------------------------------------------- documents

/** Blocks for the shareable summary / receipt image. */
export function simpleBlocks(doc, w) {
  const blocks = [headerBlock(doc, w)];
  if (doc.kind === 'receipt') {
    blocks.push(receiptHeadBlock(doc, w));
    if (doc.sections?.length) blocks.push(receiptRowsBlock(doc, w));
    if (doc.note) blocks.push(noteBlock(doc.note, w));
  } else {
    blocks.push(statsBlock(doc, w));
    blocks.push(sectionTitle(doc.mode === 'simplified' ? 'Settle up · simplified' : 'Settle up', w));
    blocks.push(debtsBlock(doc, w));
    if (doc.balances.length) {
      blocks.push(sectionTitle('Balances', w));
      blocks.push(balancesBlock(doc, w));
    }
  }
  blocks.push(footerBlock(w));
  return blocks;
}

/** Blocks for the detailed PDF statement. */
export function detailedBlocks(doc, w) {
  const blocks = [headerBlock(doc, w)];
  if (doc.kind === 'receipt') {
    blocks.push(receiptHeadBlock(doc, w));
    if (doc.sections?.length) blocks.push(receiptRowsBlock(doc, w));
    if (doc.note) blocks.push(noteBlock(doc.note, w));
    if (doc.expenses?.length) {
      blocks.push(sectionTitle('Expenses behind this', w));
      for (const e of doc.expenses) blocks.push(expenseBlock(e, doc, w));
    }
  } else {
    blocks.push(statsBlock(doc, w));
    blocks.push(sectionTitle(doc.mode === 'simplified' ? 'Settle up · simplified' : 'Settle up', w));
    blocks.push(debtsBlock(doc, w));
    if (doc.mode === 'simplified') {
      blocks.push(
        noteBlock(
          'Simplified: payments are re-routed to reduce the number of transfers, so a payment may go to someone you never shared a bill with. The totals are identical either way.',
          w,
        ),
      );
    }
    blocks.push(sectionTitle('Balances', w));
    blocks.push(perPersonBlock(doc, w));
    if (doc.payments?.length) {
      blocks.push(sectionTitle('Settlements recorded', w));
      blocks.push(paymentsBlock(doc, w));
    }
    if (doc.expenses?.length) {
      blocks.push(sectionTitle('Every expense', w, `${doc.expenses.length} total`));
      for (const e of doc.expenses) blocks.push(expenseBlock(e, doc, w));
    }
  }
  blocks.push(footerBlock(w));
  return blocks;
}
