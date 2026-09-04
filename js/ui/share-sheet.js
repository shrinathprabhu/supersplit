// One sheet that turns any ledger view into a WhatsApp message, an image or
// a PDF, previewed first, then handed to the browser's share sheet.

import { h, clear, download } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './shell.js';
import { buildSummaryDoc, buildReceiptDoc, buildFullDoc, docFileName } from '../export/doc.js';
import { renderText } from '../export/text.js';
import { renderImage } from '../export/image.js';
import { renderPdf } from '../export/pdf.js';
import { shareFile, shareText, copyText } from '../export/share.js';

const FORMATS = [
  { value: 'text', label: 'Text', icon: 'message', hint: 'Great for WhatsApp' },
  { value: 'image', label: 'Image', icon: 'image', hint: 'PNG card' },
  { value: 'pdf', label: 'PDF', icon: 'file', hint: 'Detailed statement' },
];

/**
 * @param {object} opts
 * @param {'summary'|'receipt'} opts.kind
 * @param {object} opts.ledger
 * @param {'simplified'|'actual'} opts.mode
 * @param {string} [opts.from] receipt: who pays
 * @param {string} [opts.to]   receipt: who gets paid
 */
export function openShareSheet(opts) {
  const { kind, ledger, mode } = opts;
  let format = 'image';
  const cache = new Map();
  let previewBox;
  let footer;

  const simpleDoc = () =>
    kind === 'receipt' ? buildReceiptDoc(ledger, opts.from, opts.to, mode) : buildSummaryDoc(ledger, mode);
  const detailedDoc = () => (kind === 'receipt' ? buildReceiptDoc(ledger, opts.from, opts.to, mode) : buildFullDoc(ledger, mode));

  async function build(kindOfFormat) {
    if (cache.has(kindOfFormat)) return cache.get(kindOfFormat);
    let result;
    if (kindOfFormat === 'text') {
      const doc = simpleDoc();
      result = { doc, text: renderText(doc) };
    } else if (kindOfFormat === 'image') {
      const doc = simpleDoc();
      const img = await renderImage(doc, { detailed: false });
      result = { doc, ...img };
    } else {
      const doc = detailedDoc();
      const pdf = await renderPdf(doc, { detailed: true });
      result = { doc, ...pdf };
    }
    cache.set(kindOfFormat, result);
    return result;
  }

  function shareTitle(doc) {
    return kind === 'receipt' ? `${doc.from.name} → ${doc.to.name} · ${doc.groupName}` : `${doc.groupName} · settle up`;
  }

  async function refreshPreview() {
    clear(previewBox);
    previewBox.appendChild(
      h('div', { class: 'row', style: { padding: '28px', justifyContent: 'center', gap: '10px' } }, h('div', { class: 'spinner' }), h('span', { class: 'small muted', text: 'Rendering…' })),
    );
    try {
      const result = await build(format);
      clear(previewBox);
      if (format === 'text') {
        previewBox.appendChild(h('pre', { text: result.text }));
      } else if (format === 'image') {
        previewBox.appendChild(h('img', { src: result.url, alt: 'Preview' }));
      } else {
        previewBox.appendChild(h('img', { src: result.previewUrl, alt: 'PDF preview' }));
      }
    } catch (err) {
      console.error(err);
      clear(previewBox);
      previewBox.appendChild(h('div', { class: 'banner', style: { margin: '12px' }, text: 'Could not render this format.' }));
    }
    renderFooter();
  }

  function renderFooter() {
    if (!footer) return;
    clear(footer);
    const ready = cache.has(format);
    const primaryLabel = format === 'text' ? 'Share text' : format === 'image' ? 'Share image' : 'Share PDF';
    footer.appendChild(
      h(
        'button',
        {
          class: 'btn btn--ghost',
          disabled: !ready,
          onClick: async () => {
            const result = await build(format);
            if (format === 'text') {
              const status = await copyText(result.text);
              toast(status === 'copied' ? 'Copied to clipboard' : 'Could not copy', status === 'copied' ? 'good' : 'bad');
            } else {
              const ext = format === 'image' ? 'png' : 'pdf';
              download(result.blob, docFileName(result.doc, ext));
              toast('Saved to your downloads', 'good');
            }
          },
        },
        icon(format === 'text' ? 'copy' : 'download', 18),
        format === 'text' ? 'Copy' : 'Save',
      ),
    );
    footer.appendChild(
      h(
        'button',
        {
          class: 'btn btn--primary grow',
          disabled: !ready,
          onClick: async () => {
            const result = await build(format);
            if (format === 'text') {
              const status = await shareText({ text: result.text, title: shareTitle(result.doc) });
              if (status === 'copied') toast('No share sheet here, so it is copied instead', 'good');
              else if (status === 'failed') toast('Could not share', 'bad');
            } else {
              const ext = format === 'image' ? 'png' : 'pdf';
              const status = await shareFile({
                blob: result.blob,
                filename: docFileName(result.doc, ext),
                title: shareTitle(result.doc),
                text: kind === 'receipt' ? undefined : renderText(simpleDoc()),
              });
              if (status === 'downloaded') toast('No share sheet here, so it is saved instead', 'good');
            }
          },
        },
        icon('share', 18),
        primaryLabel,
      ),
    );
  }

  openSheet({
    title: kind === 'receipt' ? 'Share receipt' : 'Share settle up',
    subtitle: mode === 'simplified' ? 'Simplified debts' : 'Actual debts',
    render: () => {
      const grid = h(
        'div',
        { class: 'share-grid' },
        FORMATS.map((f) =>
          h(
            'button',
            {
              class: 'share-opt',
              'aria-selected': String(f.value === format),
              onClick: () => {
                if (format === f.value) return;
                format = f.value;
                for (const node of grid.children) {
                  node.setAttribute('aria-selected', String(node.dataset.value === format));
                }
                refreshPreview();
              },
              dataset: { value: f.value },
            },
            icon(f.icon, 24),
            f.label,
          ),
        ),
      );
      previewBox = h('div', { class: 'preview', style: { marginTop: '14px' } });
      const hint = h('p', {
        class: 'tiny muted',
        style: { margin: '10px 2px 0' },
        text:
          kind === 'receipt'
            ? 'Text and image show the amount and why. The PDF adds every bill behind it.'
            : 'Text and image show who owes whom. The PDF is a full statement with every expense.',
      });
      setTimeout(refreshPreview, 30);
      return [grid, previewBox, hint];
    },
    footer: (ctx) => {
      footer = ctx.footer;
      setTimeout(renderFooter, 0);
      return [];
    },
    onClose: () => {
      for (const value of cache.values()) if (value.url) URL.revokeObjectURL(value.url);
    },
  });
}
