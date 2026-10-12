import { HALLS, SOURCES } from './halls.js';
import { loadHallDay, sameMeal, slotFor } from './sources.js';
import { hadithOfTheDay } from './hadith.js';
import { h } from './dom.js';
import { menuLink, whereOnPage } from './links.js';
import { renderStats } from './stats.js';
import { classify } from './classify.js';

const TIME_ZONE = 'America/Los_Angeles';
const DAYS_SHOWN = 7;
const STALE_AFTER_HOURS = 26;
const SLOTS = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
];
const CAUTION_LABELS = {
  flag: 'Hall’s halal flag says no',
  pork: 'Mentions pork',
  meat: 'Has other meat',
  alcohol: 'Mentions alcohol',
  gelatin: 'Mentions gelatin',
};

const $ = (id) => document.getElementById(id);

// ---------- dates and times ----------

function todayInClaremont() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}

function currentSlot() {
  const [hours, minutes] = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  const time = hours + minutes / 60;
  return time < 10.5 ? 'breakfast' : time < 14.5 ? 'lunch' : 'dinner';
}

// "07:30", "10:00" -> "7:30 – 10 am"; "11:00", "13:30" -> "11 am – 1:30 pm"
function formatRange(start, end) {
  const part = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return { text: `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`, half: hours < 12 ? 'am' : 'pm' };
  };
  const from = part(start);
  const to = part(end);
  return from.half === to.half ? `${from.text} – ${to.text} ${to.half}` : `${from.text} ${from.half} – ${to.text} ${to.half}`;
}

function freshness(source) {
  if (!source.fetchedAt) return { text: '', stale: false };
  if (source.live) return { text: navigator.onLine ? 'read live' : 'saved copy', stale: false };
  const hours = (Date.now() - Date.parse(source.fetchedAt)) / 3_600_000;
  const text = hours < 1 ? 'updated within the hour' : hours < 48 ? `updated ${Math.round(hours)} h ago` : `updated ${Math.round(hours / 24)} days ago`;
  return { text, stale: hours > STALE_AFTER_HOURS };
}

// ---------- state ----------

const today = todayInClaremont();
const dates = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i));
const params = new URLSearchParams(location.search);
const state = {
  date: dates.includes(params.get('date')) ? params.get('date') : today,
  slot: SLOTS.some(([id]) => id === params.get('meal')) ? params.get('meal') : currentSlot(),
};

const loaded = new Map(); // "hall|date" -> day
const counts = new Map(); // hall id -> halal dishes in the current view
const cards = new Map();
let renderToken = 0;

const slotLabel = () => SLOTS.find(([id]) => id === state.slot)[1];

// ---------- view model ----------

function mealsForSlot(meals, slot) {
  const exact = meals.filter((meal) => meal.slot === slot);
  const brunch = meals.filter((meal) => meal.slot === 'brunch');
  if (slot === 'lunch') return [...brunch, ...exact];
  if (slot === 'breakfast') return exact.length ? exact : brunch;
  return exact;
}

function buildView(day, slot) {
  const meals = mealsForSlot(day.meals, slot);
  const byName = new Map();
  for (const meal of meals) {
    for (const item of meal.items) {
      const key = item.name.toLowerCase();
      const entry = { item, meal, verdict: classify(item) };
      const existing = byName.get(key);
      // The same dish can be listed twice; keep the copy the hall marked halal.
      if (!existing || (entry.verdict.halal && !existing.verdict.halal)) byName.set(key, entry);
    }
  }
  const entries = [...byName.values()];
  const rank = ({ item, verdict }) => (verdict.cautions.length ? 2 : 0) + (item.featured ? 0 : 1);
  const ordered = (list) => list.sort((a, b) => rank(a) - rank(b));
  return {
    meals,
    entries,
    halal: ordered(entries.filter((e) => e.verdict.halal)),
    seafood: ordered(entries.filter((e) => !e.verdict.halal && e.verdict.seafood)),
  };
}

