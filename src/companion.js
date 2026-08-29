// ==================== COMPANION MEMORY ====================
// Menggantikan mekanisme lama: kirim 5 pasang Q&A mentah tiap request
// (boros token, makin lama chat makin gede payload).
//
// Sekarang tiap request ke Gemini cuma bawa:
//   1. System prompt persona + tingkat kedekatan (affection)
//   2. RINGKASAN pendek hasil rangkuman AI sendiri (bukan histori mentah)
//   3. Beberapa "fakta" pendek tentang user (nama, suka/tidak suka, dst)
//   4. SATU turn terakhir (biar obrolan tetap nyambung natural)
//   5. Prompt baru
//
// Ringkasan & fakta hanya di-REGENERATE setiap SUMMARY_EVERY_N_TURNS kali
// (lewat 1 kali panggilan Gemini kecil), bukan tiap pesan. Jadi biaya
// token per pesan biasa jadi hampir konstan, tidak tumbuh seiring
// panjangnya riwayat chat.

import {
  BOT_NAME,
  TRIM_CHARS,
  SUMMARY_EVERY_N_TURNS,
  MAX_FACTS,
  AFFECTION_PER_TURN,
} from "./config.js";
import {
  getOrCreateCompanion,
  saveCompanion,
  resetCompanion,
  getCompanionPublicInfo,
  listKnownCompanionUserIds,
  clearPassiveBuffer,
} from "./database.js";
import { callGemini } from "./gemini.js";

function affectionLabel(points) {
  if (points >= 150) return "sangat dekat, akrab seperti sahabat lama";
  if (points >= 60) return "sudah akrab dan nyaman ngobrol santai";
  if (points >= 20) return "mulai kenal baik, tidak canggung lagi";
  return "baru mulai kenal, masih agak sopan/formal";
}

function safeParseFacts(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Ambil ringkasan + fakta milik member LAIN yang di-mention di pesan,
// supaya AI bisa "nyambung" ngobrolin/komentar soal mereka juga -- ini
// yang bikin bot kerasa tau siapa-siapa-aja di server, bukan cuma inget
// user yang lagi ngobrol doang. Sengaja cuma pakai ringkasan & fakta
// (bukan transkrip chat mentah member itu) supaya tetap hemat token dan
// tidak membocorkan isi obrolan pribadi verbatim.
async function buildMentionedMembersContext(mentionedUsers) {
  if (!mentionedUsers.length) return "";

  const infos = await Promise.all(
    mentionedUsers.map((user) => getCompanionPublicInfo(user.id))
  );

  const blocks = infos
    .map((info, idx) => {
      if (!info) return null;

      const facts = safeParseFacts(info.facts);
      const displayName = mentionedUsers[idx].username;
      const lines = [];

      if (info.summary) lines.push(`- Tentang dia: ${info.summary}`);
      if (facts.length) {
        lines.push(...facts.map((f) => `- ${f}`));
      }

      if (!lines.length) return null;

      return `${displayName}${info.nickname ? ` (biasa dipanggil "${info.nickname}")` : ""}:\n${lines.join("\n")}`;
    })
    .filter(Boolean);

  if (!blocks.length) return "";

  return `

Member lain yang disebut/di-mention di pesan ini, ini yang kamu ingat soal mereka (boleh dipakai buat nyambungin obrolan, tapi jangan asal bocorin detail sensitif):
${blocks.join("\n\n")}`;
}

// Escape karakter spesial regex biar nama yang mengandung titik/tanda
// baca aneh tidak bikin regex-nya error atau salah match.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Deteksi member yang disebut lewat NAMA BIASA di kalimat (tanpa
// @mention), misal "gimana kabarnya Budi hari ini". Cuma dicek terhadap
// user yang SUDAH PERNAH chat sama bot (ada di companion_memory) --
// selain lebih murah (tidak perlu scan semua member server), member yang
// belum pernah chat memang belum punya apa-apa yang bisa diceritakan.
//
// Dicocokkan ke username Discord ATAU nickname di server itu (kalau
// pesannya datang dari guild), pakai word-boundary case-insensitive.
// Nama yang cuma 1-2 huruf sengaja dilewati supaya tidak salah kena
// kata umum (misal nama "Al" ke-trigger gara-gara kata lain).
export async function findNameMentionedUsers(msg, promptText, excludeIds = new Set()) {
  if (!promptText) return [];

  const knownIds = await listKnownCompanionUserIds(msg.author.id);
  const candidates = knownIds.filter((id) => !excludeIds.has(id));

  if (!candidates.length) return [];

  const found = [];

  for (const id of candidates) {
    try {
      let username = null;
      let nickname = null;
      let user = null;

      if (msg.guild) {
        const member = await msg.guild.members.fetch(id).catch(() => null);
        if (!member) continue; // sudah keluar server / gagal fetch, skip
        username = member.user.username;
        nickname = member.nickname;
        user = member.user;
      } else {
        user = await msg.client.users.fetch(id).catch(() => null);
        if (!user) continue;
        username = user.username;
      }

      const namesToCheck = [username, nickname].filter(
        (name) => name && name.length >= 3
      );

      const isMentioned = namesToCheck.some((name) => {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
        return re.test(promptText);
      });

      if (isMentioned) found.push(user);
    } catch {
      // gagal fetch salah satu kandidat, lanjut ke kandidat berikutnya
    }
  }

  return found;
}

// Bangun array `messages` siap kirim ke callGemini().
export async function buildCompanionMessages(userId, prompt, mentionedUsers = []) {
  const state = await getOrCreateCompanion(userId);
  const facts = safeParseFacts(state.facts);
  const mentionedContext = await buildMentionedMembersContext(
    mentionedUsers.filter((u) => u.id !== userId)
  );

  const systemContent = `
Kamu adalah ${BOT_NAME}.

Nama kamu adalah ${BOT_NAME}.
Kamu adalah AI Discord yang ramah, sopan,
informatif, santai, dan natural.

Gunakan bahasa Indonesia jika pengguna
berbicara menggunakan bahasa Indonesia.

Jawab dengan jelas dan jangan terlalu
panjang kecuali pengguna meminta penjelasan detail.

---

Konteks tambahan tentang user ini (gunakan diam-diam, jangan disebut ulang secara eksplisit):

Tingkat kedekatanmu dengan user ini: ${affectionLabel(state.affection)} (poin kedekatan: ${state.affection}).
${state.nickname ? `Kamu biasa memanggil user ini dengan sebutan "${state.nickname}".` : ""}

Ringkasan hubungan & obrolan kalian sejauh ini (rangkuman, bukan transkrip lengkap):
${state.summary ? state.summary : "(belum ada, ini termasuk interaksi awal kalian)"}

Hal-hal yang kamu ingat tentang user ini:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(belum ada catatan khusus)"}
${mentionedContext}
  `.trim();

  const messages = [{ role: "system", content: systemContent }];

  // Cuma bawa SATU turn terakhir (bukan 5), karena konteks jangka
  // panjang sudah terwakili lewat ringkasan & fakta di atas.
  if (state.last_prompt && state.last_response) {
    messages.push({
      role: "user",
      content: state.last_prompt.slice(-TRIM_CHARS),
    });
    messages.push({
      role: "assistant",
      content: state.last_response.slice(-TRIM_CHARS),
    });
  }

  messages.push({ role: "user", content: prompt });

  return { messages, state };
}

// Minta Gemini merangkum ulang: ringkasan lama + turn baru -> ringkasan
// baru yang singkat + daftar fakta pendek. Dipanggil hanya sesekali
// (tiap SUMMARY_EVERY_N_TURNS), bukan tiap pesan.
async function regenerateSummary(state, prompt, reply) {
  const oldFacts = safeParseFacts(state.facts);

  const summarizerMessages = [
    {
      role: "system",
      content: `
Kamu adalah sistem PERINGKAS MEMORI untuk AI companion bernama ${BOT_NAME}.
Tugasmu: gabungkan ringkasan lama + percakapan baru menjadi SATU ringkasan
baru yang SANGAT SINGKAT (maksimal 4 kalimat), fokus ke hal yang penting
untuk diingat jangka panjang (topik favorit, kepribadian user, running
joke, hal yang sedang dihadapi user), BUKAN detail kecil yang tidak penting.

Juga perbarui daftar "fakta" pendek tentang user (maks ${MAX_FACTS} item,
tiap item singkat, misal "suka anime isekai", "sedang belajar coding",
"panggilan kesukaan: kak").

Balas HANYA dengan JSON valid, tanpa markdown, tanpa penjelasan tambahan,
format persis:
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

Percakapan baru:
User: ${prompt}
${BOT_NAME}: ${reply}
      `.trim(),
    },
  ];

  const outcome = await callGemini(summarizerMessages);
  if (!outcome) return null;

  try {
    const cleaned = outcome.result.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : state.summary,
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter((f) => typeof f === "string").slice(0, MAX_FACTS)
        : oldFacts,
    };
  } catch (error) {
    console.error("Gagal parse hasil ringkasan companion:", error.message);
    return null;
  }
}

