// Loads one hall's menu for one date and returns it in a single shape,
// whichever source it came from:
//
//   { status: 'ok' | 'empty' | 'error', message?, source: { kind, url, fetchedAt },
//     hours: [{ name, start, end, note }],
//     meals: [{ name, slot, start, end, items: [item] }] }
//
// Order of preference: the hall's own data (Pomona's live feed, or the JSON
// written by scripts/scrape.mjs), then the third-party 5C Menu API.

const FALLBACK_API = 'https://5cmenu-cache.jojodmo.com/v1/getMenu/';
const TIME_ZONE = 'America/Los_Angeles';

const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

export function slotFor(name, start) {
  const text = name.toLowerCase();
  if (text.includes('brunch')) return 'brunch';
  if (text.includes('breakfast')) return 'breakfast';
  if (text.includes('lunch')) return 'lunch';
  if (text.includes('dinner') || text.includes('late') || text.includes('night')) return 'dinner';
  if (start) return start < '10:30' ? 'breakfast' : start < '15:00' ? 'lunch' : 'dinner';
  return 'lunch';
}

// "Lunch only" on the hours page and "Lunch" in the menu are the same meal.
export function sameMeal(a, b) {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x.startsWith(y) || y.startsWith(x);
}

const hoursFromMeals = (meals) => meals.filter((meal) => meal.start && meal.end).map(({ name, start, end }) => ({ name, start, end, note: '' }));

function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

// ---------- Pomona (live JSONP feed) ----------

const pomonaFeeds = new Map();
let jsonpQueue = Promise.resolve();

// Pomona's feed always calls a global named menuData, so feeds load one at a time.
function jsonp(url) {
  const run = () =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const finish = (settle, value) => {
        clearTimeout(timer);
        delete window.menuData;
        script.remove();
        settle(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('timed out')), 15000);
      window.menuData = (data) => finish(resolve, data);
      script.onerror = () => finish(reject, new Error('feed failed to load'));
      script.src = url;
      document.head.append(script);
    });
  const result = jsonpQueue.then(run);
  jsonpQueue = result.catch(() => {});
  return result;
}

function pomonaItem(recipe) {
  const dietary = asArray(recipe.dietaryChoices?.dietaryChoice).map((c) => [c['@id'], c['#text']]);
  const yes = (label) => dietary.some(([name, value]) => name === label && value === 'Yes');
  const halal = dietary.find(([name]) => name === 'Halal');
  const ingredients = recipe.ingredients;
  const calories = parseFloat(String(recipe['@nutrients'] ?? '').split('|')[0]);
  return {
    id: String(recipe['@id']),
    name: String(recipe['@shortName'] || recipe['@description'] || '').trim(),
    description: '',
    station: String(recipe['@category'] ?? '').trim(),
    featured: true,
    vegetarian: yes('Vegetarian') || yes('Vegan'),
    vegan: yes('Vegan'),
    halalFlag: halal ? halal[1] === 'Yes' : null,
    dietary,
    labels: [],
    allergens: asArray(recipe.allergens?.allergen).filter((a) => a['#text'] === 'Yes').map((a) => a['@id']),
    allergenInfo: Boolean(recipe.allergens),
    ingredients: String((typeof ingredients === 'object' ? ingredients?.['#cdata-section'] : ingredients) ?? '').trim(),
    calories: Number.isFinite(calories) && calories > 0 ? Math.round(calories) : null,
    portion: String(recipe['@servingDescription'] ?? '').trim(),
    record: String(recipe['@description'] ?? '').trim(),
  };
}

export function indexPomonaFeed(feed) {
  const days = new Map();
  for (const menu of asArray(feed?.EatecExchange?.menu)) {
    const raw = String(menu['@servedate'] ?? '');
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (!days.has(date)) days.set(date, new Map());
    const period = String(menu['@mealperiodname'] ?? '').trim();
    if (!period || period.toLowerCase() === 'closed') continue;
    // Frank files its brunch under the "Breakfast" period; the menu title has the real meal.
    const titled = /\b(breakfast|brunch|lunch|dinner)\b/i.exec(String(menu['@name'] ?? ''));
    const mealName = titled ? titleCase(titled[1]) : period;
    const meals = days.get(date);
    if (!meals.has(mealName)) meals.set(mealName, { name: mealName, listedAs: period, slot: slotFor(mealName), start: null, end: null, items: [], seen: new Set() });
    const meal = meals.get(mealName);
    for (const recipe of asArray(menu.recipes?.recipe)) {
      const item = pomonaItem(recipe);
      const key = `${item.station}|${item.id}`;
      // Pomona posts a placeholder item ("Closed for Breakfast Today") when a meal is closed.
      if (!item.name || /^closed\b/i.test(item.name) || meal.seen.has(key)) continue;
      meal.seen.add(key);
      meal.items.push(item);
    }
    if (!meal.items.length) meals.delete(mealName);
  }
  // On weekends Frary serves brunch and dinner, but Eatec still labels the
  // daytime menu "Breakfast" after the Monday template.
  for (const meals of days.values()) {
    if (meals.has('Breakfast') && !meals.has('Lunch') && !meals.has('Brunch')) {
      const meal = meals.get('Breakfast');
      meals.delete('Breakfast');
      meals.set('Brunch', { ...meal, name: 'Brunch', slot: 'brunch' });
    }
  }
  return days;
}

// Pomona's feed has no serving times; scripts/scrape.mjs reads them off the
// hall's page as weekly rules ("Monday – Friday", "Saturdays & Sundays").
let pomonaHours;

