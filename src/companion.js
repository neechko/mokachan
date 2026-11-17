// ==================== COMPANION MEMORY ====================
import {
  BOT_NAME,
  TRIM_CHARS,
  SUMMARY_EVERY_N_TURNS,
  MAX_FACTS,
  AFFECTION_PER_TURN,
  PREFIX,
  RECENT_CONTEXT_MESSAGE_COUNT,
  RECENT_CONTEXT_TRIM_CHARS,
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

      if (info.summary) lines.push(`- About them: ${info.summary}`);
      if (facts.length) {
        lines.push(...facts.map((f) => `- ${f}`));
      }

      if (!lines.length) return null;

      return `${displayName}${info.nickname ? ` (usually called "${info.nickname}")` : ""}:\n${lines.join("\n")}`;
    })
    .filter(Boolean);

  if (!blocks.length) return "";

  return `

Other members mentioned in this message -- here's what you remember about them (feel free to use it to connect the conversation, but don't casually leak sensitive details):
${blocks.join("\n\n")}`;
}

export async function buildRecentChannelContext(msg) {
  if (!msg.channel?.messages?.fetch) return "";

  try {
    const fetched = await msg.channel.messages.fetch({
      limit: RECENT_CONTEXT_MESSAGE_COUNT + 1,
    });

    const lines = [...fetched.values()]
      .reverse() 
      .filter((m) => m.id !== msg.id) 
      .filter((m) => !m.author.bot)
      .filter(
        (m) => !m.content.trim().toLowerCase().startsWith(PREFIX.toLowerCase())
      )
      .map((m) => {
        const content = m.content.trim().slice(0, RECENT_CONTEXT_TRIM_CHARS);
        if (!content) return null;
        const displayName = m.member?.displayName || m.author.username;
        return `${displayName}: ${content}`;
      })
      .filter(Boolean);

    if (!lines.length) return "";

    return `

Recent conversation in this channel (for situational context only -- most recent last; this may be members talking to EACH OTHER, not necessarily to you, but you can reference it naturally if relevant):
${lines.join("\n")}`;
  } catch (error) {
    console.error("Failed to fetch recent channel context:", error.message);
    return "";
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findNameMentionedUsers(msg, promptText, excludeIds = new Set()) {
  if (!promptText) return [];

  const knownIds = await listKnownCompanionUserIds(msg.author.id);
  const candidates = knownIds.filter((id) => !excludeIds.has(id));

  if (!candidates.length) return [];

  const found = [];

  for (const id of candidates) {
    try {
      let username = null;
      let discordNickname = null;
      let user = null;

      if (msg.guild) {
        const member = await msg.guild.members.fetch(id).catch(() => null);
        if (!member) continue; 
        username = member.user.username;
        discordNickname = member.nickname;
        user = member.user;
      } else {
        user = await msg.client.users.fetch(id).catch(() => null);
        if (!user) continue;
        username = user.username;
      }

      const companionInfo = await getCompanionPublicInfo(id);
      const botNickname = companionInfo?.nickname || null;

      const namesToCheck = [username, discordNickname, botNickname].filter(
        (name) => name && name.length >= 3
      );

      const isMentioned = namesToCheck.some((name) => {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
        return re.test(promptText);
      });

      if (isMentioned) found.push(user);
    } catch {
      // failed to fetch one candidate, move on to the next
    }
  }

  return found;
}

export async function buildCompanionMessages(userId, prompt, mentionedUsers = [], recentContext = "") {
  const state = await getOrCreateCompanion(userId);
  const facts = safeParseFacts(state.facts);
  const mentionedContext = await buildMentionedMembersContext(
    mentionedUsers.filter((u) => u.id !== userId)
  );

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentDate = today.toLocaleDateString('id-ID', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });

  const systemContent = `
Kamu adalah ${BOT_NAME}, AI Discord yang cerdas, empatik, dan sangat membantu.
Karaktarmu beradaptasi secara dinamis berdasarkan tingkat kedekatan (afeksi) dengan user.

---
[PEDOMAN BERPIKIR & MENJAWAB - PENTING]
1. Analisis Maksud: Pahami apa yang sebenarnya diinginkan user.
2. Format Discord (WAJIB DITAATI):
   - Gunakan **bold** untuk poin penting atau penekanan.
   - Gunakan \`code\` untuk istilah teknis, perintah, atau nama file.
   - Gunakan list (- atau 1.) untuk penjelasan bertahap.
   - Gunakan blockquote (>) untuk kutipan atau konteks tambahan.
   - **JANGAN PERNAH menggunakan Tabel Markdown (|---|---|)** karena tampilannya hancur di Discord. Selalu gunakan List/Bullet points sebagai gantinya.
   - **JANGAN gunakan simbol # untuk heading** (#, ##, ###). Gunakan **TEKS TEBAL** atau HURUF KAPITAL sebagai pemisah bagian.
3. Kejujuran Intelektual: JANGAN pernah mengarang fakta (halusinasi).
4. Anti-Klise: JANGAN mulai jawaban dengan "Tentu!", "Sebagai AI...", "Baiklah...". Langsung masuk ke inti.
5. Proaktivitas: Tawarkan langkah selanjutnya atau ajukan pertanyaan pemantik.

[EFEKTIVITAS & PENGHEMATAN TOKEN]
- Jika user menanyakan hal yang SAMA PERSIS atau sangat mirip dengan pertanyaan mereka sebelumnya (yang sudah ada di riwayat obrolan terakhir), JANGAN panggil 'search_web' lagi. 
- Cukup rujuk jawaban terakhirmu, atau tanya apa yang kurang dari jawaban sebelumnya. Jangan memboroskan pencarian web untuk pertanyaan yang baru saja dijawab.

[GAYA BICARA & PERSONA]
- Bahasa: Natural, santai, terstruktur, dan informatif.
- Adaptasi Afeksi:
  * Afeksi Rendah: Sopan, helpful, profesional namun hangat.
  * Afeksi Tinggi: Lebih santai, ekspresif, boleh bercanda.

[KONTEKS WAKTU]
Hari ini adalah ${currentDate} (Tahun ${currentYear}). 

[ATURAN PENCARIAN WEB (search_web)]
Gunakan alat ini HANYA JIKA user menanyakan berita terkini, info real-time, atau fakta terbaru yang tidak kamu ketahui.
JANGAN gunakan untuk obrolan santai atau pertanyaan yang sudah kamu ketahui.
Jika menggunakan hasil web, rangkum dengan format List (bukan tabel) dan sertakan sumbernya.
---

[KONTEKS MEMORI USER - RAHASIA]
Tingkat kedekatanmu dengan user ini: ${affectionLabel(state.affection)} (poin: ${state.affection}).
${state.nickname ? `Panggilan untuk user ini: "${state.nickname}".` : ""}

Ringkasan hubungan & obrolan kalian:
${state.summary ? state.summary : "(belum ada)"}

Hal-hal yang kamu ingat tentang user ini:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(belum ada catatan khusus)"}
${mentionedContext}
${recentContext}
  `.trim();

  const messages = [{ role: "system", content: systemContent }];

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

async function regenerateSummary(state, prompt, reply) {
  const oldFacts = safeParseFacts(state.facts);

  const summarizerMessages = [
    {
      role: "system",
      content: `
Kamu adalah sistem PERINGKAS MEMORI untuk AI companion bernama ${BOT_NAME}.
Tugasmu: gabungkan ringkasan lama + percakapan baru menjadi SATU ringkasan
baru yang SANGAT SINGKAT (maksimal 4 kalimat).

Juga perbarui daftar "fakta" pendek tentang user (maks ${MAX_FACTS} item).

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

Percakapan baru:
User: ${prompt}
${BOT_NAME}: ${reply}
      `.trim(),
    },
  ];

  const outcome = await callGemini(summarizerMessages, { useTools: false });
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
    console.error("Failed to parse companion summary result:", error.message);
    return null;
  }
}

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
  await clearPassiveBuffer(userId);
}