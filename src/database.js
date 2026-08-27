import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { HISTORY_COUNT } from "./config.js";

let db;

export async function initDB() {
  db = await open({
    filename: "./mokachan_history.db",
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

  return db;
}

// ==================== HISTORY (untuk fitur AI) ====================

export async function getRelevantHistory(client, notifyChannelId, userId, replyMsgId) {
  const extraHistory = [];

  if (replyMsgId) {
    try {
      const repliedMsg = await client.channels.cache
        .get(notifyChannelId)
        ?.messages.fetch(replyMsgId);

      if (repliedMsg && repliedMsg.author.id === client.user.id) {
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
      console.error("⚠️ Gagal mengambil reply history:", error.message);
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

  return [...historyRows.reverse(), ...extraHistory];
}

export async function saveHistory(userId, prompt, result, model) {
  if (result.length > 10000) return;

  await db.run(
    `
    INSERT INTO history
    (user_id, prompt, response, created_at, model)
    VALUES (?, ?, ?, ?, ?)
    `,
    userId,
    prompt,
    result,
    new Date().toISOString(),
    model
  );
}

export async function getRecentHistory(userId, limit = 5) {
  return db.all(
    `
    SELECT prompt, response, created_at
    FROM history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    userId,
    limit
  );
}

export async function clearHistory(userId) {
  await db.run("DELETE FROM history WHERE user_id = ?", userId);
}

// ==================== MODEL USAGE (untuk fitur stats) ====================

export async function logModelUsage(model, success) {
  await db.run(
    `
    INSERT INTO model_usage
    (model, success, used_at)
    VALUES (?, ?, ?)
    `,
    model,
    success ? 1 : 0,
    new Date().toISOString()
  );
}

export async function getModelStats() {
  return db.all(`
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
}
