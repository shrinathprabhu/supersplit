// Bridges to the browser share sheet, with a download / clipboard fallback.

import { download } from '../util/dom.js';

export function canShareFiles(file) {
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/**
 * Hand a file to the OS share sheet; fall back to a download.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareFile({ blob, filename, title, text }) {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Fall through to a download when the share sheet refuses.
    }
  }
  download(blob, filename);
  return 'downloaded';
}

/** @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>} */
export async function shareText({ text, title }) {
  if (navigator.share) {
    try {
      await navigator.share({ text, title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  return copyText(text);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // Clipboard API needs a secure context; fall back to the old trick.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok ? 'copied' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
