// ==================== PASSIVE LEARNING ====================
// This is what makes Moka "know" every member on the server, not just
// whoever has called the `mokachan` command before. How it works:
//
// 1. Every ORDINARY message (not a command) in any channel gets
//    buffered per user (`passive_chat_buffer`).
// 2. Once that user's buffer reaches PASSIVE_LEARN_BATCH_SIZE messages,
//    ONE Gemini call summarizes it into an update to the summary +
//    facts in `companion_memory` -- the SAME table used by the
//    `mokachan` command, so the profile stays unified.
// 3. This NEVER replies to the channel -- it's purely learning quietly
//    in the background.
//
// Why not call Gemini on every message? Because that would be very
// wasteful and could get the bot rate-limited / laggy on an active
// server. Batching like this keeps token cost under control even on a
// very active server.

import {
  PASSIVE_LEARN_BATCH_SIZE,
  PASSIVE_LEARN_MIN_LENGTH,
  PREFIX,
  BOT_NAME,
  MAX_FACTS,
} from "./config.js";
import {
  addPassiveMessage,
  getPassiveBuffer,
  getPassiveBufferCount,
  clearPassiveBuffer,
  getOrCreateCompanion,
  saveCompanion,
} from "./database.js";
import { callGemini } from "./gemini.js";

// Guard so one user isn't processed twice at the same time if two of
// their messages happen to hit the batch threshold almost simultaneously.
const learningLocks = new Set();

function safeParseFacts(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Called on EVERY incoming message (from index.js). Returns early if
// the message is a command / empty / too short, so the buffer doesn't
// fill up with noise.
export async function recordPassiveMessage(msg) {
  if (!msg.guild || msg.author.bot) return;

  const content = msg.content.trim();
  if (!content) return;

  // Commands (starting with the bot's prefix) already have their own
  // learning path via companion.js when the AI replies -- don't
  // double-process them here.
  if (content.toLowerCase().startsWith(PREFIX.toLowerCase())) return;

  if (content.length < PASSIVE_LEARN_MIN_LENGTH) return;

  await addPassiveMessage(msg.author.id, content);

  const count = await getPassiveBufferCount(msg.author.id);
  if (count < PASSIVE_LEARN_BATCH_SIZE) return;

  if (learningLocks.has(msg.author.id)) return;
  learningLocks.add(msg.author.id);

  try {
    await learnFromBuffer(msg.author.id);
  } catch (error) {
    console.error("Failed to learn from ordinary chat:", error.message);
  } finally {
    learningLocks.delete(msg.author.id);
  }
}

// NOTE: the prompt content below (messages sent to Gemini) is
// deliberately kept in Indonesian -- its output (summary/facts) feeds
// into the same companion_memory fields used by the Indonesian-language
// AI persona prompt in companion.js, so keeping it consistent avoids
// mixing languages in what the model produces.
async function learnFromBuffer(userId) {
  const buffered = await getPassiveBuffer(userId);
  if (!buffered.length) return;

  const lastId = buffered[buffered.length - 1].id;
  const state = await getOrCreateCompanion(userId);
  const oldFacts = safeParseFacts(state.facts);

  const messages = [
    {
      role: "system",
      content: `
Kamu adalah sistem PERINGKAS MEMORI diam-diam untuk AI companion bernama ${BOT_NAME}.
Kamu diberi potongan CHAT BIASA seorang user di server Discord -- ini
BUKAN percakapan langsung dia dengan ${BOT_NAME}, cuma obrolan dia
dengan orang lain yang "didengar" secara pasif.

Tugasmu: perbarui ringkasan singkat (maksimal 3 kalimat) dan daftar
"fakta" pendek (maksimal ${MAX_FACTS} item) tentang kepribadian, minat,
atau gaya bicara user ini, digabung dengan yang sudah diketahui
sebelumnya. Fokus ke pola/minat yang konsisten dan berulang.

JANGAN simpan detail sensitif atau pribadi (lokasi, kontak, curhatan
berat, hal yang sifatnya rahasia) walau ada disebut di teks -- lewati
saja bagian itu.

Balas HANYA dengan JSON valid, tanpa markdown, format persis:
{"summary": "...", "facts": ["...", "..."]}
      `.trim(),
    },
    {
      role: "user",
      content: `
Ringkasan lama:
${state.summary || "(kosong)"}

Fakta lama:
${oldFacts.length ? oldFacts.join(", ") : "(kosong)"}

Potongan chat biasa user ini (urut waktu, tanpa konteks lawan bicara):
${buffered.map((row) => `- ${row.content}`).join("\n")}
      `.trim(),
    },
  ];

  const outcome = await callGemini(messages);

  // Apapun hasilnya, buffer yang sudah diproses TETAP dibersihkan --
  // supaya kalau Gemini lagi bermasalah, buffer tidak menumpuk selamanya.
  if (!outcome) {
    await clearPassiveBuffer(userId, lastId);
    return;
  }

  try {
    const cleaned = outcome.result.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    await saveCompanion(userId, {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : state.summary,
      facts: JSON.stringify(
        Array.isArray(parsed.facts)
          ? parsed.facts
              .filter((f) => typeof f === "string")
              .slice(0, MAX_FACTS)
          : oldFacts
      ),
    });
  } catch (error) {
    console.error("⚠️ Gagal parse hasil belajar pasif:", error.message);
  }

  await clearPassiveBuffer(userId, lastId);
}