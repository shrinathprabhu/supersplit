// Plain-text renderings, tuned for pasting into WhatsApp / iMessage.

import { fmt } from '../core/money.js';
import { fmtDate } from '../util/dom.js';

const SIGNOFF = 'via SuperSplit';

export function renderText(doc) {
  if (doc.kind === 'receipt') return receiptText(doc);
  if (doc.kind === 'full') return fullText(doc);
  return summaryText(doc);
}

function summaryText(doc) {
  const c = doc.currency;
  const lines = [];
  lines.push(`*${doc.groupName}* settle up`);
  if (doc.mode === 'simplified') lines.push('_simplified debts_');
  lines.push('');
  if (!doc.debts.length) {
    lines.push('✅ All settled up. Nobody owes anybody.');
  } else {
    for (const d of doc.debts) {
      lines.push(`• ${d.from.name} → ${d.to.name}: *${fmt(d.amount, c)}*`);
    }
  }
  lines.push('');
  lines.push(doc.stats.map((s) => `${s.label}: ${s.value}`).join(' · '));
  lines.push(SIGNOFF);
  return lines.join('\n');
}

function receiptText(doc) {
  const c = doc.currency;
  const lines = [];
  lines.push(`*${doc.totalLabel} ${fmt(Math.abs(doc.amount), c)}*`);
  lines.push(`${doc.groupName}${doc.mode === 'simplified' ? ' (simplified)' : ''}`);

  for (const section of doc.sections || []) {
    if (!section.rows.length) continue;
    lines.push('');
    lines.push(`*${section.title}*`);
    for (const row of section.rows) {
      const when = row.date ? ` (${fmtDate(row.date)})` : '';
      lines.push(`• ${row.label}${when}: ${fmt(row.amount, c)}`);
    }
    if (section.rows.length > 1) lines.push(`   subtotal ${fmt(section.subtotal, c)}`);
  }

  lines.push('');
  lines.push(`*${doc.totalLabel}: ${fmt(Math.abs(doc.amount), c)}*`);
  if (doc.note) lines.push(`_${doc.note}_`);
  lines.push(SIGNOFF);
  return lines.join('\n');
}

function fullText(doc) {
  const c = doc.currency;
  const lines = [];
  lines.push(`*${doc.groupName}* detailed statement`);
  lines.push('');
  lines.push('*Expenses*');
  for (const e of doc.expenses) {
    lines.push(`• ${e.description} (${fmtDate(e.date)}): ${fmt(e.total, c)}`);
    if (e.discounts?.length) {
      lines.push(
        `   ${e.discounts.map((d) => `${d.label} -${fmt(d.amount, c)}${d.everyone ? '' : ' for ' + d.names.join(' and ')}`).join(', ')}`,
      );
    }
    lines.push(`   paid by ${e.paidBy.map((p) => `${p.member.name} ${fmt(p.amount, c)}`).join(', ')}`);
    lines.push(`   each owes ${e.shares.map((s) => `${s.member.name} ${fmt(s.amount, c)}`).join(', ')}`);
  }
  lines.push('');
  lines.push('*Balances*');
  for (const b of doc.balances) {
    if (b.net === 0) lines.push(`• ${b.member.name}: settled`);
    else if (b.net > 0) lines.push(`• ${b.member.name}: gets back ${fmt(b.net, c)}`);
    else lines.push(`• ${b.member.name}: owes ${fmt(-b.net, c)}`);
  }
  lines.push('');
  lines.push(doc.mode === 'simplified' ? '*Settle up (simplified)*' : '*Settle up*');
  if (!doc.debts.length) lines.push('All settled up.');
  for (const d of doc.debts) lines.push(`• ${d.from.name} pays ${d.to.name}: ${fmt(d.amount, c)}`);
  lines.push('');
  lines.push(SIGNOFF);
  return lines.join('\n');
}
