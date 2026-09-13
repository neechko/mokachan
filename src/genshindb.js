// genshin-db-api (https://github.com/theBowja/genshin-db-api, hosted at
// https://genshin-db-api.vercel.app) as a FOURTH character source,
// alongside AniList, Tenrai, and genshin.js (genshin.dev). This is a
// SECOND, independent Genshin Impact source -- it wraps the community
// `genshin-db` npm package's data instead of the genshin.dev API, and
// happens to expose real per-character card art via its `images.card`
// field (see mapCharacter() below) rather than a generated image
// endpoint.
//
// !! Same roster as genshin.js -- id normalization matters here !!
// This file and genshin.js both pull from the same ~100-character
// Genshin Impact roster, so characterSource.js groups them together
// and treats them as interchangeable rather than as two separate
// pools (see the "genshin" group note there). For that grouping to
// actually prevent double-claiming the same in-game character through
// each API, both files need to agree on one `anilistId` format --
// genshin-db-api's own ids are numeric (e.g. 10000046 for Hu Tao),
// which is a DIFFERENT space than genshin.dev's string slugs (e.g.
// "hu-tao"). So instead of using genshin-db-api's native numeric id,
// mapCharacter() below derives the same slug genshin.js would use, via
// the shared toSlug() in genshinSlug.js, and uses THAT as `anilistId`.
// The raw numeric id from this API is kept separately as `providerId`
// in case it's ever needed (e.g. for re-querying this API directly),
// but it deliberately does NOT go into `anilistId` or get used for
// dedup. `source` is also always "genshin" here (not "genshindb") for
// the same reason -- see genshin.js's file header, point 6, and
// genshinSlug.js for the full picture. `provider: "genshindb"` keeps
// track of which literal API actually served a given character for
// logging/debugging, without affecting the dedup key.
//
// This assumes claim dedup is keyed on (source, anilistId) -- that was
// an educated guess about how character_claims works, not something
// confirmed against that table directly. Worth double-checking against
// the real schema.
//
// Mirrors anilist.js / tenrai.js / genshin.js's exported interface
// (fetchRandomCharacter, fetchRandomCharacterWithRetry,
// searchCharacterByName) so all sources stay interchangeable from the
// caller's point of view -- see characterSource.js for how they're
// combined.
//
// VERIFIED (live request against the real API, 2026-09-13):
//   GET /api/v5/characters?query=hutao ->
//   { id, name, rarity (5 or 4 -- per /api/v5/config's
//     categories.characters.rarity, no 3-star-or-lower playable
//     characters exist, same as genshin.js), images: { card, portrait,
//     cover1, cover2, "hoyolab-avatar", ... }, url: { fandom }, ... }
//
//   GET /api/v5/characters?query=names&matchCategories=true ->
//   a flat JSON array of ~100+ display names, e.g. ["Aether", ...,
//   "Zhongli"]. Used below the same way genshin.js caches its slug
//   list -- fetch once, cache, pick randomly client-side, since this
//   API also has no dedicated random-character endpoint.
//
// NOT VERIFIED: (1) the exact shape of a "no match" response for a
// typo'd or garbage query -- repeated test requests kept returning a
// stale cached response instead of a fresh one, so this couldn't be
// pinned down live. mapCharacter() below defensively treats anything
// that isn't a plain object with name/rarity/images as "no match"
// rather than assuming a specific error shape. (2) that toSlug() on
// every one of this API's display names actually lands on genshin.dev's
// real slug for that same character -- confirmed for ordinary names
// (matches the documented "hu-tao"/"kamisato-ayaka" pattern, plus
// "albedo"/"arlecchino" seen elsewhere), but not exhaustively checked
// against all ~100 characters, so an edge case (e.g. the Traveler) could
// still slip through without deduping correctly. See genshinSlug.js.
import { RARITY_LABEL } from "./rarity.js";
import { toSlug } from "./genshinSlug.js";

export { RARITY_LABEL };

const GENSHINDB_URL = "https://genshin-db-api.vercel.app/api/v5";

// ==================== CIRCUIT BREAKER ====================
// Same pattern as the other source files: stop hammering the API after
// a run of consecutive failures, rest for a while, log once instead of
// on every attempt.
const MAX_CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveFailures = 0;
let cooldownUntil = 0;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

export function isGenshinDbInCooldown() {
  return isInCooldown();
}

function recordFailure(isRateLimit = false) {
  consecutiveFailures += 1;
  const threshold = isRateLimit ? 1 : MAX_CONSECUTIVE_FAILURES;

  if (consecutiveFailures >= threshold && !isInCooldown()) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `GenshinDB failed ${consecutiveFailures} times in a row` +
        (isRateLimit ? " (rate limited)" : "") +
        `. Pausing for ${COOLDOWN_MS / 60000} minutes.`
    );
  }
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("GenshinDB requests recovered after previous failures.");
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

