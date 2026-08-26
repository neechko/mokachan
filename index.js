import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";
import { handleLyricsCommand } from "./lyrics.js";

dotenv.config();

// ==================== CONFIG ====================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTIFY_CHANNEL_ID = process.env.CHANNEL_ID;

const BOT_NAME = process.env.BOT_NAME || "nyomoxchan";
const PREFIX = process.env.COMMAND_PREFIX || "?";
const COMMAND_CASE_INSENSITIVE =
  process.env.COMMAND_CASE_INSENSITIVE === "true";
function commandMatches(content, command) {
  if (COMMAND_CASE_INSENSITIVE) {
    const normalizedContent = content.toLowerCase();
    const normalizedCommand = command.toLowerCase();

    return (
      normalizedContent === normalizedCommand ||
      normalizedContent.startsWith(
        `${normalizedCommand} `
      )
    );
  }

  return (
    content === command ||
    content.startsWith(`${command} `)
  );
}

const HISTORY_COUNT = parseInt(process.env.HISTORY_COUNT, 10) || 5;
const TRIM_CHARS = parseInt(process.env.TRIM_CHARS, 10) || 700;
const MAX_OUTPUT_CHARS =
  parseInt(process.env.MAX_OUTPUT_CHARS, 10) || 1800;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.7-flash";

const GEMINI_MAX_RETRIES =
  parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 4;

const GEMINI_RETRY_DELAY =
  parseInt(process.env.GEMINI_RETRY_DELAY, 10) || 2000;

// ==================== COMMANDS ====================

const COMMANDS = {
  ai: process.env.CMD_NYOMOXCHAN || "nyomoxchan",
  lyrics: process.env.CMD_LYRICS || "lyrics",
  history: process.env.CMD_HISTORY || "history",
  clearHistory: process.env.CMD_CLEARHISTORY || "clearhistory",
  stats: process.env.CMD_STATS || "stats",
  ping: process.env.CMD_PING || "ping",
  help: process.env.CMD_HELP || "help",
};

// ==================== VALIDATION ====================

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN belum diatur.");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY belum diatur.");
  process.exit(1);
}

// ==================== DISCORD ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let db;

// ==================== DATABASE ====================

async function initDB() {
  db = await open({
    filename: "./nyomoxchan_history.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      prompt TEXT,
      response TEXT,
      created_at TEXT,
      model TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT,
      success INTEGER,
      used_at TEXT
    )
  `);
}

// ==================== HISTORY ====================

async function getRelevantHistory(userId, replyMsgId) {
  const extraHistory = [];

  if (replyMsgId) {
    try {
      const repliedMsg = await client.channels.cache
        .get(NOTIFY_CHANNEL_ID)
        ?.messages.fetch(replyMsgId);

      if (
        repliedMsg &&
        repliedMsg.author.id === client.user.id
      ) {
        const row = await db.get(
          `
          SELECT prompt, response, model
          FROM history
          WHERE response = ?
          LIMIT 1
          `,
          repliedMsg.content
        );

        if (row) {
          extraHistory.push(row);
        }
      }
    } catch (error) {
      console.error(
        "⚠️ Gagal mengambil reply history:",
        error.message
      );
    }
  }

  const historyRows = await db.all(
    `
    SELECT prompt, response, model
    FROM history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    userId,
    HISTORY_COUNT
  );

  return [
    ...historyRows.reverse(),
    ...extraHistory,
  ];
}

async function clearHistory(userId) {
  await db.run(
    "DELETE FROM history WHERE user_id = ?",
    userId
  );
}

// ==================== GEMINI ====================

