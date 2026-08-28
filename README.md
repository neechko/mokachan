<p align="center">
  <img src="assets/moka-chan.webp" alt="Mokachan" width="360">
</p>

<h1 align="center">Mokachan</h1>

<p align="center">
Bot Discord dengan AI companion berbasis Gemini dan sistem claim karakter anime otomatis dari AniList.
</p>

---

## Daftar Isi

- [Tentang](#tentang)
- [Fitur](#fitur)
  - [Companion AI (Hemat Token)](#companion-ai-hemat-token)
  - [Claim Karakter Anime](#claim-karakter-anime)
  - [Lirik Lagu (LRCLIB)](#lirik-lagu-lrclib)
- [Struktur Folder](#struktur-folder)
- [Instalasi](#instalasi)
- [Konfigurasi](#konfigurasi)
- [Menjalankan Bot](#menjalankan-bot)
- [Migrasi dari Versi Sebelumnya](#migrasi-dari-versi-sebelumnya)
- [Daftar Perintah](#daftar-perintah)
- [Catatan Jaringan](#catatan-jaringan)

## Tentang

Mokachan adalah bot Discord yang menggabungkan dua fitur utama: percakapan AI dengan memori jangka panjang (companion), dan sistem claim karakter anime otomatis yang terinspirasi dari Rimi-chan. Seluruh data disimpan dalam satu database SQLite yang sama, dan tabel baru dibuat secara otomatis saat bot pertama kali dijalankan sehingga tidak diperlukan migrasi manual.

## Fitur

### Companion AI (Hemat Token)

Versi sebelumnya mengirim ulang lima pasang tanya-jawab mentah ke Gemini pada setiap chat, sehingga payload membesar seiring panjangnya percakapan. Pada versi ini, fitur AI memakai pendekatan rolling summary dan memory facts:

- Setiap permintaan hanya membawa: system persona, satu ringkasan singkat, beberapa fakta pendek tentang pengguna, satu giliran percakapan terakhir, dan prompt baru.
- Ringkasan dan fakta dibuat ulang secara otomatis oleh AI setiap `SUMMARY_EVERY_N_TURNS` giliran (default 6), melalui satu panggilan Gemini berukuran kecil, bukan pada setiap pesan.
- Terdapat poin kedekatan (affection) yang bertambah pada setiap chat dan memengaruhi gaya bicara AI. Gunakan `mprofil` untuk melihat kedekatan, dan `mresetcompanion` untuk mengatur ulang memori companion.

### Claim Karakter Anime

- Selama sebuah channel aktif digunakan untuk chat, karakter acak dari AniList API (data asli anime/game beserta gambarnya) akan muncul secara otomatis setiap `CHARACTER_SPAWN_INTERVAL_MS` (default 20 menit).
- Siapa pun yang tercepat mengetik `mclaim` akan mendapatkan karakter tersebut.
- Jika tidak ada yang mengklaim dalam `CHARACTER_SPAWN_TIMEOUT_MS` (default 10 menit), spawn tersebut hangus dan channel dapat menerima spawn baru.
- Rarity dihitung otomatis berdasarkan jumlah favorit karakter di AniList (Common / Rare / Epic / Legendary).
- Gunakan `mkoleksi` untuk melihat karakter yang sudah dimiliki.

### Lirik Lagu (LRCLIB)

- Perintah `mlyrics <judul lagu> <artis>` mengambil lirik lagu dari LRCLIB (API publik, tanpa API key) dan menampilkannya langsung di Discord.
- Fitur ini ditangani oleh `lyrics.js` pada root project (berkas lama, tidak diubah pada update ini).

## Struktur Folder

```
index.js                    entry point: setup client, ready event, router pesan
lyrics.js                   file lama (tidak diubah, tidak disertakan di sini)

src/
├── config.js                semua env var, konstanta, nama command
├── commandMatcher.js        logika pencocokan prefix (case-insensitive)
├── database.js              semua akses SQLite (history, companion, spawn, model_usage)
├── gemini.js                pemanggilan API Gemini beserta retry
├── companion.js             AI companion: rolling summary + memory facts
├── anilist.js               integrasi AniList API untuk fitur claim karakter
├── characterSpawn.js        logika spawn karakter otomatis per channel
└── commands/
    ├── ai.js                 fitur chat AI ("mokachan"), memakai companion memory
    ├── history.js            fitur history (log mentah, untuk ditinjau manual)
    ├── clearHistory.js       fitur clearhistory
    ├── stats.js              fitur stats
    ├── help.js               fitur help
    ├── ping.js               fitur ping
    ├── profil.js             fitur profil (melihat kedekatan companion)
    ├── resetCompanion.js     fitur resetcompanion (reset memori companion)
    ├── claim.js              fitur claim (klaim karakter yang sedang spawn)
    └── koleksi.js            fitur koleksi (melihat karakter yang sudah dimiliki)
```

## Instalasi

1. Unggah berkas dari GitHub ke file manager server.
2. Masuk ke folder project.
   ```
   cd nama-folder
   ```
3. Hapus dependensi lama.
   ```
   rm -rf node_modules package-lock.json
   ```
4. Pasang ulang dependensi.
   ```
   npm install
   ```
5. Jalankan bot.
   ```
   node index.js
   ```

## Konfigurasi

Perbarui berkas `.env` sesuai `.env.example` sebelum menjalankan bot.

**Variabel wajib**

| Variabel | Keterangan |
|---|---|
| `GEMINI_MODELS` | Daftar model Gemini dipisah koma, digunakan sebagai urutan fallback, contoh: `model1,model2,model3` |
| `BOT_NAME` | Nama bot, contoh: `mokachan` |
| `COMMAND_PREFIX` | Prefix command, contoh: `m` |
| `COMMAND_CASE_INSENSITIVE` | Pencocokan command tanpa memandang huruf besar/kecil, contoh: `true` |

Jika pada `.env` versi lama masih terdapat `CMD_NYOMOXCHAN`, ganti namanya menjadi `CMD_MOKACHAN`.

**Variabel opsional**

Variabel berikut sudah memiliki nilai default, lihat `.env.example` untuk detailnya:

`SUMMARY_EVERY_N_TURNS`, `MAX_FACTS`, `AFFECTION_PER_TURN`, `CHARACTER_SPAWN_INTERVAL_MS`, `CHARACTER_SPAWN_TIMEOUT_MS`, `CMD_CLAIM`, `CMD_KOLEKSI`, `CMD_PROFIL`, `CMD_RESETCOMPANION`

## Menjalankan Bot

```
node index.js
```

## Migrasi dari Versi Sebelumnya

- Database lama (`nyomoxchan_history.db`) tidak otomatis terbawa. Bot baru akan membuat file `mokachan_history.db` yang kosong.
- Untuk tetap memakai history lama, ganti nama berkas `nyomoxchan_history.db` menjadi `mokachan_history.db` sebelum menjalankan bot, atau sesuaikan nama berkas pada `src/database.js`.
- Seluruh data baru (companion memory, spawn aktif, koleksi karakter) tersimpan pada database SQLite yang sama; tabel baru dibuat otomatis saat bot pertama kali start.

## Daftar Perintah

Tabel berikut mengasumsikan `COMMAND_PREFIX=m` (dapat berbeda sesuai konfigurasi `.env`).

| Perintah | Fungsi |
|---|---|
| `mokachan` | Mengobrol dengan AI companion |
| `mhistory` | Melihat log riwayat chat mentah |
| `mclearhistory` | Menghapus riwayat chat |
| `mstats` | Melihat statistik penggunaan |
| `mhelp` | Menampilkan daftar bantuan |
| `mping` | Memeriksa status/latensi bot |
| `mprofil` | Melihat kedekatan companion |
| `mresetcompanion` | Mengatur ulang memori companion |
| `mclaim` | Mengklaim karakter yang sedang spawn |
| `mkoleksi` | Melihat karakter yang sudah dimiliki |
| `mlyrics <judul lagu> <artis>` | Menampilkan lirik lagu dari LRCLIB |

## Catatan Jaringan

Bot ini memanggil dua API publik yang tidak memerlukan API key. Pastikan server hosting memiliki akses internet keluar (outbound) ke kedua domain berikut:

| Fitur | Endpoint |
|---|---|
| Claim karakter anime | `https://graphql.anilist.co` |
| Lirik lagu | `https://lrclib.net` |