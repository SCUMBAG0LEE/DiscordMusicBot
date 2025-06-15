# 🎶 Discord Music Bot

A powerful and feature-rich Discord music bot built with `discord.js`, `Distube`, and `Spotify Web API`. Enjoy high-quality audio playback, extensive control over your queue, and seamless integration with YouTube and Spotify.

---

## ✨ Features

* **Play Music:** Play songs, playlists, albums from YouTube and Spotify via URL or search query.
* **Interactive Search:** Search YouTube directly from Discord and select your desired track.
* **Queue Management:** View, clear, shuffle, remove, move, and jump to specific songs in the queue.
* **Playback Controls:** Pause, resume, stop, skip, loop, and adjust volume.
* **Vote Skip:** Allow users to vote to skip the current song.
* **Now Playing:** Display details about the currently playing song.
* **DJ Role Support:** Restrict certain commands to users with a specific DJ role.
* **Owner Commands:** Special commands for the bot owner, like refreshing global commands.
* **Spotify Integration:** Full support for Spotify tracks, playlists, and albums.

---

## 🚀 Getting Started

Follow these steps to get your Discord Music Bot up and running on your Linux server.

### 📋 Prerequisites

Before you begin, ensure you have the following installed:

* **Node.js (LTS version recommended):**
    ```bash
    sudo apt update
    sudo apt install nodejs npm
    ```
* **`ffmpeg`:** Essential for audio processing.
    ```bash
    sudo apt install ffmpeg
    ```
* **`libsodium-wrappers` (or `opus`):** Required for voice connections. The `package.json` already lists `libsodium-wrappers`.
    ```bash
    sudo apt install libsodium-dev # For Debian/Ubuntu
    # Or, if using opus:
    # sudo apt install libopus-dev
    ```

### 🔑 Obtaining Tokens and IDs

You'll need the following credentials:

1.  **Discord Bot Token:**
    * Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    * Create a new application or select an existing one.
    * Navigate to "Bot" on the left sidebar.
    * Click "Add Bot" and then "Yes, do it!".
    * Copy the token. **Keep this token private!**
    * Under "Privileged Gateway Intents," enable **MESSAGE CONTENT INTENT**.

2.  **Discord Bot Owner ID:**
    * In Discord, go to `User Settings` -> `Advanced` and enable `Developer Mode`.
    * Right-click on your user profile in Discord and select `Copy ID`.

3.  **Discord DJ Role ID (Optional):**
    * If you want to restrict certain commands to a "DJ" role, create a role in your Discord server named "DJ" (or whatever you prefer).
    * Right-click on the "DJ" role in your server settings and select `Copy ID`.

4.  **Spotify API Credentials (Client ID & Client Secret):**
    * Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications).
    * Log in and click "Create an App".
    * Fill in the details. The "Redirect URI" can be anything, as we're using the Client Credentials Flow (e.g., `http://localhost`).
    * Once created, you'll see your `Client ID` and `Client Secret`. Copy both.

### 📦 Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/SCUMBAG0LEE/DiscordMusicBot.git
    cd your-repo-name
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

### ⚙️ Configuration (.env file)

Create a file named `.env` in the root directory of your project (the same directory as `index.js` and `package.json`). Copy the following template into it and replace the placeholder values with your actual tokens and IDs.

```ini
# .env template

# Your Discord Bot Token (REQUIRED)
BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE

# Your Discord User ID (REQUIRED - for owner-only commands)
BOT_OWNER_ID=YOUR_DISCORD_USER_ID_HERE

# The ID of your DJ role (OPTIONAL - leave blank if not using)
# If set, commands like /skip will require this role unless you're the song requester.
DJ_ROLE_ID=YOUR_DISCORD_DJ_ROLE_ID_HERE

# Spotify API Credentials (REQUIRED for Spotify support)
SPOTIFY_CLIENT_ID=YOUR_SPOTIFY_CLIENT_ID_HERE
SPOTIFY_CLIENT_SECRET=YOUR_SPOTIFY_CLIENT_SECRET_HERE
