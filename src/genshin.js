// genshin.dev API (hosted at genshin.jmp.blue) as a THIRD character
// source alongside AniList and Tenrai. Unlike those two, this pulls
// from a single game (Genshin Impact) rather than a general
// anime/manga database -- see characterSource.js for how all three
// are combined.
//
// Mirrors anilist.js / tenrai.js's exported interface (fetchRandomCharacter,
// fetchRandomCharacterWithRetry, searchCharacterByName) so all sources
// stay interchangeable from the caller's point of view.
//
// Key differences from the other sources, and how this file handles them:
//
// 1. No "favorites" count exists for game characters, so the shared
//    computeRarity() from rarity.js (which tiers by favourites count)
//    doesn't apply here. Instead this maps Genshin's own in-game
//    rarity directly onto the same tier labels: 5-star -> "Legendary",
//    4-star -> "Epic". Genshin has no 3-star (or lower) playable
//    characters, so "Rare"/"Common" simply never occur for this
//    source -- that's expected, not a bug.
// 2. This API has no random-character endpoint. Character IDs (slugs
//    like "diluc", "hu-tao") are fetched once and cached in memory,
//    then a random one is picked client-side. The list only changes
//    when new characters are added to the game, so a long cache TTL
//    is fine -- no need to refetch it on every spawn.
// 3. IDs here are string slugs (e.g. "diluc"), not the numeric MAL/AniList
//    IDs the other two sources use. The `anilistId` field name is kept
//    for schema compatibility with character_claims, but downstream
//    code that assumes it's always numeric should be checked.
// 4. The "series" field is set to "Genshin Impact" (the game itself)
//    rather than a per-character anime/manga title, since that's the
//    closest equivalent for a single-game source.
// 5. Image URLs point directly at this API's image-serving endpoint
//    (`/characters/:id/card`), which returns the image bytes directly
//    -- so the URL itself works as-is anywhere an image URL is needed
//    (e.g. Discord embed image fields), same as AniList/Tenrai's URLs.
import { RARITY_LABEL } from "./rarity.js";

export { RARITY_LABEL };

const GENSHIN_URL = "https://genshin.jmp.blue";

// ==================== CIRCUIT BREAKER ====================
// Same pattern as anilist.js / tenrai.js: stop hammering the API after
// a run of consecutive failures, rest for a while, log once instead of
// on every attempt.
const MAX_CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveFailures = 0;
let cooldownUntil = 0;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

export function isGenshinInCooldown() {
  return isInCooldown();
}

function recordFailure(isRateLimit = false) {
  consecutiveFailures += 1;
  const threshold = isRateLimit ? 1 : MAX_CONSECUTIVE_FAILURES;

  if (consecutiveFailures >= threshold && !isInCooldown()) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `Genshin API failed ${consecutiveFailures} times in a row` +
        (isRateLimit ? " (rate limited)" : "") +
        `. Pausing for ${COOLDOWN_MS / 60000} minutes.`
    );
  }
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("Genshin API requests recovered after previous failures.");
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

// ==================== CHARACTER ID LIST CACHE ====================
// The list of character slugs only grows when new characters release
// in-game (every few weeks at most), so cache it instead of hitting
// GET /characters on every single spawn.
const LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedCharacterIds = null;
let cachedAt = 0;

async function getCharacterIds() {
  const isStale = Date.now() - cachedAt > LIST_CACHE_TTL_MS;

  if (cachedCharacterIds && !isStale) {
    return cachedCharacterIds;
  }

  const response = await genshinFetch("/characters");

  if (!response.ok) {
    console.error(`Genshin HTTP ${response.status} (fetching character list)`);
    recordFailure(response.status === 429);
    // Serve the stale cache rather than nothing, if we have one --
    // better to keep working with slightly outdated character
    // coverage than to fail every spawn just because the list refresh
    // failed once.
    return cachedCharacterIds || null;
  }

  const ids = await response.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return cachedCharacterIds || null;
  }

  cachedCharacterIds = ids;
  cachedAt = Date.now();
  return ids;
}

