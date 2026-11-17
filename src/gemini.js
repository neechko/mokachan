import {
  AI_ENDPOINT,
  AI_API_KEY,
  AI_MODELS,
  AI_MAX_RETRIES,
  AI_RETRY_DELAY,
  AI_MAX_TOTAL_ATTEMPTS,
  AI_MODEL_COOLDOWN_MS,
  DEBUG_MODE,
} from "./config.js";
import { logModelUsage } from "./database.js";
import { searchWeb } from "./webSearch.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rateLimitedUntil = new Map();

// Helper: hanya log jika DEBUG_MODE=true
function debugLog(...args) {
  if (DEBUG_MODE) console.log(...args);
}

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

async function callModel(model, messages, budget, tools = null) {
  let delay = AI_RETRY_DELAY;

  for (let attempt = 1; attempt <= AI_MAX_RETRIES; attempt++) {
    if (budget.used >= budget.max) return { failed: true, budgetExceeded: true };
    budget.used++;

    try {
      const body = {
        model,
        messages,
        temperature: 0.8,
        max_tokens: 2048,
        stream: false,
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        let errJson = {};
        try { errJson = JSON.parse(errText); } catch {}

        // Error tetap selalu tampil (bukan debug)
        console.error(`AI [${model}] HTTP ${response.status}:`, errJson);

        if (response.status === 429) {
          putOnCooldown(model, getRetryAfterMs(response));
          await logModelUsage(model, false);
          return { failed: true, rateLimited: true };
        }

        if (response.status === 404 || response.status === 410) {
          console.warn(`AI [${model}] tidak tersedia. Langsung skip.`);
          await logModelUsage(model, false);
          return { failed: true, rateLimited: false };
        }

        if (response.status === 400 && tools && tools.length > 0) {
          console.warn(`AI [${model}] tidak support Tool Calling. Fallback mode biasa.`);
          return callModel(model, messages, budget, null);
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
      debugLog(`\n[DEBUG ${model}] Response:`, JSON.stringify(data).substring(0, 800));

      const message = data?.choices?.[0]?.message || {};
      const result = message.content?.trim() || "";
      const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

      if (!result && !hasToolCalls) {
        console.error(`AI [${model}] empty response without tool calls`);
        await logModelUsage(model, false);
        return { failed: true, rateLimited: false };
      }

      await logModelUsage(model, true);
      return { failed: false, result, message };
    } catch (err) {
      console.error(`AI [${model}] Network error:`, err.message);
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

export async function callGemini(messages, options = {}) {
  const useTools = options.useTools !== false;

  const sys = messages.find((m) => m.role === "system");
  const chat = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const initialMessages = sys
    ? [{ role: "system", content: sys.content }, ...chat]
    : chat;

  const budget = { used: 0, max: AI_MAX_TOTAL_ATTEMPTS };
  const skipped = [];

  const tools = useTools ? [
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the web for current events, real-time information, weather, schedules, or unknown facts.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The exact search query." }
          },
          required: ["query"]
        }
      }
    }
  ] : null;

  for (const model of AI_MODELS) {
    if (isOnCooldown(model)) {
      skipped.push(model);
      continue;
    }
    if (budget.used >= budget.max) break;

    let currentMessages = [...initialMessages];
    let toolIterations = 0;
    const MAX_TOOL_ITERATIONS = 2;
    let finalResult = null;
    let modelFailed = false;

    while (toolIterations <= MAX_TOOL_ITERATIONS) {
      const out = await callModel(model, currentMessages, budget, tools);

      if (out.budgetExceeded) return null;
      if (out.failed) {
        modelFailed = true;
        break;
      }

      const { message, result } = out;

      if (message.tool_calls && message.tool_calls.length > 0) {
        toolIterations++;
        currentMessages.push(message);

        if (toolIterations > MAX_TOOL_ITERATIONS) {
          debugLog(`AI [${model}] Max tool iterations. Forcing final answer.`);
          break;
        }

        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === "search_web") {
            let args = {};
            try {
              args = JSON.parse(toolCall.function.arguments || "{}");
            } catch (e) {
              console.error("Failed to parse tool arguments:", toolCall.function.arguments);
            }

            const searchResult = await searchWeb(args.query || "");

            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: searchResult
            });
          }
        }
      } else {
        finalResult = result;
        break;
      }
    }

    if (!finalResult && !modelFailed) {
      currentMessages.push({
        role: "system",
        content: "Kamu telah mencapai batas maksimal pencarian web. Berikan jawaban akhirmu kepada user berdasarkan hasil pencarian yang sudah kamu kumpulkan di atas. JANGAN panggil tool 'search_web' lagi, langsung tulis teks jawabanmu sekarang."
      });
      const finalOut = await callModel(model, currentMessages, budget, null);
      if (!finalOut.failed && finalOut.result) {
        finalResult = finalOut.result;
      } else {
        modelFailed = true;
      }
    }

    if (!modelFailed && finalResult !== null) {
      return { result: finalResult, model };
    }
  }

  if (skipped.length) console.warn(`Cooldown: ${skipped.join(", ")}`);
  console.error("All models failed.");
  return null;
}