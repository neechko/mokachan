import {
  GEMINI_API_KEY,
  GEMINI_MODELS,
  GEMINI_MAX_RETRIES,
  GEMINI_RETRY_DELAY,
  GEMINI_MAX_TOTAL_ATTEMPTS,
  GEMINI_MODEL_COOLDOWN_MS,
} from "./config.js";
import { logModelUsage } from "./database.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Model yang barusan kena 429 disimpan di sini supaya TIDAK dicoba
// lagi selama masa cooldown, walaupun dipanggil dari pesan user yang
// berbeda. Tanpa ini, tiap pesan baru akan tetap menghajar model yang
// sudah jelas lagi limit, dan itu yang bikin makin banyak 429.
const rateLimitedUntil = new Map(); // model -> timestamp ms

function isOnCooldown(model) {
  const until = rateLimitedUntil.get(model);
  return typeof until === "number" && Date.now() < until;
}

function putOnCooldown(model, retryAfterMs) {
  const cooldown = retryAfterMs ?? GEMINI_MODEL_COOLDOWN_MS;
  rateLimitedUntil.set(model, Date.now() + cooldown);
}

// Ambil header Retry-After kalau Gemini mengirimkannya, biar cooldown
// mengikuti instruksi server, bukan cuma tebakan kita sendiri.
function getRetryAfterMs(response) {
  const header = response.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

// Coba SATU model tertentu, dengan retry untuk error yang sifatnya
// sementara (network error / 5xx). Untuk 429 (limit/kuota habis),
// TIDAK di-retry di model yang sama -> langsung serahkan ke fallback,
// dan model tsb masuk cooldown supaya tidak dicoba lagi terlalu cepat.
//
// `budget` adalah counter BERSAMA lintas semua model dalam satu
// pemanggilan callGemini(). Begitu budget habis, fungsi ini berhenti
// mengirim request sama sekali, apa pun jumlah model yang tersisa.
async function callGeminiModel(model, contents, systemMessage, budget) {
  let delay = GEMINI_RETRY_DELAY;

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    if (budget.used >= budget.max) {
      return { failed: true, budgetExceeded: true };
    }
    budget.used++;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify({
            system_instruction: systemMessage
              ? { parts: [{ text: systemMessage.content }] }
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
        const errorData = await response.json().catch(() => ({}));
        const status = response.status;

        console.error(`❌ Gemini [${model}] HTTP ${status}:`, errorData);

        if (status === 429) {
          // Limit/kuota habis untuk model ini -> jangan buang waktu
          // retry, langsung gagal supaya caller pindah ke model lain,
          // dan istirahatkan model ini biar tidak dihajar lagi terlalu cepat.
          const retryAfterMs = getRetryAfterMs(response);
          putOnCooldown(model, retryAfterMs);
          await logModelUsage(model, false);
          return { failed: true, rateLimited: true };
        }

        if (attempt < GEMINI_MAX_RETRIES) {
          console.log(
            `⏳ [${model}] Percobaan ${attempt}/${GEMINI_MAX_RETRIES}. ` +
              `Menunggu ${delay}ms...`
          );
          await sleep(delay);
          delay *= 2;
          continue;
        }

        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      const data = await response.json();

      const result =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim() || "";

      if (!result) {
        console.error(
          `❌ Gemini [${model}] tidak mengembalikan teks:`,
          JSON.stringify(data)
        );
        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      await logModelUsage(model, true);
      return { failed: false, result };
    } catch (error) {
      console.error(`❌ Gemini [${model}] request error:`, error.message);

      if (attempt < GEMINI_MAX_RETRIES) {
        await sleep(delay);
        delay *= 2;
        continue;
      }

      await logModelUsage(model, false);
      return { failed: true, rateLimited: false };
    }
  }

  return { failed: true, rateLimited: false };
}

// Coba semua model di GEMINI_MODELS berurutan. Berhenti di model
// pertama yang berhasil.
// - Model yang lagi cooldown (baru kena 429) dilewati TANPA request.
// - Total request lintas semua model dibatasi oleh GEMINI_MAX_TOTAL_ATTEMPTS,
//   jadi berapa pun banyaknya model, tidak akan spam API tanpa batas.
// Kalau semua gagal atau budget habis, return null.
export async function callGemini(messages) {
  const systemMessage = messages.find(
    (message) => message.role === "system"
  );

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const budget = { used: 0, max: GEMINI_MAX_TOTAL_ATTEMPTS };
  const skippedCooldown = [];

  for (const model of GEMINI_MODELS) {
    if (isOnCooldown(model)) {
      skippedCooldown.push(model);
      continue;
    }

    if (budget.used >= budget.max) {
      console.warn(
        `⚠️ Batas total request Gemini (${budget.max}) tercapai untuk permintaan ini, berhenti.`
      );
      break;
    }

    const outcome = await callGeminiModel(model, contents, systemMessage, budget);

    if (!outcome.failed) {
      return { result: outcome.result, model };
    }

    if (outcome.budgetExceeded) {
      console.warn(`⚠️ Budget request habis saat mencoba "${model}", berhenti.`);
      break;
    }

    const reason = outcome.rateLimited ? "kena limit" : "error";
    console.warn(
      `⚠️ Model "${model}" ${reason}, mencoba model berikutnya...`
    );
  }

  if (skippedCooldown.length) {
    console.warn(
      `⏭️ Dilewati karena masih cooldown (baru kena limit): ${skippedCooldown.join(", ")}`
    );
  }

  console.error("❌ Semua model Gemini gagal merespons.");
  return null;
}