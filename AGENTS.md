# 5C Halal Menu

Notes for any coding agent working on this project (Google Antigravity reads
this file as workspace rules; `CLAUDE.md` imports it). Machine-specific setup
is in `.agents/rules/local-setup.md`, which is not committed.

A website for Claremont Colleges (5C) students that shows, for each dining hall,
the halal dishes and seafood on the menu for a chosen day and meal, with a tap
through to exactly how the hall itself listed each dish (the "safety check").
It is run for the Claremont MSA. Most visitors are on phones.

- Live: https://5cmsa.github.io/5c-halal-menu/ (GitHub Pages, `main` branch, root)
- Code: https://github.com/5Cmsa/5c-halal-menu (owner `5Cmsa`; `taha6767`, the
  developer, is a collaborator with write access)
- `taha6767/5c-halal-menu` is an old copy that now only redirects to the new
  address. Never push the site there.

Pushing to `main` publishes the live site within about a minute.

## Ground rules

- **Pull before you edit and before you push.** A GitHub Actions job commits
  refreshed menu data to `main` four times a day (`Refresh menus` commits), so
  local `main` is usually behind: `git pull --ff-only`.
- No build step and no dependencies: plain HTML, CSS and ES modules served as
  files. Node 18+ is only used for the scripts in `scripts/`.
- Build DOM with `h()` from `js/dom.js`, which only ever inserts text. Menu data
  comes from other sites; never use `innerHTML` with it.
- Mobile first. Check every visual change at 375px wide, in light and dark.
- The look is deliberately simple. Islamic ornament (Iznik tile palette, a çini
  tile border, eight-pointed stars, the حلال emblem) stays light; don't add more
  decoration without being asked.
- When adding a file the page loads, also add it to `SHELL` in `sw.js`, or the
  installed app won't have it offline.
- Be honest in the UI about what the data can't tell you (see "What the data
  can and can't say"). That honesty is the point of the site.
- Commit messages: a short imperative subject and a body saying why.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | Page shell: masthead, hadith card, day/meal controls, hall cards, track record, install bar, dish dialog |
| `css/styles.css` | All styles. Colour tokens on `:root`; dark theme is `:root[data-theme="dark"]` |
| `js/app.js` | Renders everything: hall cards, hours, Halal/Seafood groups, full menu, dish sheet, theme switch, install hint, offline note |
| `js/halls.js` | The six halls (`site`: `pomona` / `bonappetit` / `sodexo`), their original-menu URLs, and how each source is described |
| `js/sources.js` | Loads one hall-day from its source and normalises it (see "Data sources"). Pure parts (`indexPomonaFeed`, `mealsFromFile`, `slotFor`) are reused by the scripts |
| `js/classify.js` | Decides halal / seafood / warnings for an item. Pure; also used by `scripts/history.mjs` |
| `js/links.js` | Builds the "Find it on X's menu" links and the "On that page: …" directions, per site |
| `js/hadith.js` | Hadith of the day: the list of references and the text clean-up |
| `js/stats.js` | The "Halal track record" chart, from `data/history.json` |
| `js/dom.js` | The `h()` element builder |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable web app and offline support |
| `scripts/scrape.mjs` | Scrapes Bon Appétit and Sodexo into `data/<hall>.json`, and Pomona's serving hours into `data/pomona-hours.json` |
| `scripts/history.mjs` | Adds today's halal counts to `data/history.json`; `--backfill YYYY-MM-DD` fills past days where the site still has them |
| `.github/workflows/refresh-menus.yml` | Runs both scripts at 01, 13, 17 and 21 UTC (about 6am, 10am, 2pm, 6pm Pacific) and commits `data/` |

Run locally: `npm run dev` serves on http://localhost:4173. `npm run scrape` and `npm run history` run the scripts; both
pace their requests, so don't loop them or run them in parallel.

## Data sources

Six halls. Oldenborg (Pomona) was removed on purpose: it is closed for a while.

### Pomona: Frary, Frank (`site: 'pomona'`)
- Read live in the browser from `https://api.pomona.edu/eatec/<Hall>.json`. It is
  JSONP with a fixed callback, `menuData(...)`, so feeds load one at a time
  (`jsonp()` in `sources.js`). From Node, request it with `Accept: */*`; an HTML
  Accept header gets HTTP 406.
- The best source: every dish has `Halal: Yes/No`, `Contains Pork/Beef/Poultry/Lamb`,
  allergens and full ingredients.
