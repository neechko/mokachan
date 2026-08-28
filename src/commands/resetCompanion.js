import { resetCompanionMemory } from "../companion.js";

export async function handleResetCompanionCommand(msg) {
  await resetCompanionMemory(msg.author.id);

  return msg.reply(
    "Memori companion (ringkasan, fakta, poin kedekatan) berhasil direset."
  );
}
