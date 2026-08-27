# mokachan (restrukturisasi)

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

1. Letakkan file `lyrics.js` kamu yang lama di root folder (sejajar dengan `index.js`).
   File itu tidak saya ubah/sertakan karena isi aslinya tidak ada di percakapan ini.
2. Update `.env` kamu (lihat `.env.example`):
   - `BOT_NAME=mokachan`
   - `COMMAND_PREFIX=m`
   - `COMMAND_CASE_INSENSITIVE=true`
   - Ganti `CMD_NYOMOXCHAN` (kalau ada di .env lama) menjadi `CMD_MOKACHAN`
3. Database lama (`nyomoxchan_history.db`) tidak otomatis terbawa. Bot baru akan
   membuat file `mokachan_history.db` yang kosong. Kalau mau pakai history lama,
   rename file `nyomoxchan_history.db` -> `mokachan_history.db` sebelum start,
   atau ubah nama file di `src/database.js` sesuai keinginan.
4. Jalankan seperti biasa: `node index.js`

## Bug yang sudah diperbaiki

- `aiCommand is not defined` (ReferenceError yang bikin bot crash tiap ada
  pesan masuk) — sekarang dideklarasikan sebelum dipakai di router.
- Command `lyrics` dulu case-sensitive sendiri (beda dari command lain).
  Sekarang semua command lewat `commandMatches()` yang sama, jadi
  prefix `m` / `M` konsisten di seluruh fitur.
