// Combines multiple character sources (AniList, Jikan) so spawns/grants
// aren't dependent on just one provider. Which source is TRIED FIRST is
// picked RANDOMLY on every call -- not "always AniList, Jikan only as a
// last resort" -- so load is naturally shared between both and a
// partially-degraded AniList (e.g. intermittent 403s) doesn't mean
// every single character still comes from it. If the first pick fails
// or is on cooldown, it automatically falls back to the other source.
//
// Callers (characterSpawn.js, adminCard.js) don't need to know which
// source actually served the result -- they just get a character
// object with a `.source` field ("anilist" or "jikan"), or null if
// BOTH sources failed.
//
// NOTE on Pixiv / X (Twitter): these were considered and deliberately
// NOT added. Neither is a character database -- both are mostly fan
// art / personal social content, which raises real copyright concerns
// for redistributing as "collectible cards" (unlike AniList/Jikan,
// which serve official reference artwork for cataloguing purposes). X
// also has no free public API anymore. If a genuinely suitable
// character-database API turns up later, it can be added here the same
// way Jikan was.

import * as AniList from "./anilist.js";
import * as Jikan from "./jikan.js";

export const RARITY_LABEL = AniList.RARITY_LABEL;

const SOURCES = [
  {
    name: "anilist",
    fetchRandom: AniList.fetchRandomCharacterWithRetry,
    search: AniList.searchCharacterByName,
  },
  {
    name: "jikan",
    fetchRandom: Jikan.fetchRandomCharacterWithRetry,
    search: Jikan.searchCharacterByName,
  },
];

// Returns the two sources in random order, so which one gets tried
// first is a coin flip each time this is called.
function randomSourceOrder() {
  const shuffled = [...SOURCES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function fetchRandomCharacterAnySource() {
  const order = randomSourceOrder();

  for (const source of order) {
    const character = await source.fetchRandom();
    if (character) return character;
  }

  console.error("All character sources (AniList, Jikan) failed or are on cooldown.");
  return null;
}

export async function searchCharacterAnySource(name) {
  const order = randomSourceOrder();

  for (const source of order) {
    const character = await source.search(name);
    if (character) return character;
  }

  return null;
}
