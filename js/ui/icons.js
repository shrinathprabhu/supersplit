// Hand-rolled 24x24 stroke icons on a consistent grid, which keeps the app
// offline and the bundle tiny. Only the icons the UI actually uses.

const wrap = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  back: wrap('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  close: wrap('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  plus: wrap('<path d="M12 5.5v13M5.5 12h13"/>'),
  check: wrap('<path d="M5 12.5l4.8 4.8L19 6.8"/>'),
  chevronDown: wrap('<path d="M6.5 9.5L12 15l5.5-5.5"/>'),
  chevronRight: wrap('<path d="M9.5 6.5L15 12l-5.5 5.5"/>'),
  arrowRight: wrap('<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>'),
  more: wrap('<circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>'),

  trash: wrap('<path d="M4.5 6.5h15M9.5 6.5V4.8a1 1 0 011-1h3a1 1 0 011 1v1.7"/><path d="M6.5 6.5l.8 12a1.7 1.7 0 001.7 1.6h6a1.7 1.7 0 001.7-1.6l.8-12"/><path d="M10.5 10.5v6M13.5 10.5v6"/>'),
  edit: wrap('<path d="M4 20h4.2L19 9.2a2.1 2.1 0 000-3l-1.2-1.2a2.1 2.1 0 00-3 0L4 15.8V20z"/><path d="M13.8 5.8l4.4 4.4"/>'),
  copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2.6"/><path d="M6 15H5.4A1.4 1.4 0 014 13.6V5.4A1.4 1.4 0 015.4 4h8.2A1.4 1.4 0 0115 5.4V6"/>'),
  undo: wrap('<path d="M4.5 8.5h4.6V3.9"/><path d="M4.9 8.8a7.6 7.6 0 116.6 11.3"/>'),

  users: wrap('<circle cx="9.2" cy="8.2" r="3.4"/><path d="M2.8 19.6a6.4 6.4 0 0112.8 0"/><path d="M16.2 5.4a3.4 3.4 0 010 5.6"/><path d="M17.8 14.4a6.4 6.4 0 013.4 5.2"/>'),
  receipt: wrap('<path d="M6.5 3.5h11v17l-2.2-1.6-2.2 1.6-2.1-1.6-2.3 1.6-2.2-1.6V3.5z"/><path d="M9.3 8h5.4M9.3 11.6h5.4M9.3 15.2h3"/>'),
  wallet: wrap('<rect x="3.2" y="5.5" width="17.6" height="13" rx="3.2"/><path d="M3.2 9.6h17.6"/><path d="M21 12.2h-4a2.3 2.3 0 000 4.6h4"/><circle cx="17.4" cy="14.5" r="0.85" fill="currentColor" stroke="none"/>'),
  swap: wrap('<path d="M4 8.8h13.5M14.2 5.5l3.3 3.3-3.3 3.3"/><path d="M20 15.2H6.5M9.8 11.9l-3.3 3.3 3.3 3.3"/>'),

  share: wrap('<path d="M12 3.6v11.2M8.2 7.4L12 3.6l3.8 3.8"/><path d="M5.5 13.4v5.3a1.7 1.7 0 001.7 1.7h9.6a1.7 1.7 0 001.7-1.7v-5.3"/>'),
  download: wrap('<path d="M12 3.6v11.2M8.2 11l3.8 3.8L15.8 11"/><path d="M5.5 20.4h13"/>'),
  image: wrap('<rect x="3.2" y="4.5" width="17.6" height="15" rx="3"/><circle cx="8.8" cy="10" r="1.7"/><path d="M3.6 16.6l4.6-3.9 3.6 2.9 3-2.3 5.2 4"/>'),
  message: wrap('<path d="M20.5 11.7a8 8 0 01-11.7 7.1L4 20.2l1.4-4.7a8 8 0 1115.1-3.8z"/>'),
  file: wrap('<path d="M13.6 3.5H7.4A1.9 1.9 0 005.5 5.4v13.2a1.9 1.9 0 001.9 1.9h9.2a1.9 1.9 0 001.9-1.9V8.3l-4.9-4.8z"/><path d="M13.6 3.5v4.8h4.9"/><path d="M9 13h6M9 16.4h4"/>'),

  sparkle: wrap('<path d="M10.5 3.5l1.6 4.3 4.4 1.7-4.4 1.7-1.6 4.3-1.6-4.3L4.5 9.5l4.4-1.7 1.6-4.3z"/><path d="M17.8 14.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z"/>'),
  settings: wrap('<path d="M4 7.6h8.2M17 7.6h3"/><path d="M4 16.4h3M11.8 16.4H20"/><circle cx="14.6" cy="7.6" r="2.4"/><circle cx="9.4" cy="16.4" r="2.4"/>'),
  info: wrap('<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5"/><circle cx="12" cy="7.9" r="0.95" fill="currentColor" stroke="none"/>'),
};

export function icon(name, size = 20) {
  const markup = icons[name] || icons.info;
  const span = document.createElement('span');
  span.innerHTML = markup;
  const node = span.firstElementChild;
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('aria-hidden', 'true');
  node.style.display = 'block';
  node.style.flex = 'none';
  return node;
}
