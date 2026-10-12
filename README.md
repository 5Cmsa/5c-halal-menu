# 5C Halal Menu

Live at https://taha6767.github.io/5c-halal-menu/

Shows the halal dishes and seafood at each Claremont Colleges dining hall for
the chosen day and meal. Tapping a dish shows how the hall itself listed it
(name, halal flag, allergens, ingredients) with a link to the original menu.

## Where the data comes from

| Halls | Source | Halal signal |
| --- | --- | --- |
| Frary, Frank | Pomona's dining feed, read live by the page (serving hours scraped from Pomona's hall pages) | Halal: Yes/No on every dish |
| Collins, Malott, McConnell | Bon Appétit menu pages, scraped into `data/` | Halal icon where the kitchen adds it, otherwise the word "halal" in the name |
| Hoch-Shanahan | Sodexo menu page, scraped into `data/` | The word "halal" in the name or ingredient list |

If a hall's own source is missing for a day, the page falls back to the
[5C Menu API](https://github.com/jojodmo/5CMenu) and says so on the card.

The hadith of the day is one of about 50 short hadiths from Sahih al-Bukhari
and Sahih Muslim listed by reference in `js/hadith.js`. The English text is
read from the open [hadith-api](https://github.com/fawazahmed0/hadith-api)
dataset and each one links to sunnah.com.

The site is also an installable web app: `manifest.webmanifest` and the icons
in `icons/` let phones add it to the home screen, and `sw.js` keeps the last
loaded menus so it opens offline.

## Run it

```bash
npm run scrape   # refresh data/ for the next 7 days (Node 18+, no dependencies)
npm run dev      # serve at http://localhost:4173
```

The site is hosted on GitHub Pages from the `main` branch. The workflow in
`.github/workflows/refresh-menus.yml` re-runs the scraper four times a day and
commits the result, which republishes the site.

## Layout

- `js/classify.js` decides what counts as halal or seafood and what to warn about.
- `js/sources.js` loads each hall and normalises it to one shape.
- `js/app.js` renders the page and the detail popup.
- `js/hadith.js` picks and loads the hadith of the day.
- `js/links.js` builds links that open each hall's own page at the right day, meal or dish.
- `scripts/scrape.mjs` writes `data/<hall>.json` and `data/pomona-hours.json`.