- Frank files brunch under the `Breakfast` meal period; the menu's `@name`
  says "Brunch", so the meal name is taken from `@name` and the raw period is kept
  as `listedAs` (Pomona's page shows the raw period).
- The feed has no serving times. `scrape.mjs` reads the weekly hours from each
  hall's page (the `dining-hours-top` block), ignoring commented-out notices and
  any heading containing a date (one-off holiday notices).
- The feed only holds the current week, so past days can't be backfilled.

### Bon Appétit: Collins (CMC), Malott (Scripps), McConnell (Pitzer) (`site: 'bonappetit'`)
- Scraped from `https://<site>.cafebonappetit.com/cafe/<cafe>/<YYYY-MM-DD>/`: the
  page embeds `Bamco.menu_items = {...}` and one `Bamco.dayparts['N'] = {...}` per
  meal. An unknown date redirects to the front page, so the final URL is checked.
- **Only `special: 1` items are that day's menu** (the "Specials" tab). The
  "Additional … Favorites" and "Condiments" tabs are a standing list that is
  identical every day whether or not a dish is out (checked: 99–100% of those
  items appear on every dinner). Those items have `featured: false`, are kept out
  of the Halal and Seafood lists (shown in a collapsed "N more on the standing
  list" group) and are not counted in the track record. A user caught this when a
  listed salmon dish wasn't there.
- McConnell uses Bon Appétit's **Halal icon** (`cor_icon` label `Halal`), which
  becomes `halalFlag: true`. There is no "not halal" icon.
- Collins and Malott have never labelled anything halal (no icon, no wording,
  nothing in ingredients) since at least Aug 31. That does not mean they serve
  none. The UI says so; keep it that way unless dining staff confirm otherwise.
- A day the café is closed shows "Closed" and has no menu data. The scraper
  currently records that as an error ("menu data not found in page"), so the
  day is missing from `data/` and the site falls back to the 5C Menu API.
  Treating it as an empty day would be cleaner.

### Sodexo: Hoch-Shanahan (Harvey Mudd) (`site: 'sodexo'`)
- `https://menus.sodexomyway.com/BiteMenu/MenuOnly?menuId=15258&locationId=13147001&startdate=MM/DD/YYYY`
  holds a Sunday–Saturday week as HTML-escaped JSON in `<div id="nutData">`.
  `startdate` also picks which day tab is open. `menuId` may change between
  semesters; if Hoch starts failing, check it first.
- Ingredients are in `biteMenuItemSizes[0].ingredients`. Halal appears only in
  dish names or ingredient lists ("Halal Boneless Chicken Thighs").
- Empty stations contain a placeholder dish called "Have A Nice Day"; it is skipped.

### Fallback
If a hall's own data has nothing for a date, `sources.js` uses the third-party
5C Menu API (`https://5cmenu-cache.jojodmo.com/v1/getMenu/?diningHall=…`), which
has names and descriptions only. The card says when this happens.

## How dishes are classified (`js/classify.js`)

- **Halal**, in this order: the hall's own flag (`halalFlag === true`), then the
  word "halal" in the name, description, station, or ingredients ("non-halal"
  and "not halal" are ignored).
- **Seafood**: a seafood word in the name or description. If the hall publishes
  allergens for the item, it must also carry a Fish/Shellfish tag (this filters
  out garnishes and brand names). Items the hall marks vegetarian or vegan are
  never seafood. Kinds are reported as Fish and/or Shellfish.
- **Warnings** (`cautions`): the hall's halal flag says No while the wording says
  halal; pork (flag or words, skipping "turkey bacon" and similar); other meat
  on a seafood dish that isn't marked halal; alcohol in the listing or
  ingredients (skipping wine vinegar, root beer and the like); gelatin.
- A halal dish with no warnings is "clear". The track record counts clear dishes only.

## The page, as the owner asked for it

- Day chips for today plus six days, and Breakfast / Lunch / Dinner tabs. Brunch
  shows under Lunch, and under Breakfast when a hall has no breakfast.
- Each hall card: serving hours, then Halal, Seafood, the full menu (Specials
  only for Bon Appétit), and the source and its age.
  - On the Dinner tab only the dinner time shows.
  - On Breakfast and Lunch, the daytime meals (breakfast, continental, brunch,
    lunch, continuous service) show together, with the selected one in bold.
- The summary line at the top links to halls that have halal dishes for the meal.
- **The dish sheet is the core feature.** It shows why a dish is listed, any
  warnings, and the hall's own fields verbatim: name, station, the Halal field,
  other flags, allergens, and ingredients with flagged words highlighted. Below
  that are a "Find it on X's menu" link and directions in words.
- **Links** (`js/links.js`) open as close to the dish as each site allows. This
  was tested in headless Chrome; not on iPhone Safari.
  - Pomona: today's dish via a text fragment; any other day lands on that
    day's heading, because Pomona's page builds itself after load and opens
    only the first day.
  - Bon Appétit: a featured dish in the meal being served right now via a text
    fragment; otherwise the meal's section anchor. Their page only unfolds the
    current meal.
  - Sodexo: the right day tab only; its meal sections can't be opened by link.
- **Hadith of the day**: English only. The owner removed the Arabic text and
  the Basmala for space.
  - It rotates daily (Pacific date) through 47 short hadiths from Sahih
    al-Bukhari and Sahih Muslim, each about 210 characters or less after
    `tidyEnglish()`, so it always renders in full; there is no "read more".
  - The reference is a small link in the bottom-right corner, pointing to
    sunnah.com.
  - Only references live in `js/hadith.js`. The text is fetched from the
    fawazahmed0 hadith-api on jsDelivr, so it is never retyped.
  - Bukhari uses standard numbers. Muslim uses the dataset's own numbering, so
    it is cited and linked by book and hadith (`sunnah.com/muslim/<book>/<hadith>`).
  - To add one, check it renders cleanly through `tidyEnglish()` and stays short.
- **Theme**: light by default regardless of the phone's setting; the moon/sun
  button switches and remembers the choice. An inline script in `index.html`
  applies it before first paint.
- **Installable app**: on Android the bottom bar offers Install; on iPhone it
  says to use Share → Add to Home Screen. `sw.js` is network-first with a 6s
  fallback to the last saved copy, and caches the Pomona feeds, hadith text
  and fonts. When offline, the page shows a note and Pomona sources say "saved
  copy". Users must have visited once online.

## Halal track record (`js/stats.js`, `data/history.json`)

Definitions the owner chose:
- **What counts:** a meal counts if it had at least one *clear* halal dish.
  Seafood doesn't count, and dishes with warnings don't count.
- **Periods:** two per day, "daytime" (breakfast, brunch and lunch together)
  and "dinner". Periods a hall didn't serve aren't counted.
- **Window:** the last 182 days, rolling.
- **Ranking:** halls with fewer than 20 served periods are tagged "early data"
  and ranked below established ones.
- **Unlabelled halls:** a hall that never labelled anything gets the note that
  it may serve halal food without labelling it.
- **Average:** each hall also shows "N halal dishes a meal".

`data/history.json`: `{ updatedAt, halls: { <id>: { "YYYY-MM-DD": { daytime: { halal, clear }, dinner: { halal, clear } } } } }`.

- Each run rewrites today, so the last run of the day (6pm Pacific) is the one
  that sticks.
- Entries older than 200 days are dropped.
- Collins, Malott, McConnell and Hoch were backfilled from 2026-08-31; Frary and
  Frank start on 2026-10-12.
- A day the job misses is not filled in later (the backfill only runs when asked).

## Tools on the development Mac

Node 25, Python 3, git, the GitHub CLI `gh` (signed in), and Google Chrome.

## Testing

- Serve locally and look at it in a real browser. An embedded or hidden browser
  view may not run fragment scrolling or visibility-dependent code, so test
  links and offline behaviour in a visible browser or headless Chrome.
- For link, offline and phone-size checks, headless Chrome is installed
  (`/Applications/Google Chrome.app`) and can be driven over the DevTools
  protocol from a small Node script (Node 22+ has `WebSocket` built in):
  - set the viewport to 390x844 with `mobile: true`;
  - navigate, wait, evaluate, and `Page.captureScreenshot`.
  For a true offline test, load the page twice with a profile, then relaunch the
  same profile with `--host-resolver-rules="MAP * ~NOTFOUND"` and the local
  server stopped.
- After pushing, wait for the Pages build to finish, then check the live URL:
  `gh api repos/5Cmsa/5c-halal-menu/pages/builds/latest`.
- To check the scheduled job: `gh run list --repo 5Cmsa/5c-halal-menu --workflow refresh-menus.yml`;
  `gh workflow run refresh-menus.yml --repo 5Cmsa/5c-halal-menu` runs it on demand.

## Open ideas and known gaps

- Treat closed Bon Appétit days as empty rather than as errors (see above).
- A trend line on the track record once Frary and Frank have a couple of months
  of data.
- Standing-list items such as deli tuna salad may really be out daily, but the
  menu can't tell; they stay in the "may not be served" group.
- GitHub can pause scheduled workflows on inactive repositories after 60 days and
  emails the owner; re-enable under Actions if that happens.
- Not yet checked on a physical iPhone: the Home Screen app, status bar area, and
  text-fragment links into Pomona's late-loading page.
