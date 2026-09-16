// A tiny PDF writer. Each page is rendered on a canvas and embedded as a
// JPEG (DCTDecode). No external library, works fully offline, and the page
// looks exactly like the app.

import { detailedBlocks, simpleBlocks } from './layout.js';
import { paintBackground } from './image.js';
import { T, font, fontsReady } from './paint.js';
import { yieldToMain } from '../util/dom.js';

const PT_W = 595.28; // A4 portrait
const PT_H = 841.89;
const SCALE = 2; // canvas px per pt
const MARGIN = 40; // pt

/** Flow blocks across page canvases. */
async function paginate(doc, { detailed = true } = {}) {
  const pageW = PT_W * SCALE;
  const pageH = PT_H * SCALE;
  const margin = MARGIN * SCALE;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2 - 26 * SCALE; // leave room for the page footer

  const blocks = (detailed ? detailedBlocks : simpleBlocks)(doc, contentW);
  const pages = [];
  let current = null;
  let y = 0;

  const newPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d');
    paintBackground(ctx, pageW, pageH);
    pages.push({ canvas, ctx });
    current = ctx;
    y = margin;
  };

  newPage();
  let sliceStart = performance.now();
  for (const block of blocks) {
    if (y + block.h > margin + contentH && y > margin) newPage();
    block.draw(current, margin, y, contentW);
    y += block.h;
    if (performance.now() - sliceStart >= 8) {
      await yieldToMain();
      sliceStart = performance.now();
    }
  }

  // Footer on every page, once the count is known.
  for (const [i, page] of pages.entries()) {
    const { ctx } = page;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(600, 11 * SCALE);
    ctx.fillStyle = T.muted;
    ctx.fillText(`${i + 1} / ${pages.length}`, pageW - margin, pageH - margin * 0.55);
    ctx.restore();
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(500, 11 * SCALE);
    ctx.fillStyle = T.muted;
    ctx.fillText(doc.footerLabel || `${doc.groupName} · ${doc.subtitle}`, margin, pageH - margin * 0.55);
    ctx.restore();
    if (performance.now() - sliceStart >= 8) {
      await yieldToMain();
      sliceStart = performance.now();
    }
  }

  return pages;
}

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function pdfString(str) {
  // Escape for a PDF literal string, dropping anything outside Latin-1.
  return String(str)
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '')
    .replace(/([\\()])/g, '\\$1');
}

/**
 * @returns {Promise<{blob: Blob, pages: number}>}
 */
export async function renderPdf(doc, options = {}) {
  await fontsReady();
  await yieldToMain();
  const pages = await paginate(doc, options);
  const images = [];
  for (const page of pages) {
    const blob = await new Promise((resolve, reject) => page.canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Could not encode a PDF page')),
      'image/jpeg',
      0.9,
    ));
    images.push(new Uint8Array(await blob.arrayBuffer()));
    // Encoding every page at once lets browsers batch several expensive
    // canvas jobs into one long task. Give input and painting a turn between
    // pages instead.
    await yieldToMain();
  }

  const chunks = [];
  let length = 0;
  const offsets = [0];
  const push = (data) => {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = () => {
    offsets.push(length);
  };

  const pageCount = pages.length;
  // Object numbering: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageObjNum = (i) => 4 + i * 3;
  const contentObjNum = (i) => 5 + i * 3;
  const imageObjNum = (i) => 6 + i * 3;

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  startObject();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject();
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ');
  push(`2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>\nendobj\n`);

  startObject();
  const stamp = doc.generatedAt.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  push(
    `3 0 obj\n<< /Title (${pdfString(doc.groupName + ': ' + doc.subtitle)}) /Author (SuperSplit) ` +
      `/Creator (SuperSplit) /Producer (SuperSplit) /CreationDate (D:${stamp}) >>\nendobj\n`,
  );

  for (let i = 0; i < pageCount; i++) {
    const stream = `q\n${PT_W.toFixed(2)} 0 0 ${PT_H.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;

    startObject();
    push(
      `${pageObjNum(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W.toFixed(2)} ${PT_H.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjNum(i)} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>\nendobj\n`,
    );

    startObject();
    push(`${contentObjNum(i)} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);

    startObject();
    push(
      `${imageObjNum(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pages[i].canvas.width} ` +
        `/Height ${pages[i].canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${images[i].length} >>\nstream\n`,
    );
    push(images[i]);
    push('\nendstream\nendobj\n');
  }

  const xrefStart = length;
  const objCount = offsets.length; // includes the free entry at index 0
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let i = 1; i < objCount; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  push(xref);
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const preview = new Blob([images[0]], { type: 'image/jpeg' });
  return {
    blob: new Blob(chunks, { type: 'application/pdf' }),
    pages: pageCount,
    previewUrl: URL.createObjectURL(preview),
    previewWidth: pages[0].canvas.width,
    previewHeight: pages[0].canvas.height,
  };
}
