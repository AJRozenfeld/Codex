import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

// ---------------------------------------------------------------------------
// Run once (`npm run register-commands`) after setting DISCORD_BOT_TOKEN and
// DISCORD_CLIENT_ID in .env, and again any time a command definition below
// changes. Registered globally, so it can take up to an hour to propagate to
// every server the bot is in the first time - Discord's own limitation, not
// something to work around.
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Redeem a pairing code from the Codex website")
    .addStringOption((opt) => opt.setName("code").setDescription("The code shown on the website").setRequired(true)),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Browse this campaign's Codex library")
    .addSubcommand((sub) => sub.setName("npcs").setDescription("Browse NPCs by faction"))
    .addSubcommand((sub) => sub.setName("locations").setDescription("Browse locations"))
    .addSubcommand((sub) => sub.setName("music").setDescription("Browse and play music tracks"))
    .addSubcommand((sub) => sub.setName("scenes").setDescription("Activate a scene: starts a battle + music (DM only)")),
  new SlashCommandBuilder().setName("stopmusic").setDescription("Stop the current music track"),
  new SlashCommandBuilder()
    .setName("startbattle")
    .setDescription("Start a battle: prompts for initiative rolls and starts battle music (DM only)"),
  new SlashCommandBuilder()
    .setName("next")
    .setDescription("Advance to the next turn in the initiative order (DM only)"),
  new SlashCommandBuilder()
    .setName("endbattle")
    .setDescription("End the current battle, restore the previous music, and remove the tracker (DM only)"),
].map((c) => c.toJSON());

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set in .env");
  }
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Registered ${commands.length} commands.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