// ==================== CHARACTER NAME LIST CACHE ====================
// Same reasoning as genshin.js's id list cache: this only changes when
// new characters release in-game (every few weeks at most), so cache
// it instead of hitting the names endpoint on every spawn.
const LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cachedCharacterNames = null;
let cachedAt = 0;

async function getCharacterNames() {
  const isStale = Date.now() - cachedAt > LIST_CACHE_TTL_MS;

  if (cachedCharacterNames && !isStale) {
    return cachedCharacterNames;
  }

  const response = await genshindbFetch(
    "/characters?query=names&matchCategories=true"
  );

  if (!response.ok) {
    console.error(`GenshinDB HTTP ${response.status} (fetching name list)`);
    recordFailure(response.status === 429);
    // Serve the stale cache rather than nothing, if we have one.
    return cachedCharacterNames || null;
  }

  const names = await response.json();

  if (!Array.isArray(names) || names.length === 0) {
    return cachedCharacterNames || null;
  }

  cachedCharacterNames = names;
  cachedAt = Date.now();
  return names;
}

// Maps Genshin's own star rarity onto the shared rarity tier labels.
// Same tiers as genshin.js: no 3-star-or-lower playable characters
// exist, so "Rare"/"Common" never occur for this source either.
function tierFromStars(stars) {
  return stars >= 5 ? "Legendary" : "Epic";
}

// "card" is the field actually named for card art -- the best fit for
// a collectible-card bot, and it's what the verified Hu Tao response
// used. Fall back through the other portrait-style fields in case a
// given character is ever missing one.
function pickImage(images) {
  if (!images) return null;

  return (
    images.card ||
    images.portrait ||
    images.cover2 ||
    images.cover1 ||
    images["hoyolab-avatar"] ||
    null
  );
}

// See the VERIFIED/NOT VERIFIED notes at the top of this file. Treats
// anything that isn't a plain character object with the fields we
// need as "no match" -- this is a guess at how a bad query behaves,
// not a confirmed one.
function mapCharacter(character) {
  if (!character || Array.isArray(character)) return null;

  const image = pickImage(character.images);
  if (!character.name || !character.rarity || !image) return null;

  return {
    // Derived slug (e.g. "hu-tao"), NOT this API's own numeric id --
    // see the file header for why. This is what makes dedup against
    // genshin.js actually work for the same character.
    anilistId: toSlug(character.name),
    // This API's own numeric id (e.g. 10000046), kept around separately
    // in case anything needs to re-query genshin-db-api directly. Not
    // used for identity/dedup -- see file header.
    providerId: character.id,
    name: character.name,
    image,
    favourites: null, // not applicable -- game characters have no favorites count
    series: "Genshin Impact",
    mediaType: "GAME",
    rarity: tierFromStars(character.rarity),
    // Shared pool identity with genshin.js -- see that file's header,
    // point 6, and genshinSlug.js for why this is "genshin" and not
    // "genshindb" here.
    source: "genshin",
    provider: "genshindb",
  };
}

async function genshindbFetch(path) {
  return fetch(`${GENSHINDB_URL}${path}`, {
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
    const names = await getCharacterNames();
    if (!names) return null;

    const name = names[Math.floor(Math.random() * names.length)];
    const response = await genshindbFetch(
      `/characters?query=${encodeURIComponent(name)}`
    );

    if (!response.ok) {
      console.error(`GenshinDB HTTP ${response.status}`);
      recordFailure(response.status === 429);
      return null;
    }

    const data = await response.json();
    const character = mapCharacter(data);

    if (!character) {
      recordFailure();
      return null;
    }

    recordSuccess();
    return character;
  } catch (error) {
    console.error("GenshinDB request failed:", error.message);
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

// Looks up ONE specific character by name. Used by the owner-only
// admincard command. Passes the name straight through to GenshinDB's
// own fuzzy query matching (matchNames/matchAltNames are on by
// default per /api/v5/config) rather than slugifying it ourselves for
// the lookup -- toSlug() is only applied afterward, to the matched
// character's canonical name, to build `anilistId`. Returns null if
// nothing matches or the request fails.
export async function searchCharacterByName(name) {
  try {
    const response = await genshindbFetch(
      `/characters?query=${encodeURIComponent(name)}`
    );

    if (!response.ok) {
      console.error(`GenshinDB HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return mapCharacter(data);
  } catch (error) {
    console.error("GenshinDB search request failed:", error.message);
    return null;
  }
}