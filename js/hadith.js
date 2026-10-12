// Hadith of the day, from Sahih al-Bukhari and Sahih Muslim.
//
// Only references are kept here. The English text is read at runtime from the
// open hadith-api dataset, so the wording is the published one rather than
// something retyped. Bukhari numbers are the standard ones;
// Muslim numbers are that dataset's running count, so Muslim is cited by
// book and hadith within the book, which is how sunnah.com links to it.

const API = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
const TIME_ZONE = 'America/Los_Angeles';

// Widely quoted hadiths, each short enough (about 200 characters in this
// translation) to be read in full in the card on a phone. The order is
// deliberately mixed so that neighbouring days differ in theme; the list
// repeats once it runs out.
const HADITHS = [
  ['muslim', 2328], // every act of goodness is charity
  ['bukhari', 6133], // a believer is not stung twice from the same hole
  ['bukhari', 2692], // making peace between people
  ['bukhari', 6412], // two blessings: health and free time
  ['muslim', 6543], // Allah looks at hearts and deeds
  ['bukhari', 5392], // food for two is enough for three
  ['bukhari', 2749], // the three signs of a hypocrite
  ['bukhari', 5645], // trials are a sign that Allah wants good for someone
  ['muslim', 6552], // visiting the sick
  ['bukhari', 7453], // Allah's mercy precedes His anger
  ['bukhari', 2568], // accepting even the humblest invitation
  ['bukhari', 6125], // make things easy and give glad tidings
  ['bukhari', 1417], // guard against the Fire even with half a date
  ['bukhari', 2448], // the prayer of the oppressed
  ['bukhari', 5027], // the best of you learn the Qur'an and teach it
  ['bukhari', 5409], // he never criticised food
  ['muslim', 6690], // meet your brother with a cheerful face
  ['bukhari', 6309], // Allah's joy at repentance
  ['bukhari', 5649], // feed the hungry, visit the sick
  ['bukhari', 1302], // patience at the first shock
  ['bukhari', 6405], // SubhanAllah wa bihamdihi a hundred times
  ['bukhari', 6307], // seeking forgiveness seventy times a day
  ['bukhari', 2075], // the dignity of earning your own living
  ['muslim', 1083], // closest to Allah in prostration
  ['muslim', 6599], // without gentleness there is no good
  ['bukhari', 6014], // Jibril and the rights of the neighbour
  ['bukhari', 6446], // true wealth is contentment of the soul
  ['muslim', 6595], // concealing the faults of others
  ['muslim', 152], // faith has seventy-odd branches
  ['bukhari', 6168], // a person is with those he loves
  ['muslim', 6927], // praying for your brother in his absence
  ['bukhari', 7376], // Allah shows mercy to the merciful
  ['bukhari', 2067], // keeping ties of kinship
  ['muslim', 2426], // success is contentment
  ['bukhari', 2457], // the quarrelsome person
  ['bukhari', 2447], // oppression is darkness on the Day of Resurrection
  ['bukhari', 13], // wish for your brother what you wish for yourself
  ['bukhari', 6092], // he used to smile
  ['bukhari', 6114], // the strong one controls himself when angry
  ['muslim', 6932], // praising Allah for food and drink
  ['bukhari', 24], // modesty is part of faith
  ['bukhari', 2472], // removing a thorny branch from the road
  ['bukhari', 6012], // planting is charity
  ['muslim', 7130], // Paradise is surrounded by hardships
  ['bukhari', 6038], // ten years of service without a harsh word
  ['bukhari', 5304], // caring for the orphan
  ['bukhari', 5352], // spend, and Allah will spend on you
];

const COLLECTIONS = {
  bukhari: {
    cite: (n) => `Sahih al-Bukhari ${n}`,
    link: (n) => `https://sunnah.com/bukhari:${n}`,
  },
  muslim: {
    cite: (n, ref) => `Sahih Muslim, Book ${ref.book}, Hadith ${ref.hadith}`,
    link: (n, ref) => `https://sunnah.com/muslim/${ref.book}/${ref.hadith}`,
  },
};

// The dataset's English has a few transcription quirks: missing spaces after
// colons, backticks for the letter ayn, cross-references to the print edition
// and quotations that are never closed.
export function tidyEnglish(raw) {
  const chars = [
    ...raw
      .replace(/\s+/g, ' ')
      .replace(/\s*\(See\b.*$/, '')
      .replace(/^Narrated\s*\.\s*/, 'Narrated ')
      .replace(/`/g, '’')
      .replace(/saying\."\s*/g, 'saying, "')
      .replace(/:(?=["'’(A-Za-z])/g, ': ')
      .replace(/\s+([,.;!?])/g, '$1')
      .trim(),
  ];

  let text = '';
  let open = false; // inside a "double" quotation
  let inner = false; // inside a 'single' quotation nested in it
  chars.forEach((ch, i) => {
    const next = chars[i + 1] ?? '';
    if (ch === '"') {
      if (open) text = `${text.trimEnd()}${inner ? '’' : ''}”`;
      else text += '“';
      open = !open;
      inner = false;
    } else if (ch === "'" && open && !inner && /[,:] $/.test(text) && /[A-Z]/.test(next)) {
      text += '‘';
      inner = true;
    } else if (ch === "'" && inner && !/[A-Za-z]/.test(next)) {
      text += '’';
      inner = false;
    } else {
      text += ch;
    }
  });

  text = text
    .replace(/'/g, '’')
    .replace(/“\s+/g, '“')
    .replace(/([^\s(])“/g, '$1 “')
    .replace(/”(?=[A-Za-z(])/g, '” ')
    .trim();
  if (!/[.!?][’”]*$/.test(text)) text += '.';
  return open ? `${text}${inner ? '’' : ''}”` : text;
}

function dayNumber() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date()).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

async function english(book, number) {
  const res = await fetch(`${API}/eng-${book}/${number}.min.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).hadiths[0];
}

export async function hadithOfTheDay() {
  const [book, number] = HADITHS[dayNumber() % HADITHS.length];
  const hadith = await english(book, number);
  const collection = COLLECTIONS[book];
  return {
    text: tidyEnglish(hadith.text),
    cite: collection.cite(number, hadith.reference),
    link: collection.link(number, hadith.reference),
  };
}