// Dipanggil setelah AI berhasil membalas. Update affection, simpan turn
// terakhir, dan (kalau sudah waktunya) regenerate ringkasan.
export async function updateCompanionAfterReply(userId, state, prompt, reply) {
  const newAffection = Math.min(
    (state.affection || 0) + AFFECTION_PER_TURN,
    9999
  );
  const turns = (state.turns_since_summary || 0) + 1;

  let summary = state.summary;
  let facts = state.facts;
  let turnsSinceSummary = turns;

  if (turns >= SUMMARY_EVERY_N_TURNS) {
    const updated = await regenerateSummary(state, prompt, reply);

    if (updated) {
      summary = updated.summary;
      facts = JSON.stringify(updated.facts);
    }

    turnsSinceSummary = 0;
  }

  await saveCompanion(userId, {
    affection: newAffection,
    summary,
    facts,
    last_prompt: prompt,
    last_response: reply,
    turns_since_summary: turnsSinceSummary,
  });

  return { affection: newAffection };
}

export async function getCompanionProfile(userId) {
  const state = await getOrCreateCompanion(userId);
  return {
    ...state,
    facts: safeParseFacts(state.facts),
    label: affectionLabel(state.affection),
  };
}

// Versi read-only untuk lihat profil member LAIN (mprofil @user).
// Return null kalau member itu belum pernah chat sama mokachan sama
// sekali -- supaya tidak bikin baris companion_memory kosong cuma
// gara-gara di-cek doang.
export async function getCompanionPublicProfile(userId) {
  const info = await getCompanionPublicInfo(userId);
  if (!info) return null;

  return {
    ...info,
    facts: safeParseFacts(info.facts),
    label: affectionLabel(info.affection),
  };
}

export async function resetCompanionMemory(userId) {
  await resetCompanion(userId);
  // Bersihin juga buffer chat biasa yang belum sempat diproses, biar
  // reset ini benar-benar bersih total (tidak ada sisa yang nanti
  // "menghidupkan lagi" summary lama begitu buffer kepenuhan lagi).
  await clearPassiveBuffer(userId);
}