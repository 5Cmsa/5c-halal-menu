#!/usr/bin/env node
// Scrapes the dining halls whose menu pages a browser can't read cross-site
// (Bon Appétit: Collins, Malott, McConnell; Sodexo: Hoch) and writes one JSON
// file per hall into data/. Pomona's menus are loaded live by the page itself,
// but its feed has no serving times, so those are scraped here as well.
//
// Usage: node scripts/scrape.mjs            (needs Node 18+, no dependencies)
//        SCRAPE_DAYS=3 node scripts/scrape.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DAYS = Number(process.env.SCRAPE_DAYS ?? 7);
const TIME_ZONE = 'America/Los_Angeles';
const USER_AGENT = '5c-halal-menu/1.0 (student menu reader; low-volume scheduled fetch)';
const PAUSE_MS = 500;

export const BON_APPETIT = [
  { id: 'collins', base: 'https://collins-cmc.cafebonappetit.com/cafe/collins/' },
  { id: 'malott', base: 'https://scripps.cafebonappetit.com/cafe/malott-dining-commons/' },
  { id: 'mcconnell', base: 'https://pitzer.cafebonappetit.com/cafe/mcconnell-bistro/' },
];

export const SODEXO = [
  {
    id: 'hoch',
    weekUrl: (date) => {
      const [y, m, d] = date.split('-');
      return `https://menus.sodexomyway.com/BiteMenu/MenuOnly?menuId=15258&locationId=13147001&startdate=${m}/${d}/${y}`;
    },
  },
];

const POMONA = [
  { id: 'frary', url: 'https://www.pomona.edu/administration/dining/menus/frary' },
  { id: 'frank', url: 'https://www.pomona.edu/administration/dining/menus/frank' },
];

// Bon Appétit marks allergens with the same icon set it uses for diets.
const BA_ALLERGENS = new Set(['Peanut', 'Tree Nut', 'Sesame', 'Fish', 'Shellfish', 'Wheat/Gluten', 'Milk', 'Egg', 'Soy']);

// ---------- helpers ----------

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function fetchPage(url, accept = 'text/html,application/xhtml+xml') {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { text: await res.text(), finalUrl: res.url };
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }
  throw lastError;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
  });
}

