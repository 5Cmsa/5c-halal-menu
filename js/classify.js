// Decides which section an item belongs in and what to warn about.
// Pure functions over the normalized item shape, so the same code can be
// run in Node against scraped data.

const HALAL = /\bhalal\b/i;
const NOT_HALAL = /\b(?:non|not)[\s-]*halal\b/gi;

// Phrases that contain a seafood word without the dish being seafood.
const SEAFOOD_NOISE = /\b(?:swedish fish|gold ?fish|fish[- ]free|fish sauce|oyster sauce|oyster (?:mushrooms?|crackers?|juice|extract)|sushi rice|poke cake|crab ?apples?)\b/gi;
const FISH = /\b(?:fish|salmon|lox|tuna|ahi|cod|tilapia|pollock|mahi|halibut|trout|catfish|swai|bass|snapper|sole|haddock|flounder|swordfish|sardines?|anchov(?:y|ies)|mackerel|herring|unagi|surimi)\b/i;
const SHELLFISH = /\b(?:shrimp|prawns?|crab|lobster|clams?|mussels?|oysters?|scallops?|calamari|squid|octopus|crawfish|crayfish|gambas)\b/i;
const SEAFOOD_DISH = /\b(?:seafood|poke|sushi|sashimi|nigiri|maki|ceviche|cioppino|california rolls?|surf\s*(?:n|&|and|['’]n['’]?)\s*turf)\b/i;
const ING_FISH = /\b(?:salmon|lox|tuna|ahi|cod|tilapia|pollock|mahi|halibut|trout|catfish|swai|bass|snapper|sole|haddock|flounder|swordfish|sardines?|mackerel|herring|unagi|surimi)\b/i;
const ING_SHELLFISH = /\b(?:shrimp|prawns?|crab|lobster|clams?|mussels?|scallops?|calamari|squid|octopus|crawfish|crayfish|gambas)\b/i;

// "Turkey bacon" and "soy chorizo" are not pork; drop them before looking.
const PORK_NOISE = /\b(?:turkey|beef|chicken|halal|vegan|veggie|vegetarian|plant[- ]based|soy|tofu|tempeh|mushroom|coconut|carrot|eggplant|seitan|beyond|impossible)\s+(?:breakfast\s+)?(?:bacon|ham|pepperoni|chorizo|salami|sausage)\b/gi;
const PORK = /\b(?:pork|bacon|ham|prosciutto|pancetta|pepperoni|salami|chorizo|carnitas|lard|guanciale|mortadella|soppressata|chicharr[oó]n(?:es)?)\b/i;

const MEAT_NOISE = /\b(?:(?:tuna|salmon|ahi|swordfish|fish|cauliflower|portobello|tofu)\s+steaks?|(?:crab|lobster|clam)\s*meat|meatless)\b/gi;
const HALAL_MEAT = /\bhalal\b(?:\s+[a-z-]+){0,3}?\s+(?:chicken|beef|lamb|turkey|steak|gyro|meat)\b/gi;
const MEAT = /\b(?:chicken|beef|turkey|lamb|duck|steak|sausage|meatballs?|meats?|brisket|veal|bison|hot ?dogs?|gyro|pastrami|carne)\b/i;

const ALCOHOL_NOISE = /\b(?:(?:(?:sherry|rice|red|white|champagne)\s+)?(?:wine|sherry|champagne|beer|malt|cider)\s+vinegar|(?:root|ginger|birch)\s+beer|non[- ]alcoholic\s+\w+)\b/gi;
const ALCOHOL = /\b(?:(?:white|red|rice|cooking)\s+wine|wine|beer|sake|mirin|bourbon|whiske?y|rum|brandy|cognac|sherry|marsala|vodka|tequila|liqueur|champagne|vermouth)\b/i;

const GELATIN = /\bgelatine?\b/i;

const FISH_ALLERGENS = /^(?:fish|tuna|salmon|anchovy|bonito|pollock|bass|catfish|cod|flounder|grouper|haddock|hake|halibut|herring|mahi mahi|perch|sardine|snapper|sole|swai or pangasius|swordfish|tilapia|trout)$/i;
const SHELLFISH_ALLERGENS = /^(?:shellfish|shrimp|crab|lobster|clam|oyster|mussels?|scallop|squid|crawfish)$/i;

const POMONA_MEAT_FLAGS = [
  ['Contains Beef', 'beef'],
  ['Contains Lamb', 'lamb'],
  ['Contains Poultry', 'poultry'],
];

function find(regex, text, noise) {
  if (!text) return null;
  const match = regex.exec(noise ? text.replace(noise, ' ') : text);
  return match ? match[0].toLowerCase() : null;
}

function says(item, label) {
  return (item.dietary ?? []).some(([name, value]) => name === label && value === 'Yes');
}