// Maps Genshin's own star rarity onto the shared rarity tier labels.
// Genshin has no 3-star-or-lower playable characters, so "Rare" and
// "Common" are simply never produced by this source -- that's
// expected, not a gap.
function tierFromStars(stars) {
  return stars >= 5 ? "Legendary" : "Epic";
}

// Response shape based on the genshin.dev API's documented fields.
// CONFIRM against a real response before relying on this in prod --
// field names like `rarity` are inferred from the project's schema
// conventions, not verified against a live call.
function mapCharacter(id, character) {
  if (!character) return null;

  const stars = character.rarity ?? character.stars ?? 4;

  return {
    // String slug (e.g. "diluc"), not numeric like AniList/Tenrai IDs.
    // Field name kept as "anilistId" for schema compatibility with the
    // existing character_claims table -- see file header note.
    anilistId: id,
    name: character.name || id,
    image: `${GENSHIN_URL}/characters/${id}/card`,
    favourites: null, // not applicable for this source
    series: "Genshin Impact",
    mediaType: "GAME",
    rarity: tierFromStars(stars),
    source: "genshin",
  };
}

async function genshinFetch(path) {
  return fetch(`${GENSHIN_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "mokachan-discord-bot",
    },
  });
}

// Fetches one random character. Returns null on failure so the caller
// (or the multi-source picker) can fall back to another source
// without crashing.
export async function fetchRandomCharacter() {
  if (isInCooldown()) return null;

  try {
    const ids = await getCharacterIds();
    if (!ids) return null;

    const id = ids[Math.floor(Math.random() * ids.length)];
    const response = await genshinFetch(`/characters/${id}?lang=en`);

    if (!response.ok) {
      console.error(`Genshin HTTP ${response.status}`);
      recordFailure(response.status === 429);
      return null;
    }

    const data = await response.json();
    const character = mapCharacter(id, data);

    if (!character) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return character;
  } catch (error) {
    console.error("Genshin request failed:", error.message);
    recordFailure();
    return null;
  }
}

// Retries a few times on failure before giving up, with growing
// backoff (+ jitter) between attempts. Skips entirely (returns null
// immediately) while in cooldown.
export async function fetchRandomCharacterWithRetry(maxAttempts = 3) {
  if (isInCooldown()) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const character = await fetchRandomCharacter();
    if (character) return character;
    if (isInCooldown()) break;

    const backoff = 400 * 2 ** (attempt - 1);
    const jitter = Math.random() * 200;
    await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
  }

  return null;
}

// Turns a display name into this API's slug format, e.g.
// "Hu Tao" -> "hu-tao", "Kamisato Ayaka" -> "kamisato-ayaka".
function toSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

// Looks up ONE specific character by name. Used by the owner-only
// admincard command. Tries the name as a direct slug first (cheap,
// works for exact names); if that 404s, falls back to a substring
// match against the cached slug list. That fallback is approximate --
// it matches against hyphenated slugs, not display names, so unusual
// spacing/punctuation in the search term may not match even if the
// character exists. Returns null if nothing matches or the request
// fails.
export async function searchCharacterByName(name) {
  const slug = toSlug(name);

  try {
    const direct = await genshinFetch(`/characters/${slug}?lang=en`);

    if (direct.ok) {
      const data = await direct.json();
      return mapCharacter(slug, data);
    }

    if (direct.status !== 404) {
      console.error(`Genshin HTTP ${direct.status}`);
      return null;
    }

    // Direct slug didn't match -- fall back to a substring search
    // against the cached ID list.
    const ids = await getCharacterIds();
    if (!ids) return null;

    const match = ids.find((id) => id.includes(slug) || slug.includes(id));
    if (!match) return null;

    const response = await genshinFetch(`/characters/${match}?lang=en`);
    if (!response.ok) {
      console.error(`Genshin HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return mapCharacter(match, data);
  } catch (error) {
    console.error("Genshin search request failed:", error.message);
    return null;
  }
}
