// Local-only regression probe, excluded from the Cloudflare public asset list.
// Open /scripts/layout-probe.html?nosw=1&fixture=populated on a test origin.
// Metrics are exposed as DOM data so browser inspection stays read-only.
const params = new URLSearchParams(location.search);
const metrics = { cls: 0, shifts: [], longTasks: [], ready: false };
const output = document.getElementById('layout-metrics');
let appStart = Infinity;
let sessionStart = 0;
let lastShift = 0;
let sessionValue = 0;
const publish = () => output.setAttribute('data-metrics', JSON.stringify(metrics));

if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput || entry.startTime < appStart) continue;
      if (entry.startTime - lastShift > 1000 || entry.startTime - sessionStart > 5000) {
        sessionStart = entry.startTime;
        sessionValue = 0;
      }
      lastShift = entry.startTime;
      sessionValue += entry.value;
      metrics.cls = Math.max(metrics.cls, sessionValue);
      metrics.shifts.push({
        time: Math.round(entry.startTime),
        value: entry.value,
        sources: entry.sources.map((source) => source.node?.className || source.node?.nodeName || 'removed'),
      });
    }
    publish();
  }).observe({ type: 'layout-shift', buffered: true });
}

if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime >= appStart) {
        metrics.longTasks.push({ time: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      }
    }
    publish();
  }).observe({ type: 'longtask', buffered: true });
}

if (params.get('fixture') === 'populated') {
  const { init, store, applyRecords } = await import('../js/core/store.js');
  const { blankExpense, toDateKey } = await import('../js/core/split.js');
  await init();
  const groupId = 'layout-probe-group';
  if (!store.groups.some((group) => group.id === groupId)) {
    const now = new Date().toISOString();
    const members = ['Alex', 'Sam', 'Jo'].map((name, i) => ({ id: `layout-person-${i}`, name, avatarSeed: name }));
    const group = {
      id: groupId,
      name: 'Layout test group',
      currency: 'INR',
      simplify: false,
      archived: false,
      meId: members[0].id,
      members,
      createdAt: now,
      updatedAt: now,
    };
    const expenses = Array.from({ length: 48 }, (_, i) => {
      const expense = blankExpense(groupId, members.map((member) => member.id));
      const date = new Date();
      date.setDate(date.getDate() - i);
      expense.id = `layout-expense-${i}`;
      expense.description = `Test bill ${i + 1}`;
      expense.date = toDateKey(date);
      expense.subtotal = 10000 + i * 100;
      expense.payers.members = [members[i % 2].id];
      return expense;
    });
    await applyRecords({ groups: [group], expenses });
  }
}

// Exercise the actual failure path without depending on a network outage.
if (params.get('charts') === 'fail') {
  const createSvgElement = document.createElementNS.bind(document);
  document.createElementNS = (namespace, name, options) => {
    if (namespace === 'http://www.w3.org/2000/svg' && name === 'svg') throw new Error('Deliberate chart failure');
    return createSvgElement(namespace, name, options);
  };
}

appStart = performance.now();
await import('../js/app.js');
new MutationObserver(() => {
  if (document.querySelector('#app .screen')) {
    metrics.ready = true;
    publish();
  }
}).observe(document.getElementById('app'), { childList: true });
publish();
