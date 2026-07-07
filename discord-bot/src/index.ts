import "dotenv/config";
import dns from "node:dns";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { handleInteraction } from "./interactions.js";
import { handleMessage } from "./messageHandler.js";

// Voice fix (2026-07-07): without this, @discordjs/voice's UDP handshake can
// resolve Discord's voice endpoint to an IPv6 address that the host network
// can't actually route, so the connection cycles forever between
// "signalling" and "connecting" and never reaches "ready" - confirmed on
// Aviv's machine via the connection-state logging in voice.ts (also throws
// a stray "TimeoutNegativeWarning" from @discordjs/voice's retry backoff,
// a symptom of the same underlying failure, not a separate bug). Forcing
// Node's DNS resolver to prefer IPv4 results is the standard fix for this -
// a well-documented issue across @discordjs/voice's user base, not specific
// to this bot's code.
dns.setDefaultResultOrder("ipv4first");

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
