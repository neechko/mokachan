import {
  AI_ENDPOINT,
  AI_API_KEY,
  AI_MODELS,
  AI_MAX_RETRIES,
  AI_RETRY_DELAY,
  AI_MAX_TOTAL_ATTEMPTS,
  AI_MODEL_COOLDOWN_MS,
} from "./config.js";
import { logModelUsage } from "./database.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rateLimitedUntil = new Map();

function isOnCooldown(model) {
  const until = rateLimitedUntil.get(model);
  return typeof until === "number" && Date.now() < until;
}

function putOnCooldown(model, ms) {
  rateLimitedUntil.set(model, Date.now() + (ms ?? AI_MODEL_COOLDOWN_MS));
}

function getRetryAfterMs(response) {
  const ra = response.headers?.get?.("retry-after");
  if (ra) {
    const s = parseInt(ra, 10);
    if (Number.isFinite(s)) return s * 1000;
  }
  const reset = response.headers?.get?.("x-ratelimit-reset");
  if (reset) {
    const e = parseInt(reset, 10);
    if (Number.isFinite(e)) {
      const ms = e > 1e12 ? e : e * 1000;
      const d = ms - Date.now();
      return d > 0 ? d : null;
    }
  }
  return null;
}

async function callModel(model, messages, budget) {
  let delay = AI_RETRY_DELAY;

  for (let attempt = 1; attempt <= AI_MAX_RETRIES; attempt++) {
    if (budget.used >= budget.max) return { failed: true, budgetExceeded: true };
    budget.used++;

    try {
      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.8,
          max_tokens: 2048,
          stream: false,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error(`AI [${model}] HTTP ${response.status}:`, err);

        if (response.status === 429) {
          putOnCooldown(model, getRetryAfterMs(response));
          await logModelUsage(model, false);
          return { failed: true, rateLimited: true };
        }

        if (attempt < AI_MAX_RETRIES) {
          await sleep(delay);
          delay *= 2;
          continue;
        }

        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      const data = await response.json();
      const result = data?.choices?.[0]?.message?.content?.trim() || "";

      if (!result) {
        console.error(`AI [${model}] empty response`);
        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      await logModelUsage(model, true);
      return { failed: false, result };
    } catch (err) {
      console.error(`AI [${model}] error:`, err.message);
      if (attempt < AI_MAX_RETRIES) {
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

export async function callGemini(messages) {
  const sys = messages.find((m) => m.role === "system");
  const chat = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const finalMessages = sys
    ? [{ role: "system", content: sys.content }, ...chat]
    : chat;

  const budget = { used: 0, max: AI_MAX_TOTAL_ATTEMPTS };
  const skipped = [];

  for (const model of AI_MODELS) {
    if (isOnCooldown(model)) {
      skipped.push(model);
      continue;
    }
    if (budget.used >= budget.max) break;

    const out = await callModel(model, finalMessages, budget);
    if (!out.failed) return { result: out.result, model };
    if (out.budgetExceeded) break;
  }

  if (skipped.length) console.warn(`Cooldown: ${skipped.join(", ")}`);
  console.error("All models failed.");
  return null;
}