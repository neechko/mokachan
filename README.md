<p align="center">
  <img src="assets/moka-chan.webp" alt="Mokachan" width="360">
</p>

<h1 align="center">Mokachan (^▽^)</h1>

<p align="center">
A Discord bot featuring an AI companion with persistent memory, and an automatic anime character claiming system powered by the AniList API. Data is persisted via Neon PostgreSQL.
</p>

---

## Table of Contents

- [About](#about)
- [Features](#features)
  - [Companion AI & Relationship System](#companion-ai--relationship-system)
  - [Anime Character Claiming](#anime-character-claiming)
  - [Song Lyrics (LRCLIB)](#song-lyrics-lrclib)
- [Folder Structure](#folder-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Database Migration](#database-migration)
- [Command List](#command-list)
- [Network Requirements](#network-requirements)
- [Troubleshooting](#troubleshooting)

## About

Mokachan is a Discord bot that combines long-term AI conversation capabilities with an automated anime character claiming mechanic. All persistent data, including user memory, chat history, and character collections, is stored in a Neon PostgreSQL database, ensuring data persistence and reliability across hosting environments.

## Features

### Companion AI & Relationship System

The AI utilizes a token-efficient, rolling-summary architecture to maintain long-term context without exceeding token limits. Instead of sending raw chat history, the bot maintains a concise summary, key user facts, and the most recent conversational turn.

Additionally, it features a structured Relationship Progression system:
- **XP and Leveling:** Users earn Relationship XP through meaningful interactions. The progression curve is quadratic, requiring increased effort for higher levels.
- **Relationship Stages:** The AI adapts its tone and persona based on 8 distinct relationship stages (e.g., Stranger, Acquaintance, Close Friend, Kindred Spirit).
- **Hidden Traits:** Tracks Trust, Comfort, and Familiarity. These traits are capped by the user's current level to prevent premature intimacy and ensure organic relationship development.
- **Anti-Spam Measures:** Implements daily XP caps, minimum time gaps between XP gains, and diminishing returns to prevent exploitation.
- **Personalization:** Users can set a custom nickname, which the AI will actively use in responses.

### Anime Character Claiming

- Characters from the AniList API automatically spawn in active channels at configurable intervals.
- The first user to type the claim command receives the character.
- Unclaimed characters expire after a configurable timeout, allowing a new spawn cycle.
- Character rarity (Common, Rare, Epic, Legendary) is dynamically calculated based on the character's favorite count on AniList.

### Song Lyrics (LRCLIB)

- Fetches synchronized or plain text lyrics from the LRCLIB public API (no API key required) and formats them for Discord display.

## Folder Structure

```text
index.js                    # Entry point: client setup, event listeners, message router
lyrics.js                   # LRCLIB integration (legacy, unchanged)

src/
├── config.js                # Environment variables, constants, and command mappings
├── commandMatcher.js        # Prefix matching logic (case-insensitive support)
├── database.js              # Neon PostgreSQL connection and query handlers
├── gemini.js                # AI API calls with retry and fallback logic
├── relationship.js          # XP calculation, level progression, and trait capping logic
├── companion.js             # AI companion: prompt building, rolling summary, and memory management
├── anilist.js               # AniList GraphQL API integration
├── characterSpawn.js        # Automated character spawn timing and state management
└── commands/
    ├── ai.js                # Main AI chat command
    ├── history.js           # Raw chat history retrieval
    ├── clearHistory.js      # User history deletion
    ├── stats.js             # Model usage statistics
    ├── help.js              # Command documentation
    ├── ping.js              # Latency check
    ├── profil.js            # Relationship profile and memory display
    ├── setNickname.js       # Custom nickname assignment
    ├── resetCompanion.js    # Companion memory reset
    ├── claim.js             # Character claiming logic
    └── koleksi.js           # User character collection display

scripts/
├── migrate-to-neon.mjs            # SQLite to Neon data migration script
├── upgrade-relationship.mjs       # Schema update for relationship XP system
└── fix-relationship-inflation.mjs # Legacy data adjustment script
```

## Installation

1. Clone or download the repository to your server.
2. Navigate to the project directory:
   ```bash
   cd mokachan
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy the example environment file and configure it:
   ```bash
   cp .env.example .env
   # Edit .env with your preferred text editor
   ```

## Configuration

The bot is configured entirely via the `.env` file. 

**Required Variables**

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token. |
| `DATABASE_URL` | Neon PostgreSQL connection string (must include `?sslmode=require`). |
| `AI_API_KEY` | API key for your chosen AI provider. |
| `AI_ENDPOINT` | The API endpoint URL for your chosen AI provider. |
| `AI_MODELS` | Comma-separated list of models to attempt, in fallback order. |

**Relationship System Variables (Optional)**

| Variable | Default | Description |
|---|---|---|
| `REL_XP_BASE` | `4` | Base XP awarded per meaningful interaction. |
| `REL_XP_DAILY_CAP` | `60` | Maximum XP a user can earn in a 24-hour period. |
| `REL_MAX_LEVEL` | `30` | Maximum achievable relationship level. |
| `REL_PASSIVE_XP` | `1` | XP awarded for passive background chat learning. |
| `REL_MIN_GAP_SECONDS`| `90` | Minimum time required between messages to earn XP. |
| `REL_XP_CURVE` | `100` | Coefficient for the quadratic XP progression curve. |

**Other Optional Variables**

`BOT_NAME`, `COMMAND_PREFIX`, `SUMMARY_EVERY_N_TURNS`, `MAX_FACTS`, `CHARACTER_SPAWN_INTERVAL_MS`, `CHARACTER_SPAWN_TIMEOUT_MS`, and command name overrides (e.g., `CMD_CLAIM`). Refer to `.env.example` for details.

## Running the Bot

```bash
node index.js
```

## Database Migration

If migrating from a previous SQLite-based version of this bot:
1. Ensure your Neon PostgreSQL database is created and the `DATABASE_URL` is set in `.env`.
2. Run the provided migration scripts in sequence to transfer data and update the schema:
   ```bash
   node scripts/migrate-to-neon.mjs ./path/to/old/mokachan_history.db
   node scripts/upgrade-relationship.mjs
   node scripts/fix-relationship-inflation.mjs
   ```
3. The bot will automatically create any missing tables or columns on startup.

## Command List

Assuming `COMMAND_PREFIX=m`:

| Command | Function |
|---|---|
| `mmokachan <prompt>` | Chat with the AI companion. |
| `mprofil [@user]` | View relationship level, XP progress, traits, and remembered facts. |
| `msetnickname <name>` | Set a custom nickname for the AI to use. Use `reset` or `clear` to remove. |
| `mresetcompanion` | Wipe all companion memory and relationship data for the user. |
| `mhistory` | View recent raw chat history logs. |
| `mclearhistory` | Delete the user's chat history logs. |
| `mclaim` | Claim the currently spawned anime character in the channel. |
| `mkoleksi` | View the user's owned character collection. |
| `mstats` | View AI model usage and success rates. |
| `mlyrics <title> <artist>`| Fetch and display song lyrics via LRCLIB. |
| `mping` | Check bot latency and database connection status. |
| `mhelp` | Display available commands. |

## Network Requirements

Ensure your hosting environment allows outbound HTTPS traffic to the following domains:

| Feature | Endpoint |
|---|---|
| Database | `*.aws.neon.tech` (Port 5432 or 6543) |
| AI Provider | Configured via `AI_ENDPOINT` (e.g., `api.openai.com`, `integrate.api.nvidia.com`) |
| Character Data | `graphql.anilist.co` |
| Lyrics Data | `lrclib.net` |

## Troubleshooting

### `CONNECT_TIMEOUT` on Neon PostgreSQL
If the bot fails to start with a `CONNECT_TIMEOUT` error on hosting platforms:
1. Ensure your `DATABASE_URL` uses the correct port (default is fine, or `:6543` for transaction pooler).
2. Verify `connect_timeout` is set to at least `30` in `src/database.js` to allow the serverless database time to wake up from sleep mode.
3. Wake up the database manually by running `SELECT 1;` in the Neon SQL Editor, then immediately restart the bot.

### Bot does not respond to commands
1. Verify the `COMMAND_PREFIX` in `.env` matches what you are typing.
2. Ensure the bot has `Read Messages` and `Send Messages` permissions in the target channel.
3. Confirm `GatewayIntentBits.MessageContent` is enabled in `index.js` and the "Message Content Intent" is toggled on in the Discord Developer Portal.
```