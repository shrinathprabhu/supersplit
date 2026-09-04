// Home: the list of groups, plus app-level settings.

import { h, clear, download, listNames } from '../util/dom.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmSheet, chooseSheet } from './shell.js';
import { avatarStack, emptyState, segmented } from './components.js';
import { fmt, CURRENCIES } from '../core/money.js';
import { store, createGroup, ledgerFor, resetEverything } from '../core/store.js';
import { navigate } from '../app.js';
import { lineChart, donutChart, statRow, CHART_COLORS } from './charts.js';
import { allGroupsDaily, groupTotals, sharedCurrency } from '../core/analytics.js';
import { exportProfile } from '../core/transfer.js';
import { pickImportFile } from './import-sheet.js';

export function homeScreen() {
  const content = h('div', { class: 'content wrap' });
  const screen = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'appbar' },
      h(
        'div',
        { class: 'appbar__inner wrap' },
        h('div', { class: 'brandmark grow' }, logoNode(), h('b', {}, 'Super', h('i', {}, 'Split'))),
        h('button', { class: 'btn btn--icon', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 20)),
      ),
    ),
    content,
    h('button', { class: 'fab', onClick: () => openCreateGroup() }, icon('plus', 18), 'New group'),
  );

  const groups = store.groups.filter((g) => !g.archived);
  if (!groups.length) {
    content.appendChild(
      h(
        'div',
        { style: { paddingTop: '24px' } },
        emptyState({
          iconName: 'wallet',
          title: 'Split a bill, not the friendship',
          text: 'Create a group, add the people in it, and SuperSplit does the maths: taxes, uneven payers, the lot. Everything stays on this device.',
          action: h('button', { class: 'btn btn--primary', onClick: () => openCreateGroup() }, icon('plus', 16), 'Create your first group'),
        }),
      ),
    );
    return screen;
  }

  content.appendChild(h('div', { class: 'section-title', text: 'Your groups' }));
  const list = h('div', { class: 'cards' });
  for (const group of groups) list.appendChild(groupCard(group));
  content.appendChild(list);

  const insights = insightsPanels(groups);
  if (insights) {
    content.appendChild(h('div', { class: 'section-title', text: 'Spending' }));
    content.appendChild(insights);
  }
  return screen;
}

/** Daily spend across groups, plus where the money is going. */
function insightsPanels(groups) {
  const code = sharedCurrency(groups) || dominantCurrency(groups);
  const inScope = groups.filter((g) => g.currency === code);
  const skipped = groups.length - inScope.length;

  const daily = allGroupsDaily(inScope, ledgerFor, { days: 30 });
  const totals = groupTotals(inScope, ledgerFor).filter((t) => t.all > 0);
  if (!daily.any && !totals.length) return null;

  const panels = h('div', { class: 'panels' });

  panels.appendChild(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'chart-head' }, h('h4', { text: 'Daily spend' }), h('span', { class: 'tiny muted', text: 'last 30 days' })),
      lineChart({
        points: daily.points,
        series: [{ name: 'All groups', color: CHART_COLORS[0] }],
        currency: code,
      }),
      statRow([
        { label: 'Last 30 days', value: fmt(daily.total, code) },
        { label: 'Per day', value: fmt(daily.perDay, code) },
        { label: 'Groups', value: String(inScope.length) },
      ]),
    ),
  );

  if (totals.length) {
    let scope = 'month';
    const card = h('div', { class: 'card' });
    const body = h('div', {});

    const drawDonut = () => {
      clear(body);
      const slices = totals
        .map((t, i) => ({
          name: t.group.name,
          value: scope === 'month' ? t.month : t.average,
          color: CHART_COLORS[i % CHART_COLORS.length],
        }))
        .filter((sl) => sl.value > 0)
        .sort((a, b) => b.value - a.value);

      if (!slices.length) {
        body.appendChild(
          h('p', { class: 'small muted', style: { margin: '10px 2px' }, text: scope === 'month' ? 'Nothing spent yet this month.' : 'Not enough history yet.' }),
        );
        return;
      }
      body.appendChild(donutChart({ slices, currency: code }));
      const sum = slices.reduce((a, sl) => a + sl.value, 0);
      body.appendChild(
        statRow([
          { label: scope === 'month' ? 'This month' : 'Every month', value: fmt(sum, code) },
          { label: 'Top group', value: slices[0].name },
        ]),
      );
    };

    card.appendChild(
      h(
        'div',
        { class: 'chart-head' },
        h('h4', { text: 'Where it goes' }),
      ),
    );
    card.appendChild(
      segmented(
        [
          { value: 'month', label: 'This month' },
          { value: 'average', label: 'Monthly average' },
        ],
        scope,
        (v) => {
          scope = v;
          drawDonut();
        },
        { small: true },
      ),
    );
    card.appendChild(h('div', { style: { marginTop: '14px' } }, body));
    drawDonut();
    panels.appendChild(card);
  }

  if (skipped > 0) {
    panels.appendChild(
      h('div', {
        class: 'tiny muted span-all',
        style: { padding: '0 2px' },
        text: `${skipped} ${skipped === 1 ? 'group uses' : 'groups use'} a different currency and are left out of these totals.`,
      }),
    );
  }
  return panels;
}

