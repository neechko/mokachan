import {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_MAX_RETRIES,
  GEMINI_RETRY_DELAY,
} from "./config.js";
import { logModelUsage } from "./database.js";

export async function callGemini(messages) {
  let delay = GEMINI_RETRY_DELAY;

  const systemMessage = messages.find(
    (message) => message.role === "system"
  );

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
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

        console.error(`❌ Gemini HTTP ${status}:`, errorData);

        if (status === 429 && attempt < GEMINI_MAX_RETRIES) {
          console.log(
            `⏳ Rate limit. Percobaan ${attempt}/${GEMINI_MAX_RETRIES}. ` +
            `Menunggu ${delay}ms...`
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }

        await logModelUsage(GEMINI_MODEL, false);
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

        await logModelUsage(GEMINI_MODEL, false);
        return null;
      }

      await logModelUsage(GEMINI_MODEL, true);

      return { result, model: GEMINI_MODEL };
    } catch (error) {
      console.error("❌ Gemini request error:", error.message);

      if (attempt < GEMINI_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  return null;
}
