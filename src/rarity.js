// Shared rarity logic used by every character source (AniList, Jikan,
// and any future source). Keeping this in one place means adding a
// new source later doesn't require re-implementing or subtly
// duplicating the tiering logic.

export function computeRarity(favourites) {
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
