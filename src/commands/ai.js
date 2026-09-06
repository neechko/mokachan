import { BOT_NAME, MAX_OUTPUT_CHARS } from "../config.js";
import { saveHistory } from "../database.js";
import { callGemini } from "../gemini.js";
import {
  buildCompanionMessages,
  updateCompanionAfterReply,
  findNameMentionedUsers,
} from "../companion.js";

export async function handleAiCommand(client, msg, prompt) {
  // If the user mentions another member in this message (e.g. "@Budi
  // what's he usually up to") OR just says their plain name without an
  // @mention (e.g. "how's Budi doing today"), the AI is given a
  // summary/facts about that member too -- this is what makes the bot
  // feel like it "knows" many people on the server, not just whoever
  // it's currently chatting with.
  const explicitMentions = [...msg.mentions.users.values()].filter(
    (u) => u.id !== msg.author.id && u.id !== client.user.id
  );

  const nameMentioned = await findNameMentionedUsers(
    msg,
    prompt,
    new Set([msg.author.id, client.user.id, ...explicitMentions.map((u) => u.id)])
  );

  const mentionedUsers = [...explicitMentions, ...nameMentioned];

  // Context now comes from companion memory (summary + facts + 1 last
  // turn), NOT 5 raw Q&A pairs like before. This is what makes the
  // payload to Gemini far more token-efficient even with a very long chat history.
  const { messages, state } = await buildCompanionMessages(
    msg.author.id,
    prompt,
    mentionedUsers
  );

  const thinkingMessage = await msg.reply(`${BOT_NAME} is thinking...`);

  const aiResponse = await callGemini(messages);

  if (!aiResponse) {
    return thinkingMessage.edit(
      `${BOT_NAME} failed to get a response from Gemini.`
    );
  }

  const { result, model } = aiResponse;

  const finalText = `**${BOT_NAME}**\n` + `> Model: \`${model}\`\n\n` + result;

  const chunks = [];

  for (let i = 0; i < finalText.length; i += MAX_OUTPUT_CHARS) {
    chunks.push(finalText.slice(i, i + MAX_OUTPUT_CHARS));
  }

  await thinkingMessage.edit(chunks[0]);

  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]);
  }

  // history.js / clearhistory.js still work as before (raw log for
  // manual review via `mhistory`), BUT this is no longer the AI's
  // context source -- that's companion memory's job above.
  //
  // IMPORTANT: this is wrapped in a SEPARATE try/catch from the AI
  // reply above. The user already has their answer above -- if saving
  // history/companion fails (e.g. disk full), they should not also get
  // a confusing second error message when their actual answer already
  // went through successfully.
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