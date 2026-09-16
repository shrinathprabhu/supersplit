// Renders a document to a shareable PNG using the block layout.

import { T, fontsReady } from './paint.js';
import { simpleBlocks, detailedBlocks } from './layout.js';
import { yieldToMain } from '../util/dom.js';

const MARGIN = 34;

export function paintBackground(ctx, w, h) {
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, w, h);
  const g1 = ctx.createRadialGradient(w * 0.1, -h * 0.02, 0, w * 0.1, -h * 0.02, w * 0.95);
  g1.addColorStop(0, 'rgba(124,92,255,0.30)');
  g1.addColorStop(1, 'rgba(124,92,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createRadialGradient(w * 1.02, h * 0.04, 0, w * 1.02, h * 0.04, w * 0.7);
  g2.addColorStop(0, 'rgba(255,95,162,0.18)');
  g2.addColorStop(1, 'rgba(255,95,162,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
}

/**
 * @returns {Promise<{blob: Blob, url: string, width: number, height: number}>}
 */
export async function renderImage(doc, { detailed = false, width = 900, scale = 2 } = {}) {
  await fontsReady();
  await yieldToMain();
  const contentW = width - MARGIN * 2;
  const blocks = (detailed ? detailedBlocks : simpleBlocks)(doc, contentW);
  const height = Math.ceil(blocks.reduce((a, b) => a + b.h, 0) + MARGIN * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  paintBackground(ctx, width, height);

  let y = MARGIN;
  let sliceStart = performance.now();
  for (const block of blocks) {
    block.draw(ctx, MARGIN, y, contentW);
    y += block.h;
    if (performance.now() - sliceStart >= 8) {
      await yieldToMain();
      sliceStart = performance.now();
    }
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the image');
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}
