import { TAVILY_API_KEY } from "./config.js";

async function searchTavily(query) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic", // Hemat token & biaya
      max_results: 3,        // Batasi hasil agar konteks tidak kepanjangan
      include_answer: false,
    }),
  });

  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
  const data = await response.json();
  return data.results || [];
}

async function searchDuckDuckGo(query) {
  // Fallback aman menggunakan Instant Answer API DuckDuckGo (tanpa parsing HTML)
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) return [];
  
  const data = await res.json();
  const results = [];
  
  if (data.AbstractText) {
    results.push({
      title: data.Heading || "DuckDuckGo Answer",
      content: data.AbstractText,
      url: data.AbstractURL,
    });
  }
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, 3)) {
      if (topic.Text) {
        results.push({
          title: topic.Text.split(" - ")[0],
          content: topic.Text,
          url: topic.FirstURL,
        });
      }
    }
  }
  return results;
}

export async function searchWeb(query) {
  try {
    let results = [];
    if (TAVILY_API_KEY) {
      results = await searchTavily(query);
    }
    
    // Fallback ke DuckDuckGo jika Tavily gagal atau API Key kosong
    if (!results || results.length === 0) {
      results = await searchDuckDuckGo(query);
    }

    if (!results || results.length === 0) {
      return `Tidak ada hasil relevan yang ditemukan untuk pencarian: "${query}".`;
    }

    // Format output menjadi teks bersih dan padat (hemat token untuk LLM)
    return results
      .map((r, i) => {
        const title = r.title || "Tanpa Judul";
        const content = (r.content || "").substring(0, 300); // Potong panjang teks
        const url = r.url || "";
        return `[${i + 1}] ${title}\nRingkasan: ${content}\nSumber: ${url}`;
      })
      .join("\n\n");
  } catch (err) {
    console.error("Web Search Error:", err);
    return `Gagal mengambil data web untuk: "${query}".`;
  }
}