function dominantCurrency(groups) {
  const tally = new Map();
  for (const g of groups) tally.set(g.currency, (tally.get(g.currency) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'INR';
}

function logoNode() {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><defs><linearGradient id="hl" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7C5CFF"/><stop offset=".55" stop-color="#A855F7"/><stop offset="1" stop-color="#FF5FA2"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#hl)"/><path d="M19 10 H45 Q49 10 49 14 V46 L45.6 51.5 L42.2 46 L38.8 51.5 L35.4 46 L32 51.5 L28.6 46 L25.2 51.5 L21.8 46 L18.4 51.5 L15 46 L15 14 Q15 10 19 10 Z" fill="#fff"/><rect x="20" y="15" width="24" height="8" rx="2.4" fill="#2A1B57"/><rect x="34.5" y="17.5" width="8" height="3" rx="1.2" fill="#7C5CFF"/><rect x="20" y="27" width="6" height="6" rx="1.8" fill="#B7ABDE"/><rect x="29" y="27" width="6" height="6" rx="1.8" fill="#B7ABDE"/><rect x="38" y="27" width="6" height="6" rx="1.8" fill="#B7ABDE"/><rect x="20" y="36" width="6" height="6" rx="1.8" fill="#B7ABDE"/><rect x="29" y="36" width="6" height="6" rx="1.8" fill="#B7ABDE"/><rect x="38" y="36" width="6" height="6" rx="1.8" fill="#7C5CFF"/></svg>`;
  return span.firstElementChild;
}

function groupCard(group) {
  const ledger = ledgerFor(group.id);
  const code = group.currency;
  const me = group.meId ? ledger.net[group.meId] || 0 : null;
  const debts = ledger.debts(group.simplify ? 'simplified' : 'actual');

  let status;
  if (!ledger.expenses.length) status = h('span', { class: 'pill', text: 'No expenses yet' });
  else if (!debts.length) status = h('span', { class: 'pill pill--good', text: 'All settled up' });
  else if (me === null) status = h('span', { class: 'pill pill--brand', text: `${debts.length} payment${debts.length > 1 ? 's' : ''} pending` });
  else if (me === 0) status = h('span', { class: 'pill', text: 'You are settled' });
  else if (me > 0) status = h('span', { class: 'pill pill--good', text: `You get back ${fmt(me, code)}` });
  else status = h('span', { class: 'pill pill--bad', text: `You owe ${fmt(-me, code)}` });

  return h(
    'button',
    { class: 'card card--tap', onClick: () => navigate(`#/g/${group.id}`) },
    h(
      'div',
      { class: 'row row--between' },
      h(
        'div',
        { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'ellipsis', style: { fontSize: '1.1rem', fontWeight: '700' }, text: group.name }),
        h('div', { class: 'tiny muted ellipsis', style: { marginTop: '2px' }, text: listNames(group.members.map((m) => m.name), 3) }),
      ),
      avatarStack(group.members, 4, 30),
    ),
    h(
      'div',
      { class: 'row row--between', style: { marginTop: '14px' } },
      status,
      h('div', { class: 'small muted num', text: `${fmt(ledger.totalSpend, code)} total` }),
    ),
  );
}

// --------------------------------------------------------------- creating

export function openCreateGroup() {
  const draft = { name: '', currency: store.settings.lastCurrency || 'INR', members: [] };
  let chipsBox;
  let nameInput;
  let memberInput;
  let currencyBtn;

  const renderChips = () => {
    chipsBox.innerHTML = '';
    draft.members.forEach((name, i) => {
      chipsBox.appendChild(
        h(
          'button',
          {
            class: 'chip chip--plain',
            onClick: () => {
              draft.members.splice(i, 1);
              renderChips();
            },
          },
          name,
          icon('close', 13),
        ),
      );
    });
    if (!draft.members.length) {
      chipsBox.appendChild(h('span', { class: 'tiny muted', text: 'Add everyone splitting the bills, you included.' }));
    }
  };

  const addMemberName = () => {
    const value = memberInput.value.trim();
    if (!value) return;
    if (draft.members.some((n) => n.toLowerCase() === value.toLowerCase())) {
      toast('Already in the list', 'bad');
      return;
    }
    draft.members.push(value);
    memberInput.value = '';
    renderChips();
    memberInput.focus();
  };

  const ctx = openSheet({
    title: 'New group',
    render: () => {
      nameInput = h('input', {
        class: 'input',
        placeholder: 'Goa trip, Flat 4B, Dinner…',
        onInput: (e) => {
          draft.name = e.target.value;
        },
      });
      memberInput = h('input', {
        class: 'input grow',
        placeholder: 'Name',
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addMemberName();
          }
        },
      });
      chipsBox = h('div', { class: 'row row--wrap', style: { gap: '8px', marginTop: '10px' } });
      currencyBtn = h(
        'button',
        {
          class: 'btn btn--quiet btn--block',
          style: { justifyContent: 'space-between' },
          onClick: async () => {
            const value = await chooseSheet({
              title: 'Currency',
              selected: draft.currency,
              options: CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol.trim()}  ${c.code}`, hint: c.name })),
            });
            if (!value) return;
            draft.currency = value;
            currencyBtn.firstChild.textContent = `${CURRENCIES.find((c) => c.code === value).symbol.trim()}  ${value}`;
          },
        },
        h('span', {}, `${CURRENCIES.find((c) => c.code === draft.currency).symbol.trim()}  ${draft.currency}`),
        icon('chevronDown', 16),
      );
      renderChips();
      setTimeout(() => nameInput.focus(), 260);
      return h(
        'div',
        { class: 'stack' },
        h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Group name' }), nameInput),
        h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Currency' }), currencyBtn),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label', text: 'People' }),
          h('div', { class: 'row', style: { gap: '8px' } }, memberInput, h('button', { class: 'btn btn--quiet', onClick: addMemberName }, icon('plus', 16))),
          chipsBox,
        ),
      );
    },
    footer: () => [
      h(
        'button',
        {
          class: 'btn btn--primary btn--block',
          onClick: async () => {
            const pending = memberInput.value.trim();
            if (pending && !draft.members.includes(pending)) draft.members.push(pending);
            if (!draft.name.trim()) return toast('Give the group a name', 'bad');
            if (draft.members.length < 2) return toast('Add at least two people', 'bad');
            const group = await createGroup({ name: draft.name, currency: draft.currency, memberNames: draft.members });
            navigate(`#/g/${group.id}`);
            toast('Group created', 'good');
          },
        },
        'Create group',
      ),
    ],
  });
}

// --------------------------------------------------------------- settings

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

export function openSettings() {
  const ctx = openSheet({
    title: 'SuperSplit',
    subtitle: 'Offline bill splitting · no account, no server',
    render: () => [
      h(
        'div',
        { class: 'list' },
        installPrompt
          ? h(
              'button',
              {
                class: 'list__item',
                onClick: async () => {
                  installPrompt.prompt();
                  const { outcome } = await installPrompt.userChoice;
                  if (outcome === 'accepted') toast('Installing…', 'good');
                  installPrompt = null;
                  ctx.close();
                },
              },
              icon('download', 19),
              h('div', { class: 'grow' }, h('div', {}, 'Install app'), h('div', { class: 'tiny muted' }, 'Adds SuperSplit to your home screen')),
            )
          : null,
        h(
          'button',
          {
            class: 'list__item',
            onClick: () => {
              download(
                new Blob([JSON.stringify(exportProfile(), null, 2)], { type: 'application/json' }),
                `supersplit-profile-${new Date().toISOString().slice(0, 10)}.json`,
              );
              toast('Profile backup saved', 'good');
            },
          },
          icon('download', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Export profile'), h('div', { class: 'tiny muted' }, 'One file with every group')),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: () => {
              ctx.close();
              pickImportFile({ expect: 'profile', onDone: () => navigate('#/') });
            },
          },
          icon('undo', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Import profile'), h('div', { class: 'tiny muted' }, 'Merges with what is already here')),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: () => {
              ctx.close();
              pickImportFile({ expect: 'group', onDone: () => navigate('#/') });
            },
          },
          icon('users', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Import a group'), h('div', { class: 'tiny muted' }, 'Adds one group, or updates it if you have it')),
        ),
        h(
          'button',
          {
            class: 'list__item',
            onClick: async () => {
              const ok = await confirmSheet({
                title: 'Erase everything?',
                message: 'Every group, expense and settlement on this device will be deleted. There is no cloud copy.',
                confirmLabel: 'Erase it all',
                danger: true,
              });
              if (!ok) return;
              await resetEverything();
              navigate('#/');
              toast('Everything erased');
            },
          },
          icon('trash', 19),
          h('span', { class: 'grow bad' }, 'Erase all data'),
        ),
      ),
      h(
        'div',
        { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'small dim' }, 'Everything lives in this browser, in ', h('b', {}, store.mode === 'indexeddb' ? 'IndexedDB' : 'local storage'), '. Nothing is uploaded, there is no account, and the app keeps working with no connection at all.'),
        h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, 'Clearing site data in your browser will delete it, so take a backup before you do.'),
      ),
      h(
        'div',
        { class: 'list', style: { marginTop: '12px' } },
        h(
          'a',
          { class: 'list__item', href: 'https://github.com/shrinathprabhu/supersplit', target: '_blank', rel: 'noopener', style: { textDecoration: 'none', color: 'inherit' } },
          icon('file', 19),
          h('div', { class: 'grow' }, h('div', {}, 'Source on GitHub'), h('div', { class: 'tiny muted' }, 'Free and open source')),
          icon('share', 16),
        ),
        h(
          'a',
          { class: 'list__item', href: 'https://owleye.dev', target: '_blank', rel: 'noopener', style: { textDecoration: 'none', color: 'inherit' } },
          icon('sparkle', 19),
          h('div', { class: 'grow' }, h('div', {}, 'From the makers of OwlEye Analytics'), h('div', { class: 'tiny muted' }, 'Privacy-first product analytics')),
          icon('share', 16),
        ),
        h(
          'a',
          { class: 'list__item', href: 'https://lowkey.tools', target: '_blank', rel: 'noopener', style: { textDecoration: 'none', color: 'inherit' } },
          icon('sparkle', 19),
          h('div', { class: 'grow' }, h('div', {}, 'More tools at lowkey.tools'), h('div', { class: 'tiny muted' }, 'Superbrain, Favigen and more')),
          icon('share', 16),
        ),
      ),
      h('div', { class: 'tiny muted center', style: { marginTop: '14px' } }, 'SuperSplit 1.0, built by ', h('a', { href: 'https://shrinath.me', target: '_blank', rel: 'noopener' }, 'Shrinath Prabhu')),
    ],
  });
}
