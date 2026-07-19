import type { Client, Guild, TextChannel } from "discord.js";
import { ChannelType } from "discord.js";
import {
  fetchPendingRollRequests,
  resolveRollRequest,
  getRollDestination,
  getCharacterById,
  getCharacterSheetData,
} from "./db.js";
import { triggerForTarget, computeRoll, computeActionRoll, type ActionRollSpec } from "./rolls.js";

// ---------------------------------------------------------------------------
// The website -> Discord roll bridge (2026-07-16). The character sheet's d20
// buttons insert rows into roll_requests (see src/lib/roll-requests.ts on
// the website side); this worker polls the shared database every ~1.5s and
// performs each roll in the campaign's linked guild - the same computeRoll
// math a [[mask]]: *roll x* message uses, posted in the same format.
//
// Channel choice: guild_links.roll_channel_id, which messageHandler.ts
// keeps pointed at the last channel a mask message was processed in - rolls
// land wherever the table is actually talking. Fallbacks: the guild's
// system channel, then the first text channel the bot can send in.
//
// Requests older than 90s expire unprocessed (fetchPendingRollRequests does
// the sweep): if the bot was down, firing stale dice mid-conversation would
// only confuse the table.
// ---------------------------------------------------------------------------

const POLL_MS = 1500;

async function pickChannel(client: Client, guildId: string, preferredChannelId: string | null): Promise<TextChannel | null> {
  let guild: Guild;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch {
    return null;
  }
  if (preferredChannelId) {
    try {
      const ch = await guild.channels.fetch(preferredChannelId);
      if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
    } catch {
      // deleted channel or missing permission - fall through
    }
  }
  if (guild.systemChannel && guild.systemChannel.type === ChannelType.GuildText) {
    return guild.systemChannel;
  }
  const channels = await guild.channels.fetch();
  for (const ch of channels.values()) {
    if (ch && ch.type === ChannelType.GuildText) {
      const me = guild.members.me;
      if (!me || (ch as TextChannel).permissionsFor(me)?.has("SendMessages")) {
        return ch as TextChannel;
      }
    }
  }
  return null;
}

async function processOnce(client: Client): Promise<void> {
  const requests = await fetchPendingRollRequests(5);
  for (const req of requests) {
    try {
      const isSpell = req.rollTarget.startsWith("spell:");
      const trigger = isSpell ? null : triggerForTarget(req.rollTarget);
      if (!isSpell && !trigger) {
        await resolveRollRequest(req.id, "failed", `unknown target: ${req.rollTarget}`);
        continue;
      }
      const character = await getCharacterById(req.characterId);
      if (!character) {
        await resolveRollRequest(req.id, "failed", "character no longer exists");
        continue;
      }
      const destination = await getRollDestination(req.campaignId);
      if (!destination) {
        await resolveRollRequest(req.id, "failed", "campaign has no linked guild");
        continue;
      }
      const channel = await pickChannel(client, destination.guildId, destination.rollChannelId);
      if (!channel) {
        await resolveRollRequest(req.id, "failed", "no sendable channel in linked guild");
        continue;
      }
      const sheet = await getCharacterSheetData(req.characterId);
      if (isSpell) {
        // Action Creator v1 (2026-07-19): execute every roll the spell
        // defines, in order, as one message - "To Hit" then "Damage" etc.
        const spellId = req.rollTarget.slice("spell:".length);
        const spells = Array.isArray((sheet as Record<string, unknown> | null)?.spells)
          ? ((sheet as Record<string, unknown>).spells as Record<string, unknown>[])
          : [];
        const spell = spells.find((sp) => sp.id === spellId);
        if (!spell || !Array.isArray(spell.rolls) || spell.rolls.length === 0) {
          await resolveRollRequest(req.id, "failed", "spell or its rolls not found on saved sheet");
          continue;
        }
        const results = (spell.rolls as ActionRollSpec[]).map((spec) => computeActionRoll(sheet, spec));
        const parts = results.map((r) => `${r.label}: **${r.total}** (${r.breakdown})`).join(" · ");
        const spellName = typeof spell.name === "string" && spell.name ? spell.name : "a spell";
        await channel.send(`✨ **${character.name}** casts **${spellName}** — ${parts}`);
        await resolveRollRequest(req.id, "done");
        continue;
      }
      const roll = computeRoll(sheet, trigger!);
      // Same voice as a masked *roll x* message - the table shouldn't be
      // able to tell whether the die came from chat or the website sheet.
      await channel.send(
        `🎲 **${character.name}** — ${trigger!.label} Check: **${roll.total}** (${roll.breakdown})`
      );
      await resolveRollRequest(req.id, "done");
    } catch (err) {
      console.error(`roll request ${req.id} failed:`, err);
      try {
        await resolveRollRequest(req.id, "failed", err instanceof Error ? err.message : String(err));
      } catch {
        // resolution itself failed (transient db error) - the 90s expiry
        // sweep will clean the row up rather than letting it retry forever.
      }
    }
  }
}

export function startRollQueue(client: Client): void {
  let running = false;
  setInterval(async () => {
    if (running) return; // never overlap slow cycles
    running = true;
    try {
      await processOnce(client);
    } catch (err) {
      console.error("roll queue cycle failed:", err);
    } finally {
      running = false;
    }
  }, POLL_MS);
  console.log(`Roll queue started (every ${POLL_MS}ms).`);
}
