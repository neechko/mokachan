import axios from "axios";
import { EmbedBuilder } from "discord.js";

const LRCLIB_BASE = "https://lrclib.net/api";

/**
 * Cari lirik lagu di LRCLIB berdasarkan query bebas (judul / "judul - artis").
 * LRCLIB tidak butuh API key sama sekali, jadi tidak ada proses validasi token.
 */
async function searchLyrics(query) {
  const res = await axios.get(`${LRCLIB_BASE}/search`, {
    params: { q: query },
    timeout: 15000,
  });
  return Array.isArray(res.data) ? res.data : [];
}

function pickBestResult(results) {
  // Prioritaskan hasil yang punya lirik teks biasa (plainLyrics) dan bukan instrumental
  const withPlain = results.find(r => !r.instrumental && r.plainLyrics);
  if (withPlain) return withPlain;

  const withSynced = results.find(r => !r.instrumental && r.syncedLyrics);
  if (withSynced) return withSynced;

  return results[0] || null;
}

// Ubah lirik LRC (timestamp [00:12.34]) menjadi teks biasa
function syncedToPlain(synced) {
  return synced
    .split("\n")
    .map(line => line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {import("discord.js").Message} msg
 * @param {string} PREFIX
 * @param {string} command - nama command lyrics yang sedang aktif (dari COMMANDS.lyrics / env),
 *                            BUKAN di-hardcode, supaya CMD_LYRICS di .env benar-benar dipakai.
 * @param {string} [botName] - nama bot untuk branding footer embed.
 */
export async function handleLyricsCommand(msg, PREFIX, command, botName = "Nyomoxchan") {
  const content = msg.content.trim();
  const fullCommand = `${PREFIX}${command}`;
  const query = content.slice(fullCommand.length).trim();

  if (!query) return msg.reply(`❌ Tulis judul lagu setelah command ${fullCommand}`);

  const thinkingMsg = await msg.reply("⏳ Mencari lirik di LRCLIB...");

  try {
    const results = await searchLyrics(query);

    if (!results.length) {
      return thinkingMsg.edit("❌ Lagu tidak ditemukan di LRCLIB.");
    }

    const song = pickBestResult(results);
    if (!song) {
      return thinkingMsg.edit("❌ Lagu tidak ditemukan di LRCLIB.");
    }

    let lyrics = song.plainLyrics;
    if (!lyrics && song.syncedLyrics) {
      lyrics = syncedToPlain(song.syncedLyrics);
    }
    if (!lyrics) {
      lyrics = song.instrumental
        ? "🎼 Lagu ini instrumental, tidak ada lirik."
        : "❌ Lirik tidak tersedia untuk lagu ini.";
    }

    if (lyrics.length > 4000) lyrics = lyrics.slice(0, 4000) + "\n…(truncated)";

    const titleParts = [song.trackName, song.artistName].filter(Boolean);
    const title = titleParts.length ? titleParts.join(" - ") : query;

    const embed = new EmbedBuilder()
      .setTitle(`🎵 ${title}`)
      .setDescription(lyrics)
      .setColor(0xff00ff)
      .setFooter({ text: `Lyrics powered by LRCLIB • ${botName}` })
      .setTimestamp();

    if (song.albumName) embed.addFields({ name: "Album", value: song.albumName, inline: true });
    if (song.duration) {
      const mins = Math.floor(song.duration / 60);
      const secs = Math.floor(song.duration % 60).toString().padStart(2, "0");
      embed.addFields({ name: "Durasi", value: `${mins}:${secs}`, inline: true });
    }

    return thinkingMsg.edit({ content: null, embeds: [embed] });
  } catch (err) {
    console.error("❌ Error fetch LRCLIB:", err.response?.status, err.message);
    return thinkingMsg.edit(`❌ Error fetch LRCLIB: ${err.response?.status || err.message}`);
  }
}