import { BOT_NAME, TRIM_CHARS, MAX_OUTPUT_CHARS, NOTIFY_CHANNEL_ID } from "../config.js";
import { getRelevantHistory, saveHistory } from "../database.js";
import { callGemini } from "../gemini.js";

export async function handleAiCommand(client, msg, prompt) {
  const history = await getRelevantHistory(
    client,
    NOTIFY_CHANNEL_ID,
    msg.author.id,
    msg.reference?.messageId
  );

  const messages = [
    {
      role: "system",
      content: `
Kamu adalah ${BOT_NAME}.

Nama kamu adalah ${BOT_NAME}.
Kamu adalah AI Discord yang ramah, sopan,
informatif, santai, dan natural.

Gunakan bahasa Indonesia jika pengguna
berbicara menggunakan bahasa Indonesia.

Jawab dengan jelas dan jangan terlalu
panjang kecuali pengguna meminta penjelasan detail.
      `.trim(),
    },

    ...history.flatMap((item) => [
      { role: "user", content: item.prompt.slice(-TRIM_CHARS) },
      { role: "assistant", content: item.response.slice(-TRIM_CHARS) },
    ]),

    { role: "user", content: prompt },
  ];

  const thinkingMessage = await msg.reply(
    `⏳ ${BOT_NAME} sedang berpikir...`
  );

  const aiResponse = await callGemini(messages);

  if (!aiResponse) {
    return thinkingMessage.edit(
      `❌ ${BOT_NAME} gagal mendapatkan jawaban dari Gemini.`
    );
  }

  const { result, model } = aiResponse;

  const finalText =
    `🤖 **${BOT_NAME}**\n` +
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

  await saveHistory(msg.author.id, prompt, result, model);
}