async function callGemini(messages) {
  let delay = GEMINI_RETRY_DELAY;

  const systemMessage = messages.find(
    (message) => message.role === "system"
  );

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: message.content,
        },
      ],
    }));

  for (
    let attempt = 1;
    attempt <= GEMINI_MAX_RETRIES;
    attempt++
  ) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          GEMINI_MODEL
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify({
            system_instruction: systemMessage
              ? {
                  parts: [
                    {
                      text: systemMessage.content,
                    },
                  ],
                }
              : undefined,

            contents,

            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 2048,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({}));

        const status = response.status;

        console.error(
          `❌ Gemini HTTP ${status}:`,
          errorData
        );

        if (status === 429 && attempt < GEMINI_MAX_RETRIES) {
          console.log(
            `⏳ Rate limit. Percobaan ${attempt}/${GEMINI_MAX_RETRIES}. ` +
            `Menunggu ${delay}ms...`
          );

          await new Promise((resolve) =>
            setTimeout(resolve, delay)
          );

          delay *= 2;
          continue;
        }

        await db.run(
          `
          INSERT INTO model_usage
          (model, success, used_at)
          VALUES (?, 0, ?)
          `,
          GEMINI_MODEL,
          new Date().toISOString()
        );

        return null;
      }

      const data = await response.json();

      const result =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim() || "";

      if (!result) {
        console.error(
          "❌ Gemini tidak mengembalikan teks:",
          JSON.stringify(data)
        );

        await db.run(
          `
          INSERT INTO model_usage
          (model, success, used_at)
          VALUES (?, 0, ?)
          `,
          GEMINI_MODEL,
          new Date().toISOString()
        );

        return null;
      }

      await db.run(
        `
        INSERT INTO model_usage
        (model, success, used_at)
        VALUES (?, 1, ?)
        `,
        GEMINI_MODEL,
        new Date().toISOString()
      );

      return {
        result,
        model: GEMINI_MODEL,
      };
    } catch (error) {
      console.error(
        "❌ Gemini request error:",
        error.message
      );

      if (attempt < GEMINI_MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay)
        );

        delay *= 2;
      }
    }
  }

  return null;
}

// ==================== AI REQUEST ====================

async function sendRequest(prompt, msg) {
  const history = await getRelevantHistory(
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
      {
        role: "user",
        content: item.prompt.slice(-TRIM_CHARS),
      },
      {
        role: "assistant",
        content: item.response.slice(-TRIM_CHARS),
      },
    ]),

    {
      role: "user",
      content: prompt,
    },
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

  for (
    let i = 0;
    i < finalText.length;
    i += MAX_OUTPUT_CHARS
  ) {
    chunks.push(
      finalText.slice(
        i,
        i + MAX_OUTPUT_CHARS
      )
    );
  }

  await thinkingMessage.edit(chunks[0]);

  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]);
  }

  if (result.length <= 10000) {
    await db.run(
      `
      INSERT INTO history
      (user_id, prompt, response, created_at, model)
      VALUES (?, ?, ?, ?, ?)
      `,
      msg.author.id,
      prompt,
      result,
      new Date().toISOString(),
      model
    );
  }
}

// ==================== READY ====================

client.once("ready", async () => {
  console.log(
    `✅ ${BOT_NAME} siap! Logged in sebagai ${client.user.tag}`
  );

  console.log(
    `🤖 Gemini: ${GEMINI_MODEL}`
  );

  console.log(
    `⌨️ Prefix: ${PREFIX}`
  );

  console.log(
    `💬 AI command: ${PREFIX}${COMMANDS.ai}`
  );

  if (!NOTIFY_CHANNEL_ID) {
    console.warn(
      "⚠️ CHANNEL_ID belum di-set."
    );
    return;
  }

  try {
    const channel = await client.channels.fetch(
      NOTIFY_CHANNEL_ID
    );

    if (channel) {
      await channel.send(
        `✅ Halo guys! ${BOT_NAME} siap membantu 🚀`
      );
    }
  } catch (error) {
    console.error(
      "❌ Gagal mengirim notifikasi:",
      error.message
    );
  }
});

