import { OWNER_ID, BOT_NAME } from "../config.js";
import {
  fetchRandomCharacterAnySource,
  searchCharacterAnySource,
  searchCharacterFromSource,
  SOURCE_NAMES,
  RARITY_LABEL,
} from "../characterSource.js";
import { grantCharacterDirectly } from "../database.js";

// Matches an explicit "source:name" search prefix, e.g. "genshin:Odette"
// -> source "genshin", name "Odette". Case-insensitive on the source
// name. If this doesn't match, the whole string is treated as a plain
// name search across all sources (existing behaviour).
const EXPLICIT_SOURCE_PATTERN = /^([a-z]+):(.+)$/i;

// Owner-only command. Grants a character card directly into a
// collection, bypassing the normal spawn/claim flow entirely.
//
// Usage:
//   madmincard                        -> random character, granted to yourself
//   madmincard <name>                 -> specific character, granted to yourself
//   madmincard @member                -> random character, granted to @member
//   madmincard @member <name>         -> specific character, granted to @member
//   madmincard <source>:<name>        -> specific character from ONE named
//                                         source only, no fallback to others
//                                         (e.g. "genshin:Odette") -- use this
//                                         when a name might collide across
//                                         sources and you need the exact one
//
// Restricted to OWNER_ID specifically (not just server "Manage Server"
// permission), since this directly writes to the database rather than
// being a normal gameplay action -- it should only ever be you, on any
// server the bot is in, but the CARD ITSELF can be given to anyone.
export async function handleAdminCardCommand(msg, rawArgs) {
  if (!OWNER_ID) {
    return msg.reply(
      "OWNER_ID is not configured yet. Set it in .env to your own Discord user ID to use this command."
    );
  }

  if (msg.author.id !== OWNER_ID) {
    return msg.reply("This command is restricted to the bot owner only.");
  }

  const targetUser = msg.mentions.users.first() || msg.author;

  // Strip the mention markup (<@id> or <@!id>) out of the raw text so
  // whatever remains is treated as a character name search, e.g.
  // "madmincard @Budi Naruto Uzumaki" -> searchTerm = "Naruto Uzumaki"
  const searchTerm = (rawArgs || "").replace(/<@!?\d+>/g, "").trim();

  // Check for an explicit "source:name" prefix first (e.g.
  // "genshin:Odette") so a name that might match on more than one
  // source resolves to the one actually intended, instead of whichever
  // source happens to win the random ordering.
  const explicitMatch = searchTerm.match(EXPLICIT_SOURCE_PATTERN);

  let character;
  let sourceOnlyLabel = null; // set when an explicit source was requested, for error messages

  if (explicitMatch) {
    const [, requestedSource, nameOnly] = explicitMatch;
    sourceOnlyLabel = requestedSource.toLowerCase();
    const result = await searchCharacterFromSource(sourceOnlyLabel, nameOnly.trim());

    if (result?.error === "unknown_source") {
      return msg.reply(
        `Unknown source "${requestedSource}". Available sources: ${SOURCE_NAMES.join(", ")}.`
      );
    }

    character = result;
  } else if (searchTerm) {
    character = await searchCharacterAnySource(searchTerm);
  } else {
    character = await fetchRandomCharacterAnySource();
  }

  if (!character) {
    if (sourceOnlyLabel) {
      return msg.reply(
        `No character found matching that name specifically on source "${sourceOnlyLabel}".`
      );
    }
    return msg.reply(
      searchTerm
        ? `No character found matching "${searchTerm}" on any connected source (${SOURCE_NAMES.join(", ")}).`
        : `Failed to fetch a character from any connected source (${SOURCE_NAMES.join(", ")}). Try again shortly.`
    );
  }

  await grantCharacterDirectly(targetUser.id, character);

  const label = RARITY_LABEL[character.rarity] || "[Common]";
  const isSelf = targetUser.id === msg.author.id;

  return msg.reply(
    `Granted directly to ${isSelf ? "your" : `${targetUser.username}'s`} collection: **${character.name}** ${label}\n` +
      `From: *${character.series}* (source: ${character.source})\n` +
      `(${BOT_NAME} admin card, not a normal spawn/claim)`
  );
}