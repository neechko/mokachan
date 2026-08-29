// ==================== BELAJAR PASIF ====================
// Ini yang bikin Moka "kenal" tiap member di server, BUKAN cuma yang
// pernah manggil command `mokachan`. Cara kerjanya:
//
// 1. Tiap pesan BIASA (bukan command) di channel manapun ditampung ke
//    buffer per user (`passive_chat_buffer`).
// 2. Begitu buffer user itu sudah PASSIVE_LEARN_BATCH_SIZE pesan, baru
//    SATU KALI panggilan Gemini buat merangkum jadi update summary +
//    fakta di `companion_memory` -- tabel yang SAMA dipakai command
//    `mokachan`, jadi profilnya nyambung/menyatu.
// 3. Ini TIDAK pernah membalas apapun ke channel -- murni belajar diam2
//    di belakang layar.
//
// Kenapa tidak panggil Gemini tiap pesan? Karena itu boros banget & bisa
// bikin bot kena rate limit / lag di server ramai. Batching seperti ini
// bikin biaya token tetap terkendali walau server aktif banget.

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

// Guard supaya 1 user tidak diproses 2x bersamaan kalau kebetulan 2
// pesan dia nyampe batas batch nyaris bersamaan.
const learningLocks = new Set();

function safeParseFacts(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Dipanggil di SETIAP pesan masuk (dari index.js). Return cepat kalau
// pesannya command / kosong / kependekan, supaya tidak nyampah buffer.
export async function recordPassiveMessage(msg) {
  if (!msg.guild || msg.author.bot) return;

  const content = msg.content.trim();
  if (!content) return;

  // Command (diawali prefix bot) sudah punya jalur belajarnya sendiri
  // lewat companion.js pas AI membalas -- jangan diproses dobel di sini.
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
    console.error("⚠️ Gagal belajar dari chat biasa:", error.message);
  } finally {
    learningLocks.delete(msg.author.id);
  }
}

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