// ---------- pieces ----------

const isLower = (text) => text === text.toLowerCase();
const chip = (kind, text) => h('span', { class: `chip ${kind}` }, text);

function verdictChips(verdict) {
  const chips = [];
  if (verdict.halal) chips.push(chip('halal', verdict.halal.short));
  if (verdict.seafood) (verdict.seafood.kinds.length ? verdict.seafood.kinds : ['Seafood']).forEach((kind) => chips.push(chip('sea', kind)));
  return chips;
}

function itemRow(hall, day, entry, { compact = false } = {}) {
  const { item, verdict } = entry;
  const tags = verdictChips(verdict);
  if (compact) {
    if (item.vegan) tags.push(chip('plain', 'Vegan'));
    else if (item.vegetarian) tags.push(chip('plain', 'Vegetarian'));
  } else if (item.station) {
    tags.push(h('span', { class: `item-meta${isLower(item.station) ? ' lower' : ''}` }, item.station));
  }
  const warnings = [...new Set(verdict.cautions.map((caution) => CAUTION_LABELS[caution.kind]))].join(' · ');
  return h(
    'li',
    {},
    h(
      'button',
      { class: 'item', type: 'button', onclick: () => openDetail(hall, day, entry) },
      h(
        'span',
        { class: 'item-main' },
        h('span', { class: `item-name${isLower(item.name) ? ' lower' : ''}` }, item.name),
        tags.length ? h('span', { class: 'item-tags' }, tags) : null,
        warnings && (verdict.halal || verdict.seafood) ? h('span', { class: 'item-warn' }, `Check: ${warnings}`) : null,
      ),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
    ),
  );
}

function group(kind, title, list, emptyText, hall, day) {
  return h(
    'section',
    { class: `group ${kind}` },
    h('h3', { class: 'group-title' }, title, list.length ? h('span', { class: 'group-count' }, String(list.length)) : null),
    list.length ? h('ul', { class: 'items' }, list.map((entry) => itemRow(hall, day, entry))) : h('p', { class: 'empty' }, emptyText),
  );
}

function fullMenu(hall, day, view) {
  const featured = view.entries.filter((e) => e.item.featured);
  const everyday = view.entries.length - featured.length;
  const stations = new Map();
  for (const entry of featured) {
    const name = entry.item.station || 'Menu';
    if (!stations.has(name)) stations.set(name, []);
    stations.get(name).push(entry);
  }
  return h(
    'details',
    { class: 'rest' },
    h('summary', {}, `Full menu · ${featured.length} dishes`),
    [...stations].map(([name, list]) => [
      h('h4', { class: `station${isLower(name) ? ' lower' : ''}` }, name),
      h('ul', { class: 'items' }, list.map((entry) => itemRow(hall, day, entry, { compact: true }))),
    ]),
    h(
      'p',
      { class: 'rest-note' },
      everyday ? `Plus ${everyday} more items (sides, salad bar, condiments) on the original menu.` : 'Tap a dish to see how the hall listed it.',
    ),
  );
}

// Dinner shows only its own time. The daytime meals run into one another, so
// breakfast, brunch, lunch and continuous service are listed together, with
// the one being shown picked out.
function hoursList(day, view) {
  const evening = state.slot === 'dinner';
  const rows = day.hours.filter((row) => (slotFor(row.name, row.start) === 'dinner') === evening);
  if (!rows.length) return null;
  return h(
    'dl',
    { class: 'hours' },
    rows.map((row) => {
      const showing = view.meals.some((meal) => sameMeal(row.name, meal.name));
      return h(
        'div',
        { class: `hours-row${showing ? ' showing' : ''}` },
        h('dt', {}, row.name),
        h('dd', {}, formatRange(row.start, row.end), row.note ? h('small', {}, row.note) : null),
      );
    }),
  );
}

function cardHead(hall) {
  return h('div', { class: 'hall-head' }, h('h2', {}, hall.name), h('span', { class: 'hall-college' }, hall.college));
}

