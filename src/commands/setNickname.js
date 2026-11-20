import { saveCompanion } from "../database.js";
import { BOT_NAME, PREFIX } from "../config.js";

export async function handleSetNicknameCommand(msg, rawArgs) {
  const newNickname = rawArgs.trim();

  // Jika user tidak memberikan nama
  if (!newNickname) {
    return msg.reply(
      `Please provide a nickname you want me to call you.\n` +
      `Example: \`${PREFIX}setnickname Kak Mero\`\n\n` +
      `To remove your nickname, type: \`${PREFIX}setnickname reset\``
    );
  }

  // Fitur untuk menghapus nickname
  if (newNickname.toLowerCase() === "reset" || newNickname.toLowerCase() === "clear") {
    try {
      await saveCompanion(msg.author.id, { nickname: "" });
      return msg.reply("Alright, I will stop using your nickname and just call you by your Discord name from now on. 🫡");
    } catch (error) {
      console.error("Error clearing nickname:", error);
      return msg.reply("Sorry, something went wrong while clearing your nickname.");
    }
  }

  // Batasi panjang nickname agar tidak merusak format chat
  if (newNickname.length > 30) {
    return msg.reply("That nickname is too long! Please keep it under 30 characters.");
  }

  // Simpan ke database
  try {
    await saveCompanion(msg.author.id, { nickname: newNickname });
    return msg.reply(`Got it! I will now call you **${newNickname}** from now on. 🥰`);
  } catch (error) {
    console.error("Error saving nickname:", error);
    return msg.reply("Sorry, something went wrong while saving your nickname. Please try again later.");
  }
}