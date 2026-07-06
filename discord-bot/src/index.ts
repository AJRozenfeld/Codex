import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { handleInteraction } from "./interactions.js";
import { handleMessage } from "./messageHandler.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is not set - see .env.example");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once("ready", (c) => {
  console.log(`Erendyl Codex bot logged in as ${c.user.tag}`);
});

client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction);
});

client.on("messageCreate", (message) => {
  void handleMessage(message).catch((err) => console.error("[messageCreate] unhandled:", err));
});

client.login(token);
