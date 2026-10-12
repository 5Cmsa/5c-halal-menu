// Builds the link to a hall's own menu page so that it opens as close as each
// site allows to the day, meal and dish being checked, and says in words where
// the dish sits on that page.
//
// Two mechanisms are used. An element id after the # jumps to a section the
// site built into its page. A text directive (#:~:text=...) makes the browser
// scroll to, and highlight, a phrase on the page; browsers that do not know it
// ignore it and open the page as usual.

const textArg = (text) => `text=${encodeURIComponent(text).replace(/-/g, '%2D')}`;

const slug = (text) => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function claremontNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function servingNow(date, meal) {
  const now = claremontNow();
  return Boolean(meal.start && meal.end) && date === now.date && meal.start <= now.time && now.time < meal.end;
}

// Pomona prints each day as "Thursday, October 15, 2026".
function pomonaDayHeading(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

const SITES = {
  // One page holds the week, a collapsed section per day, with only the first
  // day open. The dish can be found when its day is the open one; otherwise
  // the link lands on that day's heading, which the reader taps to open.
  pomona: {
    link({ day, date, entry }) {
      const base = `${day.source.url.split('#')[0]}#dining-menu-from-json`;
      const targets = [textArg(pomonaDayHeading(date))];
      if (entry && day.source.openOnPage) targets.unshift(textArg(entry.item.name));
      return `${base}:~:${targets.join('&')}`;
    },
    where({ day, date, meal, item }) {
      const heading = pomonaDayHeading(date);
      const path = [meal.listedAs ?? meal.name, item.station].filter(Boolean).join(' › ');
      return day.source.openOnPage ? `${heading} › ${path}` : `tap “${heading}” to open that day, then look under ${path}`;
    },
  },

  // One page per day with a section per meal. Only the meal being served is
  // unfolded, and the page's own script jumps to whichever section the link
  // names. So a featured dish in the meal on now is found by name; anything
  // else lands on its meal's heading, which the reader taps to unfold.
  bonappetit: {
    link({ day, date, meal, entry }) {
      const base = day.source.url.split('#')[0];
      if (!meal) return base;
      if (entry?.item.featured && servingNow(date, meal)) return `${base}#:~:${textArg(entry.item.name)}`;
      return `${base}#${meal.anchor ?? slug(meal.name)}`;
    },
    where({ date, meal, item }) {
      const path = [meal.name, item.station].filter(Boolean).join(' › ');
      return servingNow(date, meal) ? path : `tap ${meal.name} to open it${item.station ? `, then look under ${item.station}` : ''}`;
    },
  },

  // The link selects the day, but each meal is a collapsed section the page
  // gives no way to open from a link.
  sodexo: {
    link({ day }) {
      return day.source.url;
    },
    where({ meal, item }) {
      return `tap ${meal.name.toUpperCase()} to open it${item.station ? `, then look under ${item.station.toUpperCase()}` : ''}`;
    },
  },
};

// `meal` and `entry` are optional: without them the link goes to the day.
export function menuLink(hall, day, date, meal, entry) {
  return SITES[hall.site].link({ day, date, meal, entry });
}

export function whereOnPage(hall, day, date, meal, item) {
  return SITES[hall.site].where({ day, date, meal, item });
}
