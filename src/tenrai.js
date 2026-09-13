// Tenrai (https://tenrai.org) as a SECOND character source alongside
// AniList. This replaces the old jikan.js -- Jikan's public API
// (api.jikan.moe) is being shut down (brownout since Sep 1 2026, full
// shutdown Oct 1 2026). Tenrai is the officially-referenced successor
// and advertises a v1 schema that is ~95% field-compatible with
// Jikan's, so this file is a close port of jikan.js with the base URL
// and a couple of endpoint paths changed.
//
// !! VERIFY BEFORE RELYING ON THIS IN PRODUCTION !!
// The exact paths below (`/random/characters`, `/characters?q=...`)
// are carried over from Jikan under the assumption they matched --
// confirm against https://api.tenrai.org/documentation (it's a JS
// app, so open it in an actual browser) or by hitting the endpoints
// directly and checking the response shape matches mapCharacter()
// below. Log/print a raw response once during testing before trusting
// this in prod.
//
// Mirrors anilist.js's exported interface (fetchRandomCharacter,
// fetchRandomCharacterWithRetry, searchCharacterByName) so all sources
// stay interchangeable from the caller's point of view -- see
// characterSource.js for how they're combined.
import { computeRarity, RARITY_LABEL } from "./rarity.js";

export { RARITY_LABEL };

const TENRAI_URL = "https://api.tenrai.org/v1";

// ==================== CIRCUIT BREAKER ====================
// Same pattern as anilist.js / old jikan.js: stop hammering the API
// after a run of consecutive failures, rest for a while, log once
// instead of on every attempt.
const MAX_CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveFailures = 0;
let cooldownUntil = 0;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

export function isTenraiInCooldown() {
  return isInCooldown();
}

// A 429 means we're actually over Tenrai's rate limit right now --
// treat that as more serious than a transient 5xx and cool down
// immediately rather than waiting for MAX_CONSECUTIVE_FAILURES.
function recordFailure(isRateLimit = false) {
  consecutiveFailures += 1;
  const threshold = isRateLimit ? 1 : MAX_CONSECUTIVE_FAILURES;

  if (consecutiveFailures >= threshold && !isInCooldown()) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `Tenrai failed ${consecutiveFailures} times in a row` +
        (isRateLimit ? " (rate limited)" : "") +
        `. Pausing for ${COOLDOWN_MS / 60000} minutes.`
    );
  }
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("Tenrai requests recovered after previous failures.");
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

// Assumed to mirror Jikan v4's character object shape, given Tenrai's
// advertised compatibility:
// { mal_id, name, images: { jpg: {...}, webp: {...} }, favorites,
//   anime: [{ role, anime: { title, ... } }], manga: [...] }
// CONFIRM THIS against a real response before trusting in prod.
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
    // existing character_claims schema and downstream code -- it just
    // means "the source's own numeric ID", regardless of API. The
    // `source` field below is what tells you where it's actually from.
    anilistId: character.mal_id,
    name: character.name || "Unknown Character",
    image,
    favourites,
    series: animeEntry?.title || mangaEntry?.title || "Unknown",
    mediaType: animeEntry ? "ANIME" : mangaEntry ? "MANGA" : "UNKNOWN",
    rarity: computeRarity(favourites),
    source: "tenrai",
  };
}

async function tenraiFetch(path) {
  return fetch(`${TENRAI_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "mokachan-discord-bot",
    },
  });
}

// Fetches one random character from Tenrai. Returns null on failure
// so the caller (or the multi-source picker) can fall back to another
// source without crashing.
export async function fetchRandomCharacter() {
  if (isInCooldown()) return null;

  try {
    // ASSUMED PATH -- verify against Tenrai docs. Jikan used
    // /random/characters; Tenrai's landing page lists a general
    // /v1/random endpoint, which may need a type param instead, e.g.
    // /random?type=characters or /random/characters. Test and adjust.
    const response = await tenraiFetch("/random/characters");

    if (!response.ok) {
      console.error(`Tenrai HTTP ${response.status}`);
      recordFailure(response.status === 429);
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
    console.error("Tenrai request failed:", error.message);
    recordFailure();
    return null;
  }
}

// Retries a few times on failure before giving up. Skips entirely
// (returns null immediately) while in cooldown. Backoff grows between
// attempts (with a little jitter) instead of a flat delay, so retries
// don't pile onto a struggling upstream all at the same interval.
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

// Looks up ONE specific character by name via Tenrai's search,
// sorted by favorites so the most well-known match wins. Used by the
// owner-only admincard command. Returns null if nothing matches or the
// request fails.
export async function searchCharacterByName(name) {
  try {
    // ASSUMED PATH/PARAMS -- verify against Tenrai docs (mirrors
    // Jikan's /characters?q=...&order_by=favorites&sort=desc&limit=1).
    const response = await tenraiFetch(
      `/characters?q=${encodeURIComponent(name)}&order_by=favorites&sort=desc&limit=1`
    );

    if (!response.ok) {
      console.error(`Tenrai HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return mapCharacter(data?.data?.[0]);
  } catch (error) {
    console.error("Tenrai search request failed:", error.message);
    return null;
  }
}