function cardFoot(hall, day, view) {
  const age = freshness(day.source);
  return h(
    'div',
    { class: 'hall-foot' },
    h('span', {}, SOURCES[day.source.kind].label, age.text ? [' · ', h('span', { class: age.stale ? 'stale' : null }, age.text)] : null),
    h('a', { href: menuLink(hall, day, state.date, view.meals[0]), target: '_blank', rel: 'noopener' }, 'Original menu ↗'),
  );
}

// ---------- cards ----------

function showLoading(hall, card) {
  card.replaceChildren(cardHead(hall), h('div', { class: 'skeleton', 'aria-label': 'Loading menu' }, h('span'), h('span'), h('span')));
}

function fillCard(hall, card, day) {
  const view = buildView(day, state.slot);
  counts.set(hall.id, view.halal.length);
  const parts = [cardHead(hall)];

  if (day.status !== 'ok') {
    parts.push(h('p', { class: 'empty' }, day.message));
  } else if (!view.meals.length) {
    parts.push(hoursList(day, view), h('p', { class: 'empty' }, `No ${slotLabel().toLowerCase()} menu posted for this day.`));
  } else {
    parts.push(hoursList(day, view));
    if (day.source.kind === '5cmenu') {
      parts.push(
        h('p', { class: 'notice' }, 'Showing a third-party copy because this hall’s own menu did not load. Only dishes with “halal” in the name can appear, and seafood is matched by name.'),
      );
    }
    parts.push(
      group('halal', 'Halal', view.halal, 'None labelled halal on this menu.', hall, day),
      group('seafood', 'Seafood', view.seafood, 'No seafood dishes listed.', hall, day),
      fullMenu(hall, day, view),
    );
  }
  parts.push(cardFoot(hall, day, view));
  card.replaceChildren(...parts.filter(Boolean));
}

function renderSummary() {
  const withHalal = HALLS.filter((hall) => counts.get(hall.id) > 0);
  const pending = HALLS.some((hall) => !counts.has(hall.id));
  const status = pending ? 'loading menus…' : withHalal.length ? '' : 'no hall has a dish labelled halal for this meal.';
  $('summary').replaceChildren(
    h('span', { class: 'summary-label' }, `Halal at ${slotLabel().toLowerCase()}:`),
    ...withHalal.map((hall) => h('a', { class: 'jump', href: `#hall-${hall.id}` }, hall.name, h('b', {}, String(counts.get(hall.id))))),
    h('span', { class: 'summary-none' }, status),
  );
}

function renderControls() {
  $('dates').replaceChildren(
    ...dates.map((date) =>
      h(
        'button',
        {
          class: 'date',
          type: 'button',
          'aria-pressed': String(date === state.date),
          'aria-label': formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' }),
          onclick: () => update({ date }),
        },
        h('small', {}, date === today ? 'Today' : formatDate(date, { weekday: 'short' })),
        h('strong', {}, formatDate(date, { day: 'numeric' })),
      ),
    ),
  );
  $('meals').replaceChildren(
    ...SLOTS.map(([slot, label]) => h('button', { class: 'meal', type: 'button', 'aria-pressed': String(slot === state.slot), onclick: () => update({ slot }) }, label)),
  );
}

function render() {
  const token = ++renderToken;
  counts.clear();
  renderControls();
  for (const hall of HALLS) {
    const key = `${hall.id}|${state.date}`;
    const card = cards.get(hall.id);
    if (loaded.has(key)) {
      fillCard(hall, card, loaded.get(key));
      continue;
    }
    showLoading(hall, card);
    loadHallDay(hall, state.date).then((day) => {
      loaded.set(key, day);
      if (token !== renderToken) return;
      fillCard(hall, card, day);
      renderSummary();
    });
  }
  renderSummary();
}

function update(change) {
  Object.assign(state, change);
  history.replaceState(null, '', `?date=${state.date}&meal=${state.slot}`);
  render();
}

