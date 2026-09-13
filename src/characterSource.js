// Combines multiple character sources (AniList, Tenrai, Genshin,
// GenshinDB) so spawns/grants aren't dependent on just one provider.
//
// Sources are organized into GROUPS by which underlying character
// POOL they draw from, not just listed flat. genshin.js and
// genshindb.js both pull from the same ~100-character Genshin Impact
// roster, so they're nested together as one "genshin" group instead of
// being two separate top-level entries. That keeps the overall odds of
// getting *a* Genshin character the same as before genshindb.js was
// added (still 1-in-3 at the top level, not 2-in-4 the way a flat list
// of four would give it) -- adding a second API for an existing pool
// is meant to add redundancy, not double that pool's share of spawns.
//
// Which GROUP is tried first is picked RANDOMLY on every call -- not
// "always AniList, others only as a last resort" -- so load is
// naturally shared and a partially-degraded AniList (e.g. intermittent
// 403s) doesn't mean every single character still comes from it. If
// every source in a group fails or is on cooldown, it automatically
// falls through to the next group.
//
// Within the "genshin" group specifically, genshin.js and genshindb.js
// are ALSO randomly reordered against each other on every call, using
// the exact same shuffle as the top-level groups -- so neither API is
// favored over the other, and if whichever one goes first fails, it
// falls back to the other before the whole group is counted as failed
// and play moves on to a different group.
//
// Callers (characterSpawn.js, adminCard.js) don't need to know which
// source actually served the result -- they just get a character
// object with a `.source` field ("anilist", "tenrai", "genshin", or
// "genshindb"), or null if ALL sources failed.
//
// NOTE on Jikan: Jikan's public API (api.jikan.moe) is being
// discontinued -- brownout since Sep 1 2026, full shutdown Oct 1 2026.
// It's been replaced here with Tenrai (tenrai.org), the officially
// referenced successor, which advertises ~95% schema compatibility
// with Jikan.
//
// NOTE on Genshin: unlike AniList/Tenrai (general anime/manga
// databases), the genshin group pulls from a single game (Genshin
// Impact). It has its own rarity mapping (5-star -> Legendary, 4-star
// -> Epic) since game characters don't have a "favorites" count the
// way anime characters do -- see the comments in genshin.js /
// genshindb.js for details. Because it's a single-game pool, expect it
// to come up far less often than AniList/Tenrai in casual play simply
// due to having a much smaller roster (~100 characters vs. tens of
// thousands) -- that's a natural consequence of what it is, not a
// misconfiguration.
//
// NOTE on GenshinDB: genshindb.js wraps a second, independent API for
// the same Genshin Impact roster genshin.js already covers
// (genshin-db-api / the genshin-db npm package,
// https://github.com/theBowja/genshin-db-api). It's nested inside the
// "genshin" group above specifically so it adds redundancy rather than
// making Genshin characters more frequent overall.
//
// The two APIs also used to have a duplicate-claim problem: they use
// different id spaces for the same character (genshin.js: string slug
// like "hu-tao"; genshindb.js: numeric id like 10000046), so the same
// in-game character could be claimed once under each as if it were two
// different collectibles. That's now handled at the source level --
// both files report `source: "genshin"` and derive the SAME slug-based
// `anilistId` for a given character (see genshinSlug.js, and the file
// header comments in genshin.js/genshindb.js for the details and the
// one open edge case: unusual names where the derived slug might not
// match genshin.dev's real one). This assumes character_claims dedupes
// on (source, anilistId) -- confirm against the actual table if that's
// not how it works.
//
// NOTE on Pixiv / X (Twitter): these were considered and deliberately
// NOT added. Neither is a character database -- both are mostly fan
// art / personal social content, which raises real copyright concerns
// for redistributing as "collectible cards" (unlike AniList/Tenrai/
// Genshin/GenshinDB, which all serve official reference artwork for
// cataloguing purposes). X also has no free public API anymore. If a
// genuinely suitable character-database API turns up later, it can be
// added here the same way these four were.

import * as AniList from "./anilist.js";
import * as Tenrai from "./tenrai.js";
import * as Genshin from "./genshin.js";
import * as GenshinDb from "./genshindb.js";

export const RARITY_LABEL = AniList.RARITY_LABEL;

const GROUPS = [
  {
    name: "anilist",
    sources: [
      {
        name: "anilist",
        fetchRandom: AniList.fetchRandomCharacterWithRetry,
        search: AniList.searchCharacterByName,
      },
    ],
  },
  {
    name: "tenrai",
    sources: [
      {
        name: "tenrai",
        fetchRandom: Tenrai.fetchRandomCharacterWithRetry,
        search: Tenrai.searchCharacterByName,
      },
    ],
  },
  {
    name: "genshin",
    // Both of these draw from the same ~100-character Genshin Impact
    // roster -- see the NOTE on GenshinDB above for why they're
    // grouped together instead of being separate top-level entries.
    sources: [
      {
        name: "genshin",
        fetchRandom: Genshin.fetchRandomCharacterWithRetry,
        search: Genshin.searchCharacterByName,
      },
      {
        name: "genshindb",
        fetchRandom: GenshinDb.fetchRandomCharacterWithRetry,
        search: GenshinDb.searchCharacterByName,
      },
    ],
  },
];

// Flat list of every individual source regardless of grouping -- used
// for validating an explicit "source:name" search request (see
// searchCharacterFromSource) and for building helpful error messages
// elsewhere. An explicit by-name lookup always targets one specific
// source, so the grouping above doesn't apply there.
const ALL_SOURCES = GROUPS.flatMap((group) => group.sources);
export const SOURCE_NAMES = ALL_SOURCES.map((source) => source.name);

// Returns a shuffled copy of an array. Used both for ordering the
// top-level groups and for ordering the sources *within* a group, so
// nothing -- neither which group goes first, nor which API within the
// genshin group goes first -- is ever biased toward a fixed order.
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function fetchRandomCharacterAnySource() {
  for (const group of shuffle(GROUPS)) {
    for (const source of shuffle(group.sources)) {
      const character = await source.fetchRandom();
      if (character) return character;
    }
  }

  console.error(
    "All character sources (AniList, Tenrai, Genshin, GenshinDB) failed or are on cooldown."
  );
  return null;
}

export async function searchCharacterAnySource(name) {
  for (const group of shuffle(GROUPS)) {
    for (const source of shuffle(group.sources)) {
      const character = await source.search(name);
      if (character) return character;
    }
  }

  return null;
}

// Searches exactly ONE named source, with NO fallback to the others.
// This exists for cases where a caller specifically wants a character
// from a particular source (e.g. a known game character that might
// also coincidentally match an unrelated anime character on another
// source) -- searchCharacterAnySource can't guarantee which source's
// match wins when more than one has a hit for the same name. This
// always targets one specific source (e.g. "genshindb" on its own, not
// the whole "genshin" group) -- grouping only affects the *random*
// entry points above.
//
// Returns { error: "unknown_source" } if sourceName doesn't match any
// configured source, or the character (or null if that one source has
// no match) otherwise.
export async function searchCharacterFromSource(sourceName, name) {
  const source = ALL_SOURCES.find(
    (candidate) => candidate.name === sourceName.toLowerCase()
  );

  if (!source) {
    return { error: "unknown_source" };
  }

  return source.search(name);
}