import { BOT_NAME, MAX_OUTPUT_CHARS } from "../config.js";
import { saveHistory } from "../database.js";
import { callGemini } from "../gemini.js";
import {
  buildCompanionMessages,
  updateCompanionAfterReply,
  findNameMentionedUsers,
} from "../companion.js";

export async function handleAiCommand(client, msg, prompt) {
  // Kalau user mention member lain di pesan ini (misal "@Budi lagi apa
  // ya biasanya") ATAU cuma nyebut namanya biasa tanpa @mention (misal
  // "gimana kabarnya Budi hari ini"), AI dikasih tau ringkasan/fakta
  // soal member itu juga -- ini yang bikin bot kerasa "kenal" banyak
  // orang di server, bukan cuma inget yang lagi chat doang.
  const explicitMentions = [...msg.mentions.users.values()].filter(
    (u) => u.id !== msg.author.id && u.id !== client.user.id
  );

  const nameMentioned = await findNameMentionedUsers(
    msg,
    prompt,
    new Set([msg.author.id, client.user.id, ...explicitMentions.map((u) => u.id)])
  );

  const mentionedUsers = [...explicitMentions, ...nameMentioned];

  // Konteks sekarang datang dari companion memory (ringkasan + fakta +
  // 1 turn terakhir), BUKAN 5 pasang Q&A mentah seperti sebelumnya.
  // Ini yang membuat payload ke Gemini jauh lebih hemat token walau
  // riwayat chat sudah sangat panjang.
  const { messages, state } = await buildCompanionMessages(
    msg.author.id,
    prompt,
    mentionedUsers
  );

  const thinkingMessage = await msg.reply(
    `${BOT_NAME} sedang berpikir...`
  );

  const aiResponse = await callGemini(messages);

  if (!aiResponse) {
    return thinkingMessage.edit(
      `${BOT_NAME} gagal mendapatkan jawaban dari Gemini.`
    );
  }

  const { result, model } = aiResponse;

  const finalText =
    `**${BOT_NAME}**\n` +
    `> Model: \`${model}\`\n\n` +
    result;

  const chunks = [];

  for (let i = 0; i < finalText.length; i += MAX_OUTPUT_CHARS) {
    chunks.push(finalText.slice(i, i + MAX_OUTPUT_CHARS));
  }

  await thinkingMessage.edit(chunks[0]);

  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]);
  }

  // history.js / clearhistory.js tetap jalan seperti biasa (log mentah
  // untuk ditinjau manual via `mhistory`), TAPI ini bukan lagi sumber
  // konteks untuk AI -- itu tugas companion memory di atas.
  await saveHistory(msg.author.id, prompt, result, model);

  // Update ringkasan, fakta, dan poin kedekatan companion.
  await updateCompanionAfterReply(msg.author.id, state, prompt, result);
}