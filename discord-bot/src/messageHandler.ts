import { Message, PermissionsBitField, TextChannel } from "discord.js";
import { getCampaignIdForGuild, getCharacterByMask, getOwnedCharacterId, getCharacterSheetData } from "./db.js";
import { findRollTrigger, computeRoll } from "./rolls.js";

// ---------------------------------------------------------------------------
// The mask/proxy mechanic (Aviv's spec, 2026-07-06): [[mask]]: message in any
// watched channel gets deleted and reposted via a channel webhook under that
// character's name/portrait - same core trick as PluralKit. Every bot action,
// rolls included, is gated behind a mask; there is no bare-text trigger.
// ---------------------------------------------------------------------------

const MASK_PATTERN = /^\[\[([^\]]+)\]\]:\s*([\s\S]*)$/;
const WEBHOOK_NAME = "Erendyl Codex Masks";

const webhookCache = new Map<string, import("discord.js").Webhook>();

async function getChannelWebhook(channel: TextChannel) {
  const cached = webhookCache.get(channel.id);
  if (cached) return cached;
  const existing = await channel.fetchWebhooks();
  let webhook = existing.find((w) => w.name === WEBHOOK_NAME);
  if (!webhook) {
    webhook = await channel.createWebhook({ name: WEBHOOK_NAME });
  }
  webhookCache.set(channel.id, webhook);
  return webhook;
}

async function replyAndForget(message: Message, content: string) {
  try {
    const reply = await message.reply({ content, allowedMentions: { repliedUser: false } });
    setTimeout(() => reply.delete().catch(() => {}), 6000);
  } catch {
    // Missing permissions or message already gone - not worth surfacing further.
  }
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || message.webhookId) return;
  if (!message.guild || !message.member) return;
  const match = message.content.match(MASK_PATTERN);
  if (!match) return;

  const mask = match[1].trim();
  const spoken = match[2];

  const campaignId = await getCampaignIdForGuild(message.guild.id);
  if (!campaignId) {
    await replyAndForget(message, "This server isn't linked to a campaign yet - a DM needs to run /link first.");
    return;
  }

  const character = await getCharacterByMask(campaignId, mask);
  if (!character) {
    await replyAndForget(message, `No character has the mask **[[${mask}]]**.`);
    return;
  }

  const isDm = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  if (!isDm) {
    const ownedCharacterId = await getOwnedCharacterId(message.author.id, campaignId);
    if (ownedCharacterId !== character.id) {
      await replyAndForget(message, `You aren't linked to **${character.name}** - see /me/profile on the website.`);
      return;
    }
  }

  if (!(message.channel instanceof TextChannel)) {
    await replyAndForget(message, "Masks only work in regular text channels right now, not threads.");
    return;
  }

  try {
    const webhook = await getChannelWebhook(message.channel);
    await message.delete();
    await webhook.send({
      content: spoken || "*...*",
      username: character.name,
      avatarURL: character.portraitPath ?? undefined,
    });
  } catch (err) {
    console.error("[mask] proxy failed:", err);
    await replyAndForget(message, "I need Manage Messages and Manage Webhooks permissions in this channel to do that.");
    return;
  }

  const trigger = findRollTrigger(spoken);
  if (trigger) {
    const sheet = await getCharacterSheetData(character.id);
    const roll = computeRoll(sheet, trigger);
    await message.channel.send(
      `🎲 **${character.name}** — ${trigger.label} Check: **${roll.total}** (${roll.breakdown})`
    );
  }
}
