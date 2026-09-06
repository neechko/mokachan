import { OWNER_ID, BOT_NAME } from "../config.js";
import {
  fetchRandomCharacterWithRetry,
  searchCharacterByName,
  RARITY_LABEL,
} from "../anilist.js";
import { grantCharacterDirectly } from "../database.js";

// Owner-only command. Grants a character card directly into a
// collection, bypassing the normal spawn/claim flow entirely.
//
// Usage:
//   madmincard                        -> random character, granted to yourself
//   madmincard <name>                 -> specific character, granted to yourself
//   madmincard @member                -> random character, granted to @member
//   madmincard @member <name>         -> specific character, granted to @member
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

  const character = searchTerm
    ? await searchCharacterByName(searchTerm)
    : await fetchRandomCharacterWithRetry();

  if (!character) {
    return msg.reply(
      searchTerm
        ? `No character found on AniList matching "${searchTerm}".`
        : "Failed to fetch a character from AniList. Try again shortly."
    );
  }

  await grantCharacterDirectly(targetUser.id, character);

  const label = RARITY_LABEL[character.rarity] || "[Common]";
  const isSelf = targetUser.id === msg.author.id;

  return msg.reply(
    `Granted directly to ${isSelf ? "your" : `${targetUser.username}'s`} collection: **${character.name}** ${label}\n` +
      `From: *${character.series}*\n` +
      `(${BOT_NAME} admin card, not a normal spawn/claim)`
  );
}