function clean(value) {
  if (value == null) return '';
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function titleCase(text) {
  return clean(text).toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

// Parses the JSON value that starts at the first { or [ at or after `from`.
function jsonAt(text, from) {
  const start = from + text.slice(from).search(/[[{]/);
  if (start < from) throw new Error('no JSON value found');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unterminated JSON value');
}

function assigned(html, pattern) {
  const match = pattern.exec(html);
  return match ? jsonAt(html, match.index + match[0].length) : null;
}

// ---------- Bon Appétit ----------

export function parseBonAppetit(html) {
  const rawItems = assigned(html, /Bamco\.menu_items\s*=\s*/);
  if (!rawItems) throw new Error('menu data not found in page');
  const legend = assigned(html, /Bamco\.cor_icons\s*=\s*/) ?? {};
  const legendLabels = Object.values(legend).map((icon) => icon.label);
  const hallListsAllergens = legendLabels.some((label) => BA_ALLERGENS.has(label));

  const items = {};
  const toItem = (raw) => {
    const labels = Object.values(raw.cor_icon && !Array.isArray(raw.cor_icon) ? raw.cor_icon : {});
    const calories = Number(raw.nutrition_details?.calories?.value);
    return {
      id: String(raw.id),
      name: clean(raw.label),
      description: clean(raw.description),
      featured: Number(raw.special) === 1,
      vegetarian: labels.includes('Vegetarian') || labels.includes('Vegan'),
      vegan: labels.includes('Vegan'),
      // Kitchens can add a Halal icon to a dish; there is no icon for "not halal".
      halalFlag: labels.includes('Halal') ? true : null,
      labels,
      allergens: labels.filter((label) => BA_ALLERGENS.has(label)),
      allergenInfo: hallListsAllergens && !labels.includes('Information Unavailable'),
      ingredients: clean(raw.ingredients),
      calories: Number.isFinite(calories) && calories > 0 ? calories : null,
    };
  };

  // Each meal sits in its own <section id="lunch">, which a link can jump to.
  const sections = [...html.matchAll(/<section[^>]*\bsite-panel--daypart\b[^>]*>/g)].map((m) => ({ at: m.index, id: /\sid="([^"]+)"/.exec(m[0])?.[1] ?? null }));

  const meals = [];
  const daypart = /Bamco\.dayparts\['(\d+)'\]\s*=\s*/g;
  for (let match; (match = daypart.exec(html)); ) {
    const part = jsonAt(html, match.index + match[0].length);
    const anchor = sections.findLast((section) => section.at < match.index)?.id ?? null;
    const stations = [];
    for (const station of part.stations ?? []) {
      const ids = (station.items ?? []).map(String).filter((id) => rawItems[id]);
      for (const id of ids) items[id] ??= toItem(rawItems[id]);
      if (ids.length) stations.push({ name: clean(station.label), items: ids });
    }
    if (stations.length) {
      meals.push({ name: clean(part.label), anchor, start: part.starttime || null, end: part.endtime || null, stations });
    }
  }
  return { meals, items, legend: legendLabels };
}

async function scrapeBonAppetit(hall, dates) {
  const days = {};
  const items = {};
  const errors = [];
  let legend = [];
  for (const date of dates) {
    const url = `${hall.base}${date}/`;
    try {
      const { text, finalUrl } = await fetchPage(url);
      // An unknown date redirects to the cafe's front page, which shows today.
      if (!finalUrl.includes(date)) throw new Error(`redirected to ${finalUrl}`);
      const parsed = parseBonAppetit(text);
      Object.assign(items, parsed.items);
      legend = parsed.legend;
      days[date] = { url, fetchedAt: new Date().toISOString(), meals: parsed.meals };
      console.log(`  ${hall.id} ${date}: ${parsed.meals.length} meals`);
    } catch (err) {
      errors.push(`${date}: ${err.message}`);
      console.warn(`  ${hall.id} ${date}: FAILED ${err.message}`);
    }
    await sleep(PAUSE_MS);
  }
  return {
    source: { kind: 'bonappetit', home: hall.base, dietaryLabels: legend },
    days,
    items,
    errors,
  };
}

// ---------- Sodexo ----------

export function parseSodexoWeek(html) {
  const open = /<div[^>]*id=['"]nutData['"][^>]*>/.exec(html);
  if (!open) throw new Error('menu data not found in page');
  const start = open.index + open[0].length;
  const week = JSON.parse(decodeEntities(html.slice(start, html.indexOf('</div>', start))));

  const days = {};
  const items = {};
  for (const day of week) {
    const date = String(day.date).slice(0, 10);
    const meals = [];
    for (const part of day.dayParts ?? []) {
      const stations = [];
      let startTime = null;
      let endTime = null;
      for (const course of part.courses ?? []) {
        const ids = [];
        for (const raw of course.menuItems ?? []) {
          const name = clean(raw.formalName);
          // Sodexo pads empty stations with a placeholder card.
          if (!name || /^have a nice day$/i.test(name)) continue;
          const id = String(raw.foodItemId ?? raw.menuItemId);
          const allergens = (raw.allergens ?? []).filter((a) => String(a.contains) === 'true').map((a) => a.name);
          const ingredients = clean(raw.biteMenuItemSizes?.[0]?.ingredients);
          const calories = Number(raw.calories);
          items[id] ??= {
            id,
            name,
            description: clean(raw.description),
            featured: true,
            vegetarian: Boolean(raw.isVegetarian || raw.isVegan),
            vegan: Boolean(raw.isVegan),
            halalFlag: null,
            dietary: [
              ['Vegan', raw.isVegan ? 'Yes' : 'No'],
              ['Vegetarian', raw.isVegetarian ? 'Yes' : 'No'],
              ['Mindful', raw.isMindful ? 'Yes' : 'No'],
            ],
            labels: [],
            allergens,
            allergenInfo: allergens.length > 0 || ingredients.length > 0,
            ingredients,
            calories: Number.isFinite(calories) && calories > 0 ? calories : null,
            portion: clean(raw.portion),
          };
          ids.push(id);
          startTime ??= raw.startTime ? String(raw.startTime).slice(11, 16) : null;
          endTime ??= raw.endTime ? String(raw.endTime).slice(11, 16) : null;
        }
        if (ids.length) stations.push({ name: titleCase(course.courseName), items: [...new Set(ids)] });
      }
      if (stations.length) meals.push({ name: titleCase(part.dayPartName), start: startTime, end: endTime, stations });
    }
    days[date] = { meals };
  }
  return { days, items };
}

async function scrapeSodexo(hall, dates) {
  const days = {};
  const items = {};
  const errors = [];
  const wanted = new Set(dates);
  let cursor = dates[0];
  // Each page holds one Sunday-to-Saturday week, so a 7-day window needs up to two.
  for (let page = 0; page < 3 && cursor <= dates.at(-1); page++) {
    const url = hall.weekUrl(cursor);
    try {
      const { text } = await fetchPage(url);
      const parsed = parseSodexoWeek(text);
      Object.assign(items, parsed.items);
      const fetchedAt = new Date().toISOString();
      const covered = Object.keys(parsed.days).sort();
      for (const date of covered) {
        // Asking for a date opens the page with that day's tab selected.
        if (wanted.has(date)) days[date] = { url: hall.weekUrl(date), fetchedAt, meals: parsed.days[date].meals };
      }
      console.log(`  ${hall.id} week of ${cursor}: ${covered.length} days`);
      const last = covered.at(-1);
      cursor = last && last >= cursor ? addDays(last, 1) : addDays(cursor, 7);
    } catch (err) {
      errors.push(`week of ${cursor}: ${err.message}`);
      console.warn(`  ${hall.id} week of ${cursor}: FAILED ${err.message}`);
      cursor = addDays(cursor, 7);
    }
    await sleep(PAUSE_MS);
  }
  return {
    source: { kind: 'sodexo', home: 'https://hmc.sodexomyway.com/en-us/locations/hoch-shanahan-dining-commons' },
    days,
    items,
    errors,
  };
}

// ---------- Pomona serving hours ----------

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "Monday – Friday" -> [1..5], "Saturdays & Sundays (and holidays)" -> [6, 0]
function parseDays(text) {
  const found = [...text.toLowerCase().matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g)].map((m) => WEEKDAYS.indexOf(m[1]));
  if (found.length === 2 && /[–—-]|\bto\b|\bthrough\b/.test(text)) {
    const days = [];
    for (let day = found[0]; ; day = (day + 1) % 7) {
      days.push(day);
      if (day === found[1]) return days;
    }
  }
  return found;
}

// "7:30 – 10 a.m." -> ["07:30", "10:00"]. A start with no a.m./p.m. takes the
// end's, unless that would put it after the end ("11 – 1:30 p.m.").
function parseTimeRange(text) {
  const match = /(\d{1,2})(?::(\d{2}))?\s*\.?\s*([ap])?\.?\s*(?:m\.?)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*\.?\s*([ap])\.?\s*m\.?/i.exec(text);
  if (!match) return null;
  const minutes = (hour, minute, meridiem) => ((Number(hour) % 12) + (meridiem === 'p' ? 12 : 0)) * 60 + Number(minute ?? 0);
  const endMeridiem = match[6].toLowerCase();
  const end = minutes(match[4], match[5], endMeridiem);
  let start = minutes(match[1], match[2], (match[3] ?? endMeridiem).toLowerCase());
  if (!match[3] && start > end) start = minutes(match[1], match[2], 'a');
  const clock = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return { start: clock(start), end: clock(end), rest: text.slice(match.index + match[0].length) };
}

export function parsePomonaHours(html) {
  // Past holiday notices are left in the page as HTML comments.
  const visible = html.replace(/<!--[\s\S]*?-->/g, '');
  const block = /<div class="dining-hours-top[^"]*">([\s\S]*?)<div class="dining-hall-location/.exec(visible);
  if (!block) throw new Error('hours block not found in page');
  const groups = [];
  for (const [, paragraph] of block[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const meals = [];
    for (const line of paragraph.split(/<br\s*\/?>/)) {
      const label = /<span[^>]*>([\s\S]*?)<\/span>([\s\S]*)/.exec(line);
      const range = label && parseTimeRange(clean(label[2]));
      if (!range) continue;
      meals.push({
        name: clean(label[1]).replace(/\s*:\s*$/, ''),
        start: range.start,
        end: range.end,
        note: clean(range.rest).replace(/^[\s.,;–-]+/, ''),
      });
    }
    const label = clean(paragraph);
    const days = parseDays(label);
    if (meals.length && groups.length) groups.at(-1).meals.push(...meals);
    else if (!meals.length && days.length) groups.push({ label, days, meals: [] });
  }
  // A heading with a date in it ("Friday, March 20") is a one-off notice, not
  // a weekly rule; the menu feed itself marks days the hall is closed.
  return groups.filter((group) => group.meals.length && !/\d/.test(group.label));
}

export async function scrapePomonaHours() {
  const file = path.join(DATA_DIR, 'pomona-hours.json');
  let halls = {};
  try {
    halls = JSON.parse(await readFile(file, 'utf8')).halls ?? {};
  } catch {
    // first run
  }
  for (const hall of POMONA) {
    try {
      const { text } = await fetchPage(hall.url);
      const groups = parsePomonaHours(text);
      if (!groups.length) throw new Error('no hours found');
      halls[hall.id] = { url: hall.url, fetchedAt: new Date().toISOString(), groups };
      console.log(`  ${hall.id} hours: ${groups.map((g) => `${g.label} (${g.meals.length})`).join(', ')}`);
    } catch (err) {
      // Keep whatever the last good run found.
      console.warn(`  ${hall.id} hours: FAILED ${err.message}`);
    }
    await sleep(PAUSE_MS);
  }
  await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), halls }));
}

// ---------- output ----------

// Keeps days a failed run couldn't refresh, so one bad fetch doesn't blank a hall.
async function mergeWithPrevious(file, fresh, firstDate) {
  let previous;
  try {
    previous = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fresh;
  }
  for (const [date, day] of Object.entries(previous.days ?? {})) {
    if (date >= firstDate && !fresh.days[date]) {
      fresh.days[date] = day;
      for (const meal of day.meals) {
        for (const station of meal.stations) {
          for (const id of station.items) fresh.items[id] ??= previous.items?.[id];
        }
      }
    }
  }
  return fresh;
}

function pruneItems(result) {
  const used = new Set();
  for (const day of Object.values(result.days)) {
    for (const meal of day.meals) for (const station of meal.stations) station.items.forEach((id) => used.add(id));
  }
  result.items = Object.fromEntries(Object.entries(result.items).filter(([id, item]) => used.has(id) && item));
}

async function main() {
  const first = today();
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(first, i));
  await mkdir(DATA_DIR, { recursive: true });
  console.log(`Scraping ${dates[0]} to ${dates.at(-1)}`);

  const jobs = [
    ...BON_APPETIT.map((hall) => [hall, scrapeBonAppetit]),
    ...SODEXO.map((hall) => [hall, scrapeSodexo]),
  ];
  let hallsWithFreshData = 0;
  for (const [hall, scrape] of jobs) {
    console.log(hall.id);
    const fresh = await scrape(hall, dates);
    if (Object.keys(fresh.days).length) hallsWithFreshData++;
    const file = path.join(DATA_DIR, `${hall.id}.json`);
    const result = await mergeWithPrevious(file, fresh, first);
    pruneItems(result);
    const sortedDays = Object.fromEntries(Object.entries(result.days).sort(([a], [b]) => a.localeCompare(b)));
    const output = {
      hall: hall.id,
      generatedAt: new Date().toISOString(),
      source: result.source,
      errors: result.errors,
      days: sortedDays,
      items: result.items,
    };
    await writeFile(file, JSON.stringify(output));
    console.log(`  wrote ${path.relative(process.cwd(), file)} (${Object.keys(sortedDays).length} days, ${Object.keys(result.items).length} items)`);
  }

  console.log('pomona hours');
  await scrapePomonaHours();

  if (hallsWithFreshData === 0) {
    console.error('Every hall failed to scrape.');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
