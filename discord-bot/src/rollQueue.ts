import type { Client, Guild, TextChannel } from "discord.js";
import { ChannelType, EmbedBuilder } from "discord.js";
import {
  fetchPendingRollRequests,
  resolveRollRequest,
  getRollDestination,
  getCharacterById,
  getCharacterSheetData,
} from "./db.js";
import { triggerForTarget, computeRoll, computeActionRoll, computeSavingThrow, computeInitiativeFromSheet, type ActionRollSpec } from "./rolls.js";

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
      const isAttack = req.rollTarget.startsWith("attack:");
      const isCustom = req.rollTarget.startsWith("custom:");
      const isAction = isSpell || isAttack || isCustom;
      const isSave = req.rollTarget.startsWith("save:");
      const isInit = req.rollTarget === "initiative";
      const trigger = isAction || isSave || isInit ? null : triggerForTarget(req.rollTarget);
      if (!isAction && !isSave && !isInit && !trigger) {
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
      if (isSave) {
        const ability = req.rollTarget.slice("save:".length);
        const roll = computeSavingThrow(sheet, ability);
        const label = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" }[ability] ?? ability;
        await channel.send(`🛡️ **${character.name}** — ${label} Save: **${roll.total}** (${roll.breakdown})`);
        await resolveRollRequest(req.id, "done");
        continue;
      }
      if (isInit) {
        const roll = computeInitiativeFromSheet(sheet);
        await channel.send(`⚡ **${character.name}** — Initiative: **${roll.total}** (${roll.breakdown})`);
        await resolveRollRequest(req.id, "done");
        continue;
      }
      if (isAction) {
        // Action Creator (2026-07-19/20): execute every roll the spell,
        // weapon, or custom action defines, in order, as one themed card.
        const key = isSpell ? "spells" : isAttack ? "attacks" : "customActions";
        const prefixLen = (isSpell ? "spell:" : isAttack ? "attack:" : "custom:").length;
        const entryId = req.rollTarget.slice(prefixLen);
        const entries = Array.isArray((sheet as Record<string, unknown> | null)?.[key])
          ? ((sheet as Record<string, unknown>)[key] as Record<string, unknown>[])
          : [];
        const entry = entries.find((e) => e.id === entryId);
        const noun = isSpell ? "spell" : isAttack ? "weapon" : "action";
        if (!entry || !Array.isArray(entry.rolls) || entry.rolls.length === 0) {
          await resolveRollRequest(req.id, "failed", `${noun} or its rolls not found on saved sheet`);
          continue;
        }
        const results = (entry.rolls as ActionRollSpec[]).map((spec) => computeActionRoll(sheet, spec));
        const entryName = typeof entry.name === "string" && entry.name ? entry.name : `a ${noun}`;
        const description = typeof entry.description === "string" ? entry.description.trim() : "";
        // Spell = gold ✨, weapon = ember ⚔️, custom = green ✦.
        const color = isSpell ? 0xdab962 : isAttack ? 0xc97b4a : 0x6da56d;
        const icon = isSpell ? "✨" : isAttack ? "⚔️" : "✦";
        const verb = isSpell ? "casts..." : isAttack ? "attacks with..." : "uses...";
        const embed = new EmbedBuilder()
          .setColor(color)
          .setAuthor({
            name: `${character.name} ${verb}`,
            ...(character.portraitPath ? { iconURL: character.portraitPath } : {}),
          })
          .setTitle(`${icon} ${entryName}`)
          .addFields(
            results.map((r) => ({
              name: `🎲 ${r.label}`,
              value: `**${r.total}**\n${r.breakdown}`.slice(0, 1024),
              inline: true,
            }))
          );
        if (isSpell) {
          const level = typeof entry.level === "number" ? entry.level : 0;
          embed.setFooter({ text: level > 0 ? `Level ${level} spell` : "Cantrip" });
        } else if (isAttack) {
          embed.setFooter({ text: "Weapon attack" });
        } else {
          embed.setFooter({ text: "Action" });
        }
        if (description) embed.setDescription(`*${description.slice(0, 350)}${description.length > 350 ? "…" : ""}*`);
        await channel.send({ embeds: [embed] });
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
