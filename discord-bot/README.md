# Erendyl Codex Discord Bot

Standalone companion to the Codex website - masks (speak/act as any NPC or your own PC), inline dice rolls, a `/panel` menu into your NPCs/locations/music library, and music playback. See `project_erendyl_discord_bot` design notes for the full spec; this file is just the "how do I actually run it" instructions.

## Why this isn't part of the Next.js app

Discord bots hold a persistent, always-open connection to Discord (the "gateway"). Vercel runs the website as short-lived, per-request serverless functions and can't host that kind of long-running process - so this lives here as its own small Node app, talking to the **same Turso database** as the website. No syncing: a mask set on `/me/profile` or an NPC's admin page is visible to the bot immediately, and a music track uploaded from `/admin/music` is playable immediately.

## One-time setup

1. **Create the Discord Application.** Go to https://discord.com/developers/applications → New Application. Under the **Bot** tab, click "Reset Token" to get your bot token (keep it secret - treat it like a password). Under **General Information**, copy the **Application ID** (this is your `DISCORD_CLIENT_ID`).

2. **Turn on the Message Content intent.** Still on the **Bot** tab, enable "Message Content Intent" under Privileged Gateway Intents - the mask mechanic needs to read ordinary message text, not just slash commands.

3. **Invite the bot to your server.** Under **OAuth2 → URL Generator**, check the `bot` and `applications.commands` scopes, then under Bot Permissions check at least: View Channels, Send Messages, Manage Messages (needed to delete the original `[[mask]]:` message), Manage Webhooks (needed to post as a character), Connect, Speak (needed for music). Open the generated URL and add the bot to your server.

4. **Copy `.env.example` to `.env`** and fill in:
   - `DATABASE_URL` / `DATABASE_AUTH_TOKEN` - the exact same values you set on the website's Vercel project (Turso connection).
   - `DISCORD_BOT_TOKEN` / `DISCORD_CLIENT_ID` - from steps 1-2 above.

5. **Install and register commands** (from this `discord-bot/` folder):
   ```
   npm install
   npm run register-commands
   ```
   Slash commands are registered globally and can take up to an hour to first appear - re-run this only when a command definition changes.

6. **Run it:**
   - Locally, for testing: `npm run dev`
   - In production, it needs an **always-on host** (Vercel can't run this) - Railway, Fly.io, or any small always-on VPS all work. Point its start command at `npm run build && npm start`, and set the same four env vars there.

7. **Link the server to your campaign.** On the website, go to `/admin/discord` and click "Generate Server Link Code", then in your Discord server (as an admin) run `/link code:XXXXXX`.

## Using it

- Set a mask for any NPC from its admin edit page, or for your own PC from `/me/profile` (players must also link their Discord account there first).
- In the linked server: `[[mask]]: some message` deletes your message and reposts it as that character.
- Add `*roll strength*` (or any ability/skill name) anywhere inside a masked message to roll using that character's sheet - it posts as a separate bot message so it can't be faked.
- `/panel npcs`, `/panel locations`, `/panel music` browse the library right in Discord (visible only to you).
- `/panel music` asks Track or Playlist first. A playlist (create/edit under `/admin/playlists` on the website) then asks In Order or Shuffle, and the bot plays every track in it back-to-back, automatically advancing to the next one when each finishes.
- `/stopmusic` stops whatever's currently playing (single track or playlist).

## Initiative tracker / battle mode

- The DM runs `/startbattle` to open a fight. If the DM is in a voice channel, the bot picks a random track tagged `battle` (see below) and starts it; either way, an initiative tracker embed appears in the channel and stays pinned to the latest state.
- Players roll for initiative the same way they trigger any other roll - inside a masked message: `[[YourMask]]: *init*` (or `*initiative*`). Each roll (d20 + Dex modifier) posts as its own message and adds that character to the tracker, sorted highest-to-lowest; rolling again updates your existing entry instead of adding a duplicate. Late arrivals can roll mid-fight and slot into the current round automatically.
- The DM runs `/next` to advance to the next character in turn order, wrapping around (and incrementing the round number) after the last one.
- The DM runs `/endbattle` to close the fight: the tracker message is deleted, and whatever track was playing before `/startbattle` resumes from the top (not mid-song - restarting the previous track, not truly "unpausing" it).
- **Battle music convention:** tag any track with the word `battle` anywhere in its Tags field (from `/admin/music` on the website) to make it eligible for random selection at `/startbattle`. No separate "battle music" flag - just reuses the existing free-text Tags field.
- All three commands are DM-only (Manage Server permission), same as every other admin-style bot action.