// ---------- detail dialog ----------

function field(label, value, extraClass) {
  return h('div', { class: `field${extraClass ? ` ${extraClass}` : ''}` }, h('dt', {}, label), h('dd', {}, value));
}

const absent = (text) => h('span', { class: 'absent' }, text);

// The ingredient words behind a verdict, so they can be found in a long list.
function flaggedWords(verdict) {
  const words = verdict.cautions.map((caution) => caution.word).filter(Boolean);
  if (verdict.halal?.basis === 'ingredients') words.push('halal');
  return words;
}

function marked(text, words) {
  if (!words.length) return text;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  return text.split(pattern).map((part, index) => (index % 2 ? h('mark', { class: /^halal$/i.test(part) ? 'good' : null }, part) : part));
}

function halalField(item, kind) {
  if (item.halalFlag === true) return field('Halal', kind === 'bonappetit' ? 'Yes (Halal icon shown)' : 'Yes', 'key');
  if (item.halalFlag === false) return field('Halal', 'No', 'key no');
  return field('Halal', absent(kind === 'bonappetit' ? 'No Halal icon on this dish' : 'This menu has no halal field'));
}

function listing(item, verdict, day) {
  const kind = day.source.kind;
  const source = SOURCES[kind];
  const age = freshness(day.source);
  const otherFlags = (item.dietary ?? []).filter(([name]) => name !== 'Halal');
  const serving = [item.portion, item.calories ? `${item.calories} cal` : ''].filter(Boolean).join(' · ');

  return h(
    'section',
    { class: 'listing' },
    h('div', { class: 'listing-head' }, h('h3', {}, `As listed by: ${source.label}`), age.text ? h('p', {}, age.text[0].toUpperCase() + age.text.slice(1)) : null),
    h(
      'dl',
      { class: 'fields' },
      field('Name', item.name),
      item.description ? field('Description', item.description) : null,
      item.station ? field('Station', item.station) : null,
      halalField(item, kind),
      otherFlags.length
        ? field(
            'Other flags',
            h('span', { class: 'flags' }, otherFlags.map(([name, value]) => h('span', { class: value === 'Yes' ? 'flag-yes' : 'flag-no' }, `${name}: ${value}`))),
          )
        : null,
      kind === 'bonappetit' ? field('Menu icons', item.labels.length ? item.labels.join(', ') : absent('None')) : null,
      field('Allergens', item.allergens.length ? item.allergens.join(', ') : absent(item.allergenInfo ? 'None listed' : 'Not provided')),
      field('Ingredients', item.ingredients ? marked(item.ingredients, flaggedWords(verdict)) : absent('Not published for this dish')),
      serving ? field('Serving', serving) : null,
      item.record && item.record !== item.name ? field('Kitchen record', item.record) : null,
    ),
    h('p', { class: 'source-note' }, source.note),
  );
}

function reasons(item, verdict) {
  const blocks = [];
  if (verdict.halal) {
    blocks.push(h('div', { class: 'reason' }, h('h3', {}, 'Why it is shown as halal'), h('p', {}, verdict.halal.text)));
  }
  if (verdict.seafood) {
    blocks.push(h('div', { class: 'reason sea' }, h('h3', {}, 'Why it is shown as seafood'), h('p', {}, verdict.seafood.text)));
  }
  if (!verdict.halal && !verdict.seafood) {
    const text = item.halalFlag === false ? 'The hall’s own menu marks this dish Halal: No.' : 'Nothing on the hall’s menu marks this dish as halal.';
    blocks.push(h('div', { class: 'reason none' }, h('h3', {}, 'Not shown as halal'), h('p', {}, text)));
  }
  if (verdict.cautions.length) {
    blocks.push(h('div', { class: 'reason warn' }, h('h3', {}, 'Check before you eat'), h('ul', {}, verdict.cautions.map((caution) => h('li', {}, caution.text)))));
  }
  return blocks;
}

function openDetail(hall, day, entry) {
  const { item, meal, verdict } = entry;
  const dialog = $('detail');
  $('detail-body').replaceChildren(
    h(
      'div',
      { class: 'detail-top' },
      h(
        'div',
        {},
        h('p', { class: 'eyebrow' }, `${hall.name} · ${meal.name} · ${formatDate(state.date, { weekday: 'short', month: 'short', day: 'numeric' })}`),
        h('h2', { id: 'detail-title', class: isLower(item.name) ? 'lower' : null }, item.name),
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕'),
    ),
    h('div', { class: 'detail-chips' }, verdictChips(verdict)),
    ...reasons(item, verdict),
    listing(item, verdict, day),
    h('a', { class: 'original', href: menuLink(hall, day, state.date, meal, entry), target: '_blank', rel: 'noopener' }, `Find it on ${hall.name}’s menu ↗`),
    h('p', { class: 'where' }, `On that page: ${whereOnPage(hall, day, state.date, meal, item)}.`),
    h('p', { class: 'fineprint' }, 'This page repeats what the hall published. It is not a halal certification, so ask dining staff if anything is unclear.'),
  );
  dialog.showModal();
  dialog.scrollTop = 0;
}

// ---------- hadith of the day ----------

async function renderHadith() {
  try {
    const hadith = await hadithOfTheDay();
    const text = h('p', { class: 'hadith-text' }, hadith.text);
    $('hadith-body').replaceChildren(text, h('a', { class: 'hadith-ref', href: hadith.link, target: '_blank', rel: 'noopener' }, `${hadith.cite} ↗`));
  } catch (err) {
    console.warn('hadith of the day failed to load', err);
    $('hadith-section').hidden = true;
  }
}

// ---------- light and dark ----------

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Storage is blocked (private browsing): the choice lasts for this visit only.
  }
}

// ---------- installing and working offline ----------

// sw.js keeps the last good copy of everything the page loads.
function setUpOffline() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('offline support unavailable', err));
  const startedOffline = !navigator.onLine;
  $('offline').hidden = navigator.onLine;
  window.addEventListener('offline', () => ($('offline').hidden = false));
  // Saved menus were shown; fetch the real ones now that there is a signal.
  window.addEventListener('online', () => (startedOffline ? location.reload() : ($('offline').hidden = true)));
}

// Android offers the install itself, so the bar gets a button. iPhones have no
// such offer, only the Share menu, so the bar says where to tap.
function setUpInstallHint() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('install-hint') === 'dismissed';
  } catch {
    // Storage is blocked: show the hint each visit.
  }
  if (installed || dismissed) return;

  const bar = $('install');
  const close = () => {
    bar.hidden = true;
    try {
      localStorage.setItem('install-hint', 'dismissed');
    } catch {
      // Not remembered; it will show again next visit.
    }
  };
  $('install-close').addEventListener('click', close);
  window.addEventListener('appinstalled', close);

  window.addEventListener('beforeinstallprompt', (offer) => {
    offer.preventDefault();
    $('install-text').textContent = 'Add 5C Halal to your home screen for one-tap access, even offline.';
    $('install-go').hidden = false;
    $('install-go').onclick = async () => {
      offer.prompt();
      await offer.userChoice;
      close();
    };
    bar.hidden = false;
  });

  const iPhone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iPhone) {
    $('install-text').textContent = 'Add 5C Halal to your Home Screen: tap the Share button, then “Add to Home Screen”.';
    bar.hidden = false;
  }
}

// ---------- start ----------

$('theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
setTheme(document.documentElement.dataset.theme);


$('detail').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

for (const hall of HALLS) {
  const card = h('section', { class: 'hall', id: `hall-${hall.id}`, 'aria-label': `${hall.name} dining hall` });
  cards.set(hall.id, card);
  $('halls').append(card);
}

setUpOffline();
setUpInstallHint();
render();
renderHadith();
renderStats($('stats'), today);
