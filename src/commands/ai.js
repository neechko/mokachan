import { BOT_NAME, MAX_OUTPUT_CHARS } from "../config.js";
import { saveHistory } from "../database.js";
import { callGemini } from "../gemini.js";
import {
  buildCompanionMessages,
  updateCompanionAfterReply,
  findNameMentionedUsers,
  buildRecentChannelContext,
} from "../companion.js";

export async function handleAiCommand(client, msg, prompt) {
  // Jika user me-mention member lain atau menyebut nama mereka,
  // AI akan diberi konteks ingatan tentang member tersebut.
  const explicitMentions = [...msg.mentions.users.values()].filter(
    (u) => u.id !== msg.author.id && u.id !== client.user.id
  );

  const nameMentioned = await findNameMentionedUsers(
    msg,
    prompt,
    new Set([msg.author.id, client.user.id, ...explicitMentions.map((u) => u.id)])
  );

  const mentionedUsers = [...explicitMentions, ...nameMentioned];

  // Mengambil konteks obrolan real-time di channel agar AI nyambung.
  const recentContext = await buildRecentChannelContext(msg);

  // Context now comes from companion memory (summary + facts + 1 last
  // turn) plus this real-time channel snapshot.
  const { messages, state } = await buildCompanionMessages(
    msg.author.id,
    prompt,
    mentionedUsers,
    recentContext
  );

  const thinkingMessage = await msg.reply(`${BOT_NAME} is thinking...`);

  // Memanggil callGemini. Jika user bertanya info terkini, gemini.js akan 
  // otomatis melakukan loop pencarian web di latar belakang sebelum mengembalikan hasil.
  const aiResponse = await callGemini(messages);

  if (!aiResponse) {
    return thinkingMessage.edit(
      `${BOT_NAME} failed to get a response from AI Provider.`
    );
  }

  const { result, model } = aiResponse;

  // === TAMBAHAN SAFEGUARD ===
  // Cegah pengiriman pesan kosong jika AI berhasil memanggil tool (web search)
  // tetapi gagal merangkai teks jawaban akhir (kadang terjadi pada model LLM).
  if (!result || !result.trim()) {
    return thinkingMessage.edit(
      `${BOT_NAME} berhasil mencari informasi tetapi gagal merangkai jawaban akhir.`
    );
  }

  const finalText = `**${BOT_NAME}**\n` + `> Model: \`${model}\`\n\n` + result;

  const chunks = [];

  for (let i = 0; i < finalText.length; i += MAX_OUTPUT_CHARS) {
    chunks.push(finalText.slice(i, i + MAX_OUTPUT_CHARS));
  }

  await thinkingMessage.edit(chunks[0]);

  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]);
  }

  // history.js / clearhistory.js still work as before.
  // PENTING: Hanya 'prompt' asli user dan 'result' (jawaban final) yang disimpan.
  // Raw data web search TIDAK masuk ke database, menjaga DB & token tetap bersih.
  try {
    await saveHistory(msg.author.id, prompt, result, model);
    // Update the companion's summary, facts, and affection points.
    await updateCompanionAfterReply(msg.author.id, state, prompt, result);
  } catch (error) {
    console.error(
      "Failed to save history/companion data (AI reply was still sent):",
      error.message
    );
  }
}