#!/usr/bin/env node
// Keeps data/history.json, the record behind the site's "track record" chart:
// for every hall and day, how many halal dishes the daytime meals and dinner
// had, and how many of those carry no warning.
//
//   node scripts/history.mjs                         record today from the current menus
//   node scripts/history.mjs --backfill 2026-08-31   also fill in past days from that date on,
//                                                    for the halls whose sites still show them
//
// Run after scripts/scrape.mjs, which refreshes the menus this reads.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { classify } from '../js/classify.js';
import { HALLS } from '../js/halls.js';
import { indexPomonaFeed, mealsFromFile } from '../js/sources.js';
import { BON_APPETIT, DATA_DIR, SODEXO, addDays, fetchPage, parseBonAppetit, parseSodexoWeek, sleep, today } from './scrape.mjs';

const FILE = path.join(DATA_DIR, 'history.json');
const KEEP_DAYS = 200; // a little more than the six months the chart shows
const PAUSE_MS = 400;

// { daytime: { halal, clear }, dinner: { halal, clear } }, with a period left
// out when the hall served nothing in it. Breakfast, brunch and lunch are one
// daytime period. "clear" counts halal dishes with no warning attached.
function tally(meals) {
  const periods = {};
  for (const meal of meals) {
    if (!meal.items.length) continue;
    const dishes = (periods[meal.slot === 'dinner' ? 'dinner' : 'daytime'] ??= new Map());
    for (const item of meal.items) {
      const verdict = classify(item);
      if (!verdict.halal) continue;
      const name = item.name.toLowerCase();
      dishes.set(name, dishes.get(name) || verdict.cautions.length === 0);
    }
  }
  return Object.fromEntries(
    Object.entries(periods).map(([period, dishes]) => [period, { halal: dishes.size, clear: [...dishes.values()].filter(Boolean).length }]),
  );
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- today ----------

async function pomonaMeals(hall, date) {
  const { text } = await fetchPage(hall.feed, '*/*');
  // The feed is JSON wrapped in a call: menuData({...});
  const days = indexPomonaFeed(JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))));
  return days.has(date) ? [...days.get(date).values()] : null;
}

async function recordToday(history, date) {
  for (const hall of HALLS) {
    try {
      const meals = hall.site === 'pomona' ? await pomonaMeals(hall, date) : mealsFromFile((await readJson(path.join(DATA_DIR, `${hall.id}.json`))) ?? {}, date);
      if (!meals) {
        console.warn(`  ${hall.id} ${date}: no menu for today, left as it was`);
        continue;
      }
      history.halls[hall.id] ??= {};
      history.halls[hall.id][date] = tally(meals);
      console.log(`  ${hall.id} ${date}: ${JSON.stringify(history.halls[hall.id][date])}`);
    } catch (err) {
      console.warn(`  ${hall.id} ${date}: FAILED ${err.message}`);
    }
  }
}

// ---------- the past ----------

// Pomona's feed only holds the current week, so Frary and Frank cannot be
// filled in; Bon Appétit and Sodexo still serve their old pages.
async function backfill(history, from, until) {
  for (const hall of BON_APPETIT) {
    const days = (history.halls[hall.id] ??= {});
    for (let date = from; date < until; date = addDays(date, 1)) {
      if (days[date]) continue;
      try {
        const { text, finalUrl } = await fetchPage(`${hall.base}${date}/`);
        if (!finalUrl.includes(date)) throw new Error('no page for that day');
        const parsed = parseBonAppetit(text);
        days[date] = tally(mealsFromFile({ days: { [date]: { meals: parsed.meals } }, items: parsed.items }, date));
        console.log(`  ${hall.id} ${date}: ${JSON.stringify(days[date])}`);
      } catch (err) {
        console.warn(`  ${hall.id} ${date}: skipped (${err.message})`);
      }
      await sleep(PAUSE_MS);
    }
  }

  for (const hall of SODEXO) {
    const days = (history.halls[hall.id] ??= {});
    for (let cursor = from; cursor < until; ) {
      let next = addDays(cursor, 7);
      try {
        const parsed = parseSodexoWeek((await fetchPage(hall.weekUrl(cursor))).text);
        const covered = Object.keys(parsed.days).sort();
        for (const date of covered) {
          if (date < from || date >= until || days[date]) continue;
          days[date] = tally(mealsFromFile(parsed, date));
          console.log(`  ${hall.id} ${date}: ${JSON.stringify(days[date])}`);
        }
        if (covered.length && covered.at(-1) >= cursor) next = addDays(covered.at(-1), 1);
      } catch (err) {
        console.warn(`  ${hall.id} week of ${cursor}: skipped (${err.message})`);
      }
      cursor = next;
      await sleep(PAUSE_MS);
    }
  }
}

// ---------- run ----------

const date = today();
const history = (await readJson(FILE)) ?? { halls: {} };

const flag = process.argv.indexOf('--backfill');
if (flag !== -1) {
  const from = process.argv[flag + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) {
    console.error('usage: node scripts/history.mjs --backfill YYYY-MM-DD');
    process.exit(2);
  }
  console.log(`Filling in ${from} to ${addDays(date, -1)}`);
  await backfill(history, from, date);
}

console.log(`Recording ${date}`);
await recordToday(history, date);

const oldest = addDays(date, -KEEP_DAYS);
for (const [id, days] of Object.entries(history.halls)) {
  history.halls[id] = Object.fromEntries(
    Object.entries(days)
      .filter(([day]) => day >= oldest)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
history.updatedAt = new Date().toISOString();
await writeFile(FILE, JSON.stringify(history));
console.log(`wrote ${path.relative(process.cwd(), FILE)}`);
