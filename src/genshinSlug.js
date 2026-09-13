// Shared by genshin.js and genshindb.js -- both files describe the
// SAME Genshin Impact character roster via two different APIs. For
// claim dedup to actually treat "Hu Tao via genshin.js" and "Hu Tao
// via genshindb.js" as the same claimable character, both need to
// agree on one `anilistId` format instead of each using their own
// native id space (genshin.dev's own string slugs vs. genshin-db-api's
// numeric ids). This is pulled out into its own file, rather than
// having genshindb.js import it from genshin.js directly, so neither
// of the two "sibling" source files depends on the other's internals
// -- both just depend on this shared util, same as they both already
// depend on rarity.js.
//
// This reproduces genshin.dev's own slug format for character ids
// (e.g. "hu-tao", "kamisato-ayaka", "albedo", "arlecchino" -- confirmed
// against genshin.dev's real slugs for the simple cases). genshin.js
// used to define this locally just for guessing a direct slug from
// user search input; now genshindb.js also uses it to derive a
// matching slug from genshin-db-api's `name` field, since that API has
// no native slugs of its own (only numeric ids).
//
// NOT FULLY VERIFIED: this is confirmed for ordinary ASCII names but
// untested against edge cases in the roster -- e.g. whatever slug
// genshin.dev actually uses for the Traveler (Aether/Lumine), which
// may not follow the plain "lowercase and hyphenate the display name"
// pattern this function assumes. If a character's genshindb.js-derived
// slug doesn't actually match genshin.dev's real slug for that same
// character, the two sources will fail to dedupe for that one
// character specifically (falling back to the old double-claimable
// behavior for just that character, not breaking anything else).
export function toSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}
