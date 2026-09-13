// Combines multiple character sources (AniList, Tenrai, Genshin) so
// spawns/grants aren't dependent on just one provider. Which source is
// TRIED FIRST is picked RANDOMLY on every call -- not "always AniList,
// others only as a last resort" -- so load is naturally shared and a
// partially-degraded AniList (e.g. intermittent 403s) doesn't mean
// every single character still comes from it. If the first pick fails
// or is on cooldown, it automatically falls through to the next.
//
// Callers (characterSpawn.js, adminCard.js) don't need to know which
// source actually served the result -- they just get a character
// object with a `.source` field ("anilist", "tenrai", or "genshin"),
// or null if ALL sources failed.
//
// NOTE on Jikan: Jikan's public API (api.jikan.moe) is being
// discontinued -- brownout since Sep 1 2026, full shutdown Oct 1 2026.
// It's been replaced here with Tenrai (tenrai.org), the officially
// referenced successor, which advertises ~95% schema compatibility
// with Jikan.
//
// NOTE on Genshin: unlike AniList/Tenrai (general anime/manga
// databases), genshin.js pulls from a single game (Genshin Impact) via
// the genshin.dev API. It has its own rarity mapping (5-star ->
// Legendary, 4-star -> Epic) since game characters don't have a
// "favorites" count the way anime characters do -- see the comments
// in genshin.js for details. Because it's a single-game source, expect
// it to come up far less often than AniList/Tenrai in casual play
// simply due to having a much smaller roster (~100 characters vs. tens
// of thousands) -- that's a natural consequence of what it is, not a
// misconfiguration.
//
// NOTE on Pixiv / X (Twitter): these were considered and deliberately
// NOT added. Neither is a character database -- both are mostly fan
// art / personal social content, which raises real copyright concerns
// for redistributing as "collectible cards" (unlike AniList/Tenrai/
// Genshin, which all serve official reference artwork for cataloguing
// purposes). X also has no free public API anymore. If a genuinely
// suitable character-database API turns up later, it can be added here
// the same way these three were.

import * as AniList from "./anilist.js";
import * as Tenrai from "./tenrai.js";
import * as Genshin from "./genshin.js";

export const RARITY_LABEL = AniList.RARITY_LABEL;

const SOURCES = [
  {
    name: "anilist",
    fetchRandom: AniList.fetchRandomCharacterWithRetry,
    search: AniList.searchCharacterByName,
  },
  {
    name: "tenrai",
    fetchRandom: Tenrai.fetchRandomCharacterWithRetry,
    search: Tenrai.searchCharacterByName,
  },
  {
    name: "genshin",
    fetchRandom: Genshin.fetchRandomCharacterWithRetry,
    search: Genshin.searchCharacterByName,
  },
];

// Returns the sources in random order, so which one gets tried first
// (and second, third...) is shuffled each time this is called.
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

  console.error("All character sources (AniList, Tenrai, Genshin) failed or are on cooldown.");
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