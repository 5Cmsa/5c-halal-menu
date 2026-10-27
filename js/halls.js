// The six dining halls, where each one's menu comes from, and the page a
// person would open to check it themselves.

export const HALLS = [
  {
    id: 'frary',
    site: 'pomona',
    name: 'Frary',
    college: 'Pomona',
    primary: 'pomona',
    feed: 'https://api.pomona.edu/eatec/Frary.json',
    originalUrl: () => 'https://www.pomona.edu/administration/dining/menus/frary',
  },
  {
    id: 'frank',
    site: 'pomona',
    name: 'Frank',
    college: 'Pomona',
    primary: 'pomona',
    feed: 'https://api.pomona.edu/eatec/Frank.json',
    originalUrl: () => 'https://www.pomona.edu/administration/dining/menus/frank',
  },
  {
    id: 'collins',
    site: 'bonappetit',
    name: 'Collins',
    college: 'Claremont McKenna',
    primary: 'scraped',
    originalUrl: (date) => `https://collins-cmc.cafebonappetit.com/cafe/collins/${date}/`,
  },
  {
    id: 'malott',
    site: 'bonappetit',
    name: 'Malott',
    college: 'Scripps',
    primary: 'scraped',
    originalUrl: (date) => `https://scripps.cafebonappetit.com/cafe/malott-dining-commons/${date}/`,
  },
  {
    id: 'mcconnell',
    site: 'bonappetit',
    name: 'McConnell',
    college: 'Pitzer',
    primary: 'scraped',
    originalUrl: (date) => `https://pitzer.cafebonappetit.com/cafe/mcconnell-bistro/${date}/`,
  },
  {
    id: 'hoch',
    site: 'sodexo',
    name: 'Hoch-Shanahan',
    college: 'Harvey Mudd',
    primary: 'scraped',
    originalUrl: () => 'https://hmc.sodexomyway.com/en-us/locations/hoch-shanahan-dining-commons#menuItems',
  },
];

// How each kind of source is described to the reader.
export const SOURCES = {
  pomona: {
    label: 'Pomona College dining feed',
    note: 'Pomona publishes a Halal: Yes/No field for every dish. This is read live from Pomona.',
  },
  bonappetit: {
    label: 'Bon Appétit menu page',
    note: 'Bon Appétit has a Halal icon that a kitchen can add to a dish, but there is no “not halal” mark and not every hall uses the icon. A dish appears as halal when it carries that icon or when “halal” is written into its name or description.',
  },
  sodexo: {
    label: 'Sodexo menu page',
    note: 'Sodexo’s menu has no halal field. A dish appears as halal only when “halal” is in its name, description or ingredient list.',
  },
  '5cmenu': {
    label: '5C Menu API (third-party copy)',
    note: 'The hall’s own menu could not be loaded, so this is a third-party copy with names and descriptions only: no halal field, allergen tags or ingredients.',
  },
};