function halalReason(item) {
  if (item.halalFlag === true) {
    return { basis: 'flag', short: 'Hall-flagged', text: 'The dining hall’s own menu marks this dish as halal.' };
  }
  const where = [
    ['name', item.name, 'Named halal', 'The dish name on the hall’s menu includes the word “halal”.'],
    ['description', item.description, 'Described as halal', 'The hall’s description of this dish includes the word “halal”.'],
    ['station', item.station, 'Halal station', 'It is listed under a station whose name includes “halal”.'],
    ['ingredients', item.ingredients, 'Halal in ingredients', 'The hall’s ingredient list for this dish names a halal meat.'],
  ];
  for (const [basis, value, short, text] of where) {
    if (value && HALAL.test(value.replace(NOT_HALAL, ' '))) return { basis, short, text };
  }
  return null;
}

function seafoodReason(item) {
  // "Tofu fish filet" and vegan sushi carry the hall's vegetarian mark.
  if (item.vegetarian === true || item.vegan === true) return null;
  const text = `${item.name} ${item.description ?? ''}`.replace(SEAFOOD_NOISE, ' ');
  const ing = (item.ingredients ?? '').replace(SEAFOOD_NOISE, ' ');
  const taggedFish = (item.allergens ?? []).some((a) => FISH_ALLERGENS.test(a));
  const taggedShellfish = (item.allergens ?? []).some((a) => SHELLFISH_ALLERGENS.test(a));
  const tagged = taggedFish || taggedShellfish;

  const fishWord = FISH.test(text) || (tagged && ING_FISH.test(ing));
  const shellfishWord = SHELLFISH.test(text) || (tagged && ING_SHELLFISH.test(ing));
  if (!fishWord && !shellfishWord && !SEAFOOD_DISH.test(text)) return null;

  // Where the hall publishes allergens, a seafood word without a fish or
  // shellfish tag is a false match (a garnish, a brand name), so skip it.
  if (item.allergenInfo && !tagged) return null;

  const kinds = [];
  if (tagged ? taggedFish : fishWord) kinds.push('Fish');
  if (tagged ? taggedShellfish : shellfishWord) kinds.push('Shellfish');
  return tagged
    ? { basis: 'tag', kinds, text: `The hall tags this dish as containing ${kinds.join(' and ').toLowerCase()}.` }
    : { basis: 'name', kinds, text: 'Matched from the wording of the dish name. This hall’s menu gives no fish or shellfish tag to confirm it.' };
}

function cautionsFor(item, halal, seafood) {
  const cautions = [];
  const listing = `${item.name} ${item.description ?? ''}`;
  const sources = [
    ['The menu listing', listing],
    ['The ingredient list', item.ingredients ?? ''],
  ];
  const meatless = item.vegetarian === true || item.vegan === true;

  if (halal && item.halalFlag === false) {
    cautions.push({ kind: 'flag', text: 'The hall’s own halal flag for this dish says No, even though the wording says halal.' });
  }

  if (!meatless) {
    if (says(item, 'Contains Pork')) {
      cautions.push({ kind: 'pork', text: 'The hall flags this dish as containing pork.' });
    } else {
      for (const [where, text] of sources) {
        const word = find(PORK, text, PORK_NOISE);
        if (word) {
          cautions.push({ kind: 'pork', word, text: `${where} mentions ${word}.` });
          break;
        }
      }
    }
  }

  // Other meat only matters when nothing vouches for the dish being halal.
  if (seafood && !halal && !meatless) {
    const flagged = POMONA_MEAT_FLAGS.filter(([label]) => says(item, label)).map(([, word]) => word);
    if (flagged.length) {
      cautions.push({ kind: 'meat', text: `The hall flags this dish as also containing ${flagged.join(' and ')}, and does not flag it halal.` });
    } else {
      for (const [where, text] of sources) {
        const word = find(MEAT, text.replace(HALAL_MEAT, ' '), MEAT_NOISE);
        if (word) {
          cautions.push({ kind: 'meat', word, text: `${where} also mentions ${word}, which is not marked halal.` });
          break;
        }
      }
    }
  }

  for (const [where, text] of sources) {
    const word = find(ALCOHOL, text, ALCOHOL_NOISE);
    if (word) {
      cautions.push({ kind: 'alcohol', word, text: `${where} mentions ${word}.` });
      break;
    }
  }

  if (!meatless && GELATIN.test(item.ingredients ?? '')) {
    cautions.push({ kind: 'gelatin', word: 'gelatin', text: 'The ingredient list mentions gelatin.' });
  }
  return cautions;
}

export function classify(item) {
  const halal = halalReason(item);
  const seafood = seafoodReason(item);
  return { halal, seafood, cautions: cautionsFor(item, halal, seafood) };
}
