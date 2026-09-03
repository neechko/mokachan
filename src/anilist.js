// AniList integration (public GraphQL API, free, no API key needed)
// for the character claim feature. We pick a random character but
// bias toward high-favourite pages (sort FAVOURITES_DESC) so what
// shows up is recognizable anime/game characters with real artwork,
// not empty/broken entries.

const ANILIST_URL = "https://graphql.anilist.co";

// Page pool used for random picks. perPage=1 -> 1 page = 1 character
// at rank N by favourites. A range of 1-400 covers thousands of
// popular characters from anime and games.
const MAX_PAGE_POOL = 400;

const CHARACTER_QUERY = `
  query ($page: Int) {
    Page(page: $page, perPage: 1) {
      characters(sort: FAVOURITES_DESC) {
        id
        name {
          full
          native
        }
        image {
          large
        }
        favourites
        media(perPage: 1, sort: POPULARITY_DESC) {
          nodes {
            type
            title {
              romaji
              english
            }
          }
        }
      }
    }
  }
`;

function computeRarity(favourites) {
  if (favourites >= 20000) return "Legendary";
  if (favourites >= 5000) return "Epic";
  if (favourites >= 1000) return "Rare";
  return "Common";
}

export const RARITY_LABEL = {
  Legendary: "[Legendary]",
  Epic: "[Epic]",
  Rare: "[Rare]",
  Common: "[Common]",
};

// ==================== CIRCUIT BREAKER ====================
// If AniList starts rejecting requests (rate limit, IP block, outage),
// retrying on every single spawn check just makes it worse and floods
// the console with repeated identical errors. After a run of
// consecutive failures, we stop trying entirely for a cooldown period
// and log ONCE when entering/leaving cooldown, instead of on every
// attempt.
const MAX_CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

let consecutiveFailures = 0;
let cooldownUntil = 0;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

function recordFailure() {
  consecutiveFailures += 1;

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !isInCooldown()) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.error(
      `AniList failed ${consecutiveFailures} times in a row. ` +
        `Pausing character spawns for ${COOLDOWN_MS / 60000} minutes.`
    );
  }
}

function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("AniList requests recovered after previous failures.");
  }
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

// Fetches one random character from AniList. Returns null on failure
// (network error, rate limit, incomplete data) so the caller can skip
// the spawn without crashing.
export async function fetchRandomCharacter() {
  if (isInCooldown()) return null;

  const page = Math.floor(Math.random() * MAX_PAGE_POOL) + 1;

  try {
    const response = await fetch(ANILIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "mokachan-discord-bot",
      },
      body: JSON.stringify({
        query: CHARACTER_QUERY,
        variables: { page },
      }),
    });

    if (!response.ok) {
      console.error(`AniList HTTP ${response.status}`);
      recordFailure();
      return null;
    }

    const data = await response.json();
    const character = data?.data?.Page?.characters?.[0];

    if (!character || !character.image?.large) {
      recordFailure();
      return null;
    }

    recordSuccess();

    const media = character.media?.nodes?.[0];
    const favourites = character.favourites || 0;

    return {
      anilistId: character.id,
      name: character.name?.full || character.name?.native || "Unknown Character",
      image: character.image.large,
      favourites,
      series: media?.title?.romaji || media?.title?.english || "Unknown",
      mediaType: media?.type || "ANIME",
      rarity: computeRarity(favourites),
    };
  } catch (error) {
    console.error("AniList request failed:", error.message);
    recordFailure();
    return null;
  }
}

// Retries a few times on failure/empty pages before giving up. Skips
// entirely (returns null immediately) while in cooldown.
export async function fetchRandomCharacterWithRetry(maxAttempts = 3) {
  if (isInCooldown()) return null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const character = await fetchRandomCharacter();
    if (character) return character;
    if (isInCooldown()) break; // stop retrying once cooldown kicks in
  }

  return null;
}