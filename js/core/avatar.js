// Deterministic, dependency-free avatars in the spirit of Boring Avatars
// (MIT). A seed string always produces the same little face, generated
// locally so the app never touches the network.

const PALETTE = [
  ['#7C5CFF', '#3B1E8F'],
  ['#FF5FA2', '#7A1749'],
  ['#37D6C3', '#0B5F58'],
  ['#FFB53D', '#7A4A05'],
  ['#5BA8FF', '#123C7A'],
  ['#C4F04B', '#4A6604'],
  ['#FF7A5C', '#7A2415'],
  ['#B77BFF', '#42167F'],
  ['#4BE08C', '#0C5B31'],
  ['#FF4D6D', '#75122A'],
];

const INK = '#180F2E';

function hash(seed) {
  let h = 2166136261;
  const s = String(seed || 'supersplit');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick(h, shift, range) {
  return Math.floor(h / Math.pow(2, shift)) % range;
}

/** Everything both renderers need, derived from the seed. */
export function avatarSpec(seed) {
  const h = hash(seed);
  const pair = PALETTE[h % PALETTE.length];
  const blobRotate = pick(h, 3, 8) * 45;
  return {
    bg: pair[0],
    deep: pair[1],
    ink: INK,
    blobRotate,
    blobX: 8 + pick(h, 6, 12),
    blobY: 10 + pick(h, 9, 14),
    blobR: 14 + pick(h, 12, 12),
    faceX: -2 + pick(h, 15, 5),
    faceY: -2 + pick(h, 17, 5),
    eyeSpread: 5 + pick(h, 19, 4),
    eyeY: 17 + pick(h, 21, 3),
    eyeR: 1.4 + pick(h, 23, 3) * 0.25,
    mouth: pick(h, 25, 3), // 0 smile, 1 flat, 2 open
    mouthW: 4 + pick(h, 27, 5),
    mouthY: 25 + pick(h, 29, 3),
  };
}

/** Inline SVG markup, 40x40 viewBox. */
export function avatarSvg(seed, size = 40) {
  const s = avatarSpec(seed);
  const id = 'c' + hash(seed).toString(36);
  const mouth =
    s.mouth === 1
      ? `<rect x="${20 - s.mouthW / 2}" y="${s.mouthY - 0.6}" width="${s.mouthW}" height="1.4" rx="0.7" fill="${s.ink}"/>`
      : s.mouth === 2
        ? `<ellipse cx="20" cy="${s.mouthY}" rx="${s.mouthW / 2}" ry="${s.mouthW / 3}" fill="${s.ink}"/>`
        : `<path d="M ${20 - s.mouthW / 2} ${s.mouthY - 1} Q 20 ${s.mouthY + 2.6} ${20 + s.mouthW / 2} ${s.mouthY - 1}" fill="none" stroke="${s.ink}" stroke-width="1.5" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-hidden="true">
<defs><clipPath id="${id}"><circle cx="20" cy="20" r="20"/></clipPath></defs>
<g clip-path="url(#${id})">
<rect width="40" height="40" fill="${s.bg}"/>
<rect x="${s.blobX}" y="${s.blobY}" width="${s.blobR * 2}" height="${s.blobR * 2}" rx="${s.blobR * 0.55}" fill="${s.deep}" opacity="0.55" transform="rotate(${s.blobRotate} 20 20)"/>
<g transform="translate(${s.faceX} ${s.faceY})">
<circle cx="${20 - s.eyeSpread}" cy="${s.eyeY}" r="${s.eyeR}" fill="${s.ink}"/>
<circle cx="${20 + s.eyeSpread}" cy="${s.eyeY}" r="${s.eyeR}" fill="${s.ink}"/>
${mouth}
</g></g></svg>`;
}

/** Same face, painted straight onto a canvas (used by image/PDF export). */
export function drawAvatar(ctx, seed, x, y, size) {
  const s = avatarSpec(seed);
  const k = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.arc(20, 20, 20, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, 40, 40);

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = s.deep;
  ctx.translate(20, 20);
  ctx.rotate((s.blobRotate * Math.PI) / 180);
  ctx.translate(-20, -20);
  roundRect(ctx, s.blobX, s.blobY, s.blobR * 2, s.blobR * 2, s.blobR * 0.55);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(s.faceX, s.faceY);
  ctx.fillStyle = s.ink;
  ctx.beginPath();
  ctx.arc(20 - s.eyeSpread, s.eyeY, s.eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(20 + s.eyeSpread, s.eyeY, s.eyeR, 0, Math.PI * 2);
  ctx.fill();
  if (s.mouth === 1) {
    roundRect(ctx, 20 - s.mouthW / 2, s.mouthY - 0.6, s.mouthW, 1.4, 0.7);
    ctx.fill();
  } else if (s.mouth === 2) {
    ctx.beginPath();
    ctx.ellipse(20, s.mouthY, s.mouthW / 2, s.mouthW / 3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.strokeStyle = s.ink;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.moveTo(20 - s.mouthW / 2, s.mouthY - 1);
    ctx.quadraticCurveTo(20, s.mouthY + 2.6, 20 + s.mouthW / 2, s.mouthY - 1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

export function newSeed(name = '') {
  return `${name.trim().toLowerCase()}#${Math.random().toString(36).slice(2, 8)}`;
}

