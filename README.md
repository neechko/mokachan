# mokachan

```install guide on hosting
Put github file on file manager server 
cd folder 
pwd
rm -rf node_modules package-lock.json
npm install
node index.js
```

## Struktur folder

```
index.js                     -> entry point: setup client, ready event, router pesan
lyrics.js                    -> COPY FILE LAMA KAMU KE SINI (tidak diubah, tidak disertakan di sini)
src/
  config.js                  -> semua env var, konstanta, nama command
  commandMatcher.js          -> logika pencocokan prefix (case-insensitive)
  database.js                -> semua akses SQLite (history + model_usage)
  gemini.js                  -> pemanggilan API Gemini + retry
  commands/
    ai.js                    -> fitur "?nyomoxchan" versi baru ("mmokachan")
    history.js                -> fitur "history"
    clearHistory.js           -> fitur "clearhistory"
    stats.js                  -> fitur "stats"
    help.js                    -> fitur "help"
    ping.js                    -> fitur "ping"
```

## PENTING sebelum menjalankan

1. Update `.env` kamu (lihat `.env.example`):
   - `GEMINI_MODELS="model1,model2,model3,dan seterusnya"`
   - `BOT_NAME=mokachan`
   - `COMMAND_PREFIX=m`
   - `COMMAND_CASE_INSENSITIVE=true`
   - Ganti `CMD_NYOMOXCHAN` (kalau ada di .env lama) menjadi `CMD_MOKACHAN`
3. Database lama (`nyomoxchan_history.db`) tidak otomatis terbawa. Bot baru akan
   membuat file `mokachan_history.db` yang kosong. Kalau mau pakai history lama,
   rename file `nyomoxchan_history.db` -> `mokachan_history.db` sebelum start,
   atau ubah nama file di `src/database.js` sesuai keinginan.
4. Jalankan seperti biasa: `node index.js`
