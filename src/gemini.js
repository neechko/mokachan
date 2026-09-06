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

// Models that just got hit with a 429 are stored here so they are NOT
// retried again during the cooldown window, even if called from a
// different user's message. Without this, every new message would
// keep hammering a model that's already clearly rate-limited, which is
// exactly what causes more 429s.
const rateLimitedUntil = new Map(); // model -> timestamp ms

function isOnCooldown(model) {
  const until = rateLimitedUntil.get(model);
  return typeof until === "number" && Date.now() < until;
}

function putOnCooldown(model, retryAfterMs) {
  const cooldown = retryAfterMs ?? GEMINI_MODEL_COOLDOWN_MS;
  rateLimitedUntil.set(model, Date.now() + cooldown);
}

// Reads the Retry-After header if Gemini sends one, so the cooldown
// follows the server's own instruction instead of just our guess.
function getRetryAfterMs(response) {
  const header = response.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

// Tries ONE specific model, retrying on transient errors (network
// errors / 5xx). For 429 (rate limit/quota exhausted), it is NOT
// retried on the same model -- it's handed off to the fallback
// immediately, and that model goes on cooldown so it isn't hit again
// too soon.
//
// `budget` is a counter SHARED across all models within a single
// callGemini() call. Once the budget runs out, this function stops
// sending requests entirely, regardless of how many models remain.
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

        console.error(`Gemini [${model}] HTTP ${status}:`, errorData);

        if (status === 429) {
          // Rate limit/quota exhausted for this model -- don't waste
          // time retrying, fail immediately so the caller moves to the
          // next model, and rest this model so it isn't hit again too soon.
          const retryAfterMs = getRetryAfterMs(response);
          putOnCooldown(model, retryAfterMs);
          await logModelUsage(model, false);
          return { failed: true, rateLimited: true };
        }

        if (attempt < GEMINI_MAX_RETRIES) {
          console.log(
            `[${model}] Attempt ${attempt}/${GEMINI_MAX_RETRIES}. ` +
              `Waiting ${delay}ms...`
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
          `Gemini [${model}] returned no text:`,
          JSON.stringify(data)
        );
        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      await logModelUsage(model, true);
      return { failed: false, result };
    } catch (error) {
      console.error(`Gemini [${model}] request error:`, error.message);

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

// Tries every model in GEMINI_MODELS in order. Stops at the first one
// that succeeds.
// - A model currently on cooldown (just got a 429) is skipped WITHOUT
//   sending a request.
// - Total requests across all models are capped by
//   GEMINI_MAX_TOTAL_ATTEMPTS, so no matter how many models are
//   configured, the API is never spammed without limit.
// Returns null if every model fails or the budget runs out.
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
        `Gemini total request limit (${budget.max}) reached for this call, stopping.`
      );
      break;
    }

    const outcome = await callGeminiModel(model, contents, systemMessage, budget);

    if (!outcome.failed) {
      return { result: outcome.result, model };
    }

    if (outcome.budgetExceeded) {
      console.warn(`Request budget exhausted while trying "${model}", stopping.`);
      break;
    }

    const reason = outcome.rateLimited ? "rate limited" : "error";
    console.warn(
      `Model "${model}" ${reason}, trying the next model...`
    );
  }

  if (skippedCooldown.length) {
    console.warn(
      `Skipped due to active cooldown (recently rate limited): ${skippedCooldown.join(", ")}`
    );
  }

  console.error("All Gemini models failed to respond.");
  return null;
}