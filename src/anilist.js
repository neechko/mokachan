// Integrasi AniList (GraphQL API publik, gratis, tanpa API key) untuk
// fitur "claim karakter". Kita ambil karakter random tapi tetap dibatasi
// ke halaman-halaman ber-favorit tinggi (sort FAVOURITES_DESC) supaya
// yang muncul karakter anime/game yang beneran dikenal & punya gambar,
// bukan entri kosong/rusak.

const ANILIST_URL = "https://graphql.anilist.co";

// Cakupan halaman yang dipakai untuk random. perPage=1 -> 1 halaman =
// 1 karakter dari peringkat favorit ke-N. Rentang 1-400 sudah mencakup
// ribuan karakter populer dari anime & game.
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

export const RARITY_EMOJI = {
  Legendary: "★★★★★",
  Epic: "★★★★",
  Rare: "★★★",
  Common: "★★",
};

// Ambil satu karakter random dari AniList. Return null kalau gagal
// (network error, rate limit, atau data tidak lengkap) supaya caller
// bisa retry / skip spawn tanpa bikin bot crash.
export async function fetchRandomCharacter() {
  const page = Math.floor(Math.random() * MAX_PAGE_POOL) + 1;

  try {
    const response = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: CHARACTER_QUERY,
        variables: { page },
      }),
    });

    if (!response.ok) {
      console.error(`AniList HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const character = data?.data?.Page?.characters?.[0];

    if (!character || !character.image?.large) {
      return null;
    }

    const media = character.media?.nodes?.[0];
    const favourites = character.favourites || 0;

    return {
      anilistId: character.id,
      name: character.name?.full || character.name?.native || "Karakter Misterius",
      image: character.image.large,
      favourites,
      series:
        media?.title?.romaji || media?.title?.english || "Tidak diketahui",
      mediaType: media?.type || "ANIME",
      rarity: computeRarity(favourites),
    };
  } catch (error) {
    console.error("Gagal fetch AniList:", error.message);
    return null;
  }
}

// Retry beberapa kali kalau kena halaman kosong/gagal, sebelum menyerah.
export async function fetchRandomCharacterWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const character = await fetchRandomCharacter();
    if (character) return character;
  }
  return null;
}
