import { clearHistory } from "../database.js";

export async function handleClearHistoryCommand(msg) {
  await clearHistory(msg.author.id);

  return msg.reply("All your chat history has been cleared.");
}