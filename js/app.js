// Boot + hash router. Screens are plain functions returning DOM.

import { init, subscribe, store, setSetting } from './core/store.js';
import { homeScreen } from './ui/home.js';
import { groupScreen } from './ui/group.js';
import { baseHistoryState, closeAllSheets, toast } from './ui/shell.js';
import { h, clear } from './util/dom.js';
import { disposeCharts } from './ui/charts.js';

const root = document.getElementById('app');
let lastKey = null;
let booted = false;

export function navigate(hash) {
  // Any open sheet owns a history entry, so unwind those before moving.
  closeAllSheets().then(() => {
    if (location.hash === hash) render();
    else location.hash = hash;
  });
}

function parseRoute() {
  const raw = (location.hash || '').replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'g' && parts[1]) {
    const tab = ['settle', 'people'].includes(parts[2]) ? parts[2] : 'expenses';
    return { name: 'group', id: parts[1], tab };
  }
  return { name: 'home' };
}

function render() {
  if (!booted) return;
  const route = parseRoute();
  const key = `${route.name}:${route.id || ''}:${route.tab || ''}`;
  const sameScreen = key === lastKey;
  const scroll = window.scrollY;

  clear(root);
  try {
    root.appendChild(route.name === 'group' ? groupScreen(route.id, route.tab) : homeScreen());
  } catch (err) {
    console.error(err);
    root.appendChild(
      h(
        'div',
        { class: 'content' },
        h('div', { class: 'banner' }, 'Something went wrong rendering this screen.'),
        h('button', { class: 'btn btn--primary', style: { marginTop: '12px' }, onClick: () => navigate('#/') }, 'Back to groups'),
      ),
    );
  }

  if (sameScreen) window.scrollTo(0, scroll);
  else window.scrollTo(0, 0);
  lastKey = key;
  disposeCharts(); // charts from the screen we just replaced

  if (route.name === 'group' && store.settings.lastGroupId !== route.id) {
    setSetting('lastGroupId', route.id);
  }
}

window.addEventListener('hashchange', () => {
  closeAllSheets();
  baseHistoryState();
  render();
});

// Screens ask for a redraw after they mutate data.
window.addEventListener('supersplit:refresh', () => render());

async function boot() {
  await init();
  booted = true;
  baseHistoryState();
  render();
  subscribe(() => render());
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // needs http(s)
  if (new URLSearchParams(location.search).has('nosw')) return; // ?nosw=1 while developing
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update ready. Reopen the app to apply it.');
          }
        });
      });
    })
    .catch((err) => console.warn('Service worker registration failed', err));
}

boot();