async function pomonaHoursFor(hall, date) {
  pomonaHours ??= fetch('data/pomona-hours.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  const groups = (await pomonaHours).halls?.[hall.id]?.groups ?? [];
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return groups.find((group) => group.days.includes(weekday))?.meals ?? [];
}

async function pomonaDay(hall, date) {
  if (!pomonaFeeds.has(hall.id)) {
    pomonaFeeds.set(hall.id, jsonp(hall.feed).then((feed) => ({ days: indexPomonaFeed(feed), fetchedAt: new Date().toISOString() })));
  }
  const { days, fetchedAt } = await pomonaFeeds.get(hall.id);
  if (!days.has(date)) return null;
  const listed = [...days.get(date).values()];
  const hours = listed.length ? await pomonaHoursFor(hall, date) : [];
  const meals = listed.map((meal) => {
    const row = hours.find((entry) => sameMeal(entry.name, meal.name));
    return row ? { ...meal, start: row.start, end: row.end } : meal;
  });
  return {
    status: meals.length ? 'ok' : 'empty',
    message: meals.length ? '' : 'Pomona lists this hall as closed for the day.',
    // Pomona's page shows the first day of its feed opened and the rest collapsed.
    source: { kind: 'pomona', url: hall.originalUrl(date), fetchedAt, live: true, openOnPage: date === days.keys().next().value },
    hours,
    meals,
  };
}

// ---------- Scraped halls (data/<hall>.json) ----------

const scrapedFiles = new Map();

// The scraper stores each dish once per hall and has meals refer to it by id.
// Returns null when the file has nothing for that date.
export function mealsFromFile(file, date) {
  const day = file.days?.[date];
  if (!day) return null;
  return day.meals.map((meal) => ({
    name: meal.name,
    anchor: meal.anchor ?? null,
    slot: slotFor(meal.name, meal.start),
    start: meal.start,
    end: meal.end,
    items: meal.stations.flatMap((station) =>
      station.items.filter((id) => file.items[id]).map((id) => ({ ...file.items[id], station: station.name })),
    ),
  }));
}

async function scrapedDay(hall, date) {
  if (!scrapedFiles.has(hall.id)) {
    scrapedFiles.set(
      hall.id,
      fetch(`data/${hall.id}.json`, { cache: 'no-cache' }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
    );
  }
  const file = await scrapedFiles.get(hall.id);
  const day = file.days?.[date];
  const meals = mealsFromFile(file, date);
  if (!meals) return null;
  return {
    status: meals.length ? 'ok' : 'empty',
    message: meals.length ? '' : 'The hall’s menu page shows no meals for this day.',
    source: { kind: file.source.kind, url: day.url ?? hall.originalUrl(date), fetchedAt: day.fetchedAt },
    hours: hoursFromMeals(meals),
    meals,
  };
}

// ---------- Fallback (5C Menu API) ----------

const fallbackCalls = new Map();

function clock(unixSeconds) {
  if (!unixSeconds) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(unixSeconds * 1000));
}

async function fallbackDay(hall, date) {
  const key = `${hall.id}|${date}`;
  if (!fallbackCalls.has(key)) {
    // Noon Pacific standard time lands inside the same calendar day all year.
    const startTime = Math.floor(Date.parse(`${date}T12:00:00-08:00`) / 1000);
    const url = `${FALLBACK_API}?diningHall=${hall.id}&startTime=${startTime}&language=en`;
    fallbackCalls.set(
      key,
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
    );
  }
  const { response } = await fallbackCalls.get(key);
  const source = { kind: '5cmenu', url: hall.originalUrl(date), fetchedAt: new Date().toISOString(), live: true };
  const day = asArray(response?.menu).find((d) => String(d.date).replace(/\D/g, '').slice(0, 8) === date.replace(/-/g, ''));
  if (!day) {
    return { status: 'empty', message: response?.messages?.screenMessage || 'No menu has been posted for this day.', source, hours: [], meals: [] };
  }
  const meals = Object.values(day.meals ?? {}).map((meal) => {
    const name = titleCase(String(meal.meal ?? 'Meal'));
    const start = clock(meal.startTime);
    return {
      name,
      slot: slotFor(name, start),
      start,
      end: clock(meal.endTime),
      items: asArray(meal.stations).flatMap((station) =>
        asArray(station.menu).map((raw, index) => ({
          id: `${station.station}|${raw.name}|${index}`,
          name: String(raw.name ?? '').trim(),
          description: String(raw.description ?? '').trim(),
          station: String(station.station ?? '').trim(),
          featured: true,
          vegetarian: Boolean(raw.vegetarian || raw.vegan),
          vegan: Boolean(raw.vegan),
          halalFlag: null,
          dietary: [
            ['Vegan', raw.vegan ? 'Yes' : 'No'],
            ['Vegetarian', raw.vegetarian ? 'Yes' : 'No'],
          ],
          labels: [],
          allergens: [],
          allergenInfo: false,
          ingredients: '',
          calories: Number.isFinite(raw.calories) && raw.calories > 0 ? Math.round(raw.calories) : null,
        })),
      ),
    };
  });
  return {
    status: meals.length ? 'ok' : 'empty',
    message: meals.length ? '' : 'No menu has been posted for this day.',
    source,
    hours: hoursFromMeals(meals),
    meals,
  };
}

// ---------- entry point ----------

export async function loadHallDay(hall, date) {
  try {
    const day = hall.primary === 'pomona' ? await pomonaDay(hall, date) : await scrapedDay(hall, date);
    if (day) return day;
  } catch (err) {
    console.warn(`${hall.id}: primary source failed, trying the fallback`, err);
  }
  try {
    return await fallbackDay(hall, date);
  } catch (err) {
    console.warn(`${hall.id}: fallback failed`, err);
    return {
      status: 'error',
      message: 'This hall’s menu could not be loaded right now.',
      source: { kind: '5cmenu', url: hall.originalUrl(date), fetchedAt: null },
      hours: [],
      meals: [],
    };
  }
}
