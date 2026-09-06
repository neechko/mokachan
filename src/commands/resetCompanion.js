import { resetCompanionMemory } from "../companion.js";

export async function handleResetCompanionCommand(msg) {
  await resetCompanionMemory(msg.author.id);

  return msg.reply(
    "Companion memory (summary, facts, affection points) has been reset."
  );
}