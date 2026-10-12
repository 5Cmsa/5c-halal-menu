// The "track record" chart: for each hall, the share of served meal periods in
// the last six months that had at least one halal dish with no warning. The
// counts come from data/history.json, which scripts/history.mjs adds to daily.

import { h } from './dom.js';
import { HALLS } from './halls.js';

const WINDOW_DAYS = 182;
const EARLY = 20; // fewer served periods than this is too few to read much into
const PERIODS = [
  ['daytime', 'Daytime'],
  ['dinner', 'Dinner'],
];

const shortDate = (date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const percent = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// days: { "2026-10-12": { daytime: { halal, clear }, dinner: { halal, clear } } }
// A period is missing from a day when the hall served nothing then.
export function summarise(days, today) {
  const from = addDays(today, -WINDOW_DAYS);
  const totals = { since: null, served: 0, met: 0, dishes: 0, everLabelled: false, periods: {} };
  for (const [period] of PERIODS) totals.periods[period] = { served: 0, met: 0 };
  for (const date of Object.keys(days).sort()) {
    if (date <= from || date > today) continue;
    for (const [period] of PERIODS) {
      const count = days[date][period];
      if (!count) continue;
      totals.since ??= date;
      totals.served++;
      totals.periods[period].served++;
      totals.dishes += count.clear;
      totals.everLabelled ||= count.halal > 0;
      if (count.clear > 0) {
        totals.met++;
        totals.periods[period].met++;
      }
    }
  }
  return totals;
}

function bar(label, part, whole, tip) {
  const share = percent(part, whole);
  const track = h(
    'div',
    { class: 'stat-track', tabindex: '0', role: 'img', 'aria-label': `${label}: ${part} of ${whole} meals, ${share}%` },
    h('div', { class: 'stat-fill', style: `width: ${share}%` }),
  );
  const show = () => tip.show(track, `${share}%`, `of ${label.toLowerCase()} meals had a halal dish`);
  track.addEventListener('pointerenter', show);
  track.addEventListener('focus', show);
  track.addEventListener('pointerleave', tip.hide);
  track.addEventListener('blur', tip.hide);
  return h('div', { class: 'stat-row' }, h('span', { class: 'stat-label' }, label), track, h('span', { class: 'stat-count' }, whole ? `${part} of ${whole}` : 'not served'));
}

function hallBlock(hall, totals, tip) {
  if (!totals.served) {
    return h('article', { class: 'stat' }, h('div', { class: 'stat-head' }, h('h3', {}, hall.name)), h('p', { class: 'stat-sub' }, 'No meals recorded yet.'));
  }
  const average = totals.dishes ? ` · ${(totals.dishes / totals.served).toFixed(1)} halal dishes a meal` : '';
  return h(
    'article',
    { class: 'stat' },
    h(
      'div',
      { class: 'stat-head' },
      h('h3', {}, hall.name, totals.served < EARLY ? h('span', { class: 'chip plain' }, 'early data') : null),
      h('span', { class: 'stat-rate' }, `${percent(totals.met, totals.served)}%`),
    ),
    h('p', { class: 'stat-sub' }, `${totals.met} of ${totals.served} meals since ${shortDate(totals.since)}${average}`),
    PERIODS.map(([period, label]) => bar(label, totals.periods[period].met, totals.periods[period].served, tip)),
  );
}

// One floating label shared by every bar. The same numbers are printed beside
// each bar, so nothing depends on being able to hover.
function tooltip(root) {
  const el = h('div', { class: 'stat-tip', role: 'status', hidden: true });
  root.append(el);
  return {
    show(target, value, text) {
      el.replaceChildren(h('strong', {}, value), ` ${text}`);
      el.hidden = false;
      const box = target.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      const left = Math.min(Math.max(box.left - frame.left, 0), frame.width - el.offsetWidth);
      el.style.transform = `translate(${left}px, ${box.top - frame.top - el.offsetHeight - 6}px)`;
    },
    hide() {
      el.hidden = true;
    },
  };
}

export async function renderStats(section, today) {
  try {
    const res = await fetch('data/history.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const history = await res.json();
    const rows = HALLS.map((hall) => ({ hall, totals: summarise(history.halls?.[hall.id] ?? {}, today) }));
    // Best record first, but a hall with only a few meals recorded ranks below
    // the established ones however well those few went, and one with none is last.
    const standing = ({ served }) => (served >= EARLY ? 2 : served > 0 ? 1 : 0);
    const rate = ({ met, served }) => met / (served || 1);
    rows.sort((a, b) => standing(b.totals) - standing(a.totals) || rate(b.totals) - rate(a.totals));

    const chart = h('div', { class: 'stats-chart' });
    const tip = tooltip(chart);
    chart.prepend(...rows.map(({ hall, totals }) => hallBlock(hall, totals, tip)));

    const unlabelled = rows.filter(({ totals }) => totals.served >= EARLY && !totals.everLabelled).map(({ hall }) => hall.name);
    const body = [chart];
    if (unlabelled.length) {
      body.push(h('p', { class: 'stats-note' }, `${unlabelled.join(' and ')} listed no dish as halal in this period. Their kitchens may serve halal food without labelling it, so ask before ruling them out.`));
    }
    section.querySelector('#stats-body').replaceChildren(...body);
    section.hidden = false;
  } catch (err) {
    console.warn('track record failed to load', err);
  }
}
