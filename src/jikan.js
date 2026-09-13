// Jikan (unofficial MyAnimeList API, free, no key needed) as a SECOND
// character source alongside AniList. Two reasons for adding this:
//
// 1. Reliability -- if AniList is rate-limiting/blocking this host
//    (which has happened repeatedly), spawns don't have to stop
//    entirely, they can fall back to this source instead.
// 2. Coverage -- MAL's character database doesn't perfectly overlap
//    with AniList's, so some characters (especially from games) that
//    are missing on one may exist on the other.
//
// Mirrors anilist.js's exported interface (fetchRandomCharacter,
// fetchRandomCharacterWithRetry, searchCharacterByName) so the two
// modules are interchangeable from the caller's point of view -- see
// characterSource.js for how they're combined.

// Reuse the exact same rarity thresholds as AniList so the two sources
// feel consistent to players. Both sites track "favorites" on a
// broadly similar scale (large, long-running anime community
// databases), though this hasn't been empirically tuned against real
// Jikan data -- adjust computeRarity in rarity.js if the balance feels
// off once you see it in practice.
import { computeRarity, RARITY_LABEL } from "./rarity.js";

export { RARITY_LABEL };

const JIKAN_URL = "https://api.jikan.moe/v4";

// ==================== CIRCUIT BREAKER ====================
// Same pattern as anilist.js: stop hammering the API after a run of
// consecutive failures, rest for a while, log once instead of on every attempt.
const MAX_CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveFailures = 0;
let cooldownUntil = 0;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

export function isJikanInCooldown() {
  return isInCooldown();
}

function recordFailure() {
  consecutiveFailures += 1;

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !isInCooldown()) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `Jikan failed ${consecutiveFailures} times in a row. ` +
        `Pausing for ${COOLDOWN_MS / 60000} minutes.`
    );
  }
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("Jikan requests recovered after previous failures.");
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

// Jikan's character object shape (v4):
// { mal_id, name, images: { jpg: {...}, webp: {...} }, favorites,
//   anime: [{ role, anime: { title, ... } }], manga: [...] }
function mapCharacter(character) {
  if (!character) return null;

  const image =
    character.images?.webp?.image_url || character.images?.jpg?.image_url;

  if (!image) return null;

  const favourites = character.favorites || 0;
  const animeEntry = character.anime?.[0]?.anime;
  const mangaEntry = character.manga?.[0]?.manga;

  return {
    // Field name kept as "anilistId" for compatibility with the
    // existing character_claims schema and downstream code -- it now
    // just means "the source's own numeric ID", regardless of which
    // API it came from. The `source` field below is what actually
    // tells you where it's from.
    anilistId: character.mal_id,
    name: character.name || "Unknown Character",
    image,
    favourites,
    series: animeEntry?.title || mangaEntry?.title || "Unknown",
    mediaType: animeEntry ? "ANIME" : mangaEntry ? "MANGA" : "UNKNOWN",
    rarity: computeRarity(favourites),
    source: "jikan",
  };
}

async function jikanFetch(path) {
  return fetch(`${JIKAN_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "mokachan-discord-bot",
    },
  });
}

// Fetches one random character from Jikan. Returns null on failure so
// the caller (or the multi-source picker) can fall back to another
// source without crashing.
export async function fetchRandomCharacter() {
  if (isInCooldown()) return null;

  try {
    const response = await jikanFetch("/random/characters");

    if (!response.ok) {
      console.error(`Jikan HTTP ${response.status}`);
      recordFailure();
      return null;
    }

    const data = await response.json();
    const character = mapCharacter(data?.data);

    if (!character) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return character;
  } catch (error) {
    console.error("Jikan request failed:", error.message);
    recordFailure();
    return null;
  }
}

// Retries a few times on failure before giving up. Skips entirely
// (returns null immediately) while in cooldown. A short delay between
// attempts is courteous to Jikan's documented rate limit (roughly 3
// requests/second, 60/minute).
export async function fetchRandomCharacterWithRetry(maxAttempts = 3) {
  if (isInCooldown()) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const character = await fetchRandomCharacter();
    if (character) return character;
    if (isInCooldown()) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return null;
}

// Looks up ONE specific character by name via Jikan's search endpoint,
// sorted by favorites so the most well-known match wins. Used by the
// owner-only admincard command. Returns null if nothing matches or the
// request fails.
export async function searchCharacterByName(name) {
  try {
    const response = await jikanFetch(
      `/characters?q=${encodeURIComponent(name)}&order_by=favorites&sort=desc&limit=1`
    );

    if (!response.ok) {
      console.error(`Jikan HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return mapCharacter(data?.data?.[0]);
  } catch (error) {
    console.error("Jikan search request failed:", error.message);
    return null;
  }
}