// ==================== MESSAGE HANDLER ====================

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  // ==================== LYRICS ====================

  const lyricsCommand =
    `${PREFIX}${COMMANDS.lyrics}`;

  if (commandMatches(content, lyricsCommand)) {
    return handleLyricsCommand(msg, PREFIX, COMMANDS.lyrics, BOT_NAME);
  }

  // ==================== AI ====================

  const aiCommand =
    `${PREFIX}${COMMANDS.ai}`;

  if (commandMatches(content, aiCommand)) {
    const prompt = content
      .slice(aiCommand.length)
      .trim();

    if (!prompt) {
      return msg.reply(
        `❌ Tulis pertanyaan setelah ${aiCommand}.`
      );
    }

    return sendRequest(prompt, msg);
  }

  // ==================== HISTORY ====================

  const historyCommand =
    `${PREFIX}${COMMANDS.history}`;

  if (commandMatches(content, historyCommand)) {
    const rows = await db.all(
      `
      SELECT prompt, response, created_at
      FROM history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 5
      `,
      msg.author.id
    );

    if (!rows.length) {
      return msg.reply(
        "Tidak ada history."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(
        "🕒 History Chatmu (terakhir 5)"
      )
      .setColor(0xffaa00)
      .setFooter({
        text: `${BOT_NAME}`,
      })
      .setTimestamp();

    let description = "";

    for (const row of rows) {
      description +=
        `**Q:** ${row.prompt}\n` +
        `**A:** ${row.response}\n` +
        `*${row.created_at}*\n\n`;
    }

    embed.setDescription(
      description.slice(0, 4096)
    );

    return msg.reply({
      embeds: [embed],
    });
  }

  // ==================== CLEAR HISTORY ====================

  const clearHistoryCommand =
    `${PREFIX}${COMMANDS.clearHistory}`;

  if (commandMatches(content, clearHistoryCommand)) {
    await clearHistory(msg.author.id);

    return msg.reply(
      "🗑️ Semua history chatmu berhasil dihapus!"
    );
  }

  // ==================== STATS ====================

  const statsCommand =
    `${PREFIX}${COMMANDS.stats}`;

  if (commandMatches(content, statsCommand)) {
    const rows = await db.all(`
      SELECT
        model,
        SUM(success) AS sukses,
        COUNT(*) AS total,
        ROUND(
          (SUM(success) * 100.0) / COUNT(*),
          2
        ) AS rate
      FROM model_usage
      GROUP BY model
      ORDER BY rate DESC
    `);

    if (!rows.length) {
      return msg.reply(
        "📊 Belum ada data penggunaan Gemini."
      );
    }

    function makeBar(rate) {
      const filled = Math.round(rate / 5);

      return (
        "█".repeat(filled) +
        "░".repeat(20 - filled)
      );
    }

    const description = rows
      .map(
        (row) =>
          `🤖 **${row.model}**\n` +
          `[${makeBar(row.rate)}] ` +
          `${row.rate}% ` +
          `(${row.sukses}/${row.total})`
      )
      .join("\n\n");

    const embed = new EmbedBuilder()
      .setTitle("📊 Statistik Gemini")
      .setColor(0x33cc33)
      .setDescription(description)
      .setFooter({
        text: `${BOT_NAME} AI`,
      })
      .setTimestamp();

    return msg.reply({
      embeds: [embed],
    });
  }

  // ==================== HELP ====================

  const helpCommand =
    `${PREFIX}${COMMANDS.help}`;

  if (commandMatches(content, helpCommand)) {
    const embed = new EmbedBuilder()
      .setTitle(
        `📖 ${BOT_NAME} Commands`
      )
      .setColor(0x00ffff)
      .setDescription(
        `**${PREFIX}${COMMANDS.ai} [pertanyaan]** - Tanya ${BOT_NAME} menggunakan Gemini\n` +
        `**${PREFIX}${COMMANDS.lyrics} [judul lagu]** - Cari lirik lagu\n` +
        `**${PREFIX}${COMMANDS.history}** - Lihat chat terakhir\n` +
        `**${PREFIX}${COMMANDS.clearHistory}** - Hapus semua history\n` +
        `**${PREFIX}${COMMANDS.stats}** - Statistik penggunaan Gemini\n` +
        `**${PREFIX}${COMMANDS.ping}** - Cek latency\n` +
        `**${PREFIX}${COMMANDS.help}** - Tampilkan command`
      )
      .setFooter({
        text: `${BOT_NAME}`,
      })
      .setTimestamp();

    return msg.reply({
      embeds: [embed],
    });
  }

  // ==================== PING ====================

  const pingCommand =
    `${PREFIX}${COMMANDS.ping}`;

  if (commandMatches(content, pingCommand)) {
    const latency =
      Date.now() - msg.createdTimestamp;

    const embed = new EmbedBuilder()
      .setTitle("🏓 Pong!")
      .setColor(0x00ff00)
      .setDescription(
        `Latency: ${latency}ms`
      );

    return msg.reply({
      embeds: [embed],
    });
  }
});

// ==================== START ====================

(async () => {
  try {
    await initDB();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error(
      "❌ Gagal menjalankan bot:",
      error
    );

    process.exit(1);
  }
})();