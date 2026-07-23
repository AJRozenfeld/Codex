import { AttachmentBuilder, Message, PermissionsBitField, TextChannel } from "discord.js";
import { getCampaignIdForGuild, getCharacterByMask, getOwnedCharacterId, getCharacterSheetData } from "./db.js";
import { findRollTrigger, computeRoll, computeInitiative } from "./rolls.js";
import { rememberRollChannel } from "./db.js";
import { getActiveBattle, recordRollAndRefresh } from "./battle.js";

// ---------------------------------------------------------------------------
// The mask/proxy mechanic (Aviv's spec, 2026-07-06): [[mask]]: message in any
// watched channel gets deleted and reposted via a channel webhook under that
// character's name/portrait - same core trick as PluralKit. Every bot action,
// rolls included, is gated behind a mask; there is no bare-text trigger.
// ---------------------------------------------------------------------------

const MASK_PATTERN = /^\[\[([^\]]+)\]\]:\s*([\s\S]*)$/;

// Multi-mask messages (2026-07-20, Aviv's spec): a mask marker at the START
// OF ANY LINE begins a new segment, so one Discord message can voice several
// characters - each segment is reposted as its own webhook message, in order:
//   [[NPC1]]: "Hello friends"
//   [[NPC2]]: "We've been waiting for you"
// The MESSAGE must still start with a mask (prose before the first mask means
// it isn't a mask message at all - unchanged trigger condition). A segment
// owns every following line until the next mask line, so multi-line speeches
// still work. Triggers (*roll x*, *init*, *introduction*) apply per segment.
const MASK_LINE_PATTERN = /^\[\[([^\]]+)\]\]:[ \t]*/;
const MAX_SEGMENTS = 10;

interface MaskSegment {
  mask: string;
  text: string;
}

export function parseMaskSegments(content: string): MaskSegment[] | null {
  const lines = content.split("\n");
  if (!MASK_LINE_PATTERN.test(lines[0] ?? "")) return null;
  const segments: MaskSegment[] = [];
  let current: MaskSegment | null = null;
  for (const line of lines) {
    const m = line.match(MASK_LINE_PATTERN);
    if (m) {
      if (current) segments.push(current);
      current = { mask: m[1].trim(), text: line.slice(m[0].length) };
    } else if (current) {
      current.text += "\n" + line;
    }
  }
  if (current) segments.push(current);
  return segments;
}

// Initiative (2026-07-06): a bare *init*/*initiative* trigger, deliberately
// separate from the generic *roll <ability/skill>* pattern in rolls.ts -
// see computeInitiative's doc comment for why this can't just be another
// ability alias. Checked BEFORE the generic roll trigger below so a message
// never double-fires as both.
const INIT_PATTERN = /\*init(?:iative)?\*/i;

// Introduction (2026-07-20): [[mask]]: *introduction* has the character
// introduce herself - her short bio posted under her name+portrait, with the
// portrait attached as a separate, full-screen/downloadable file beneath it.
// Anchored so it only fires when the message is JUST the introduction command
// (optionally *-wrapped), never when the word appears inside roleplay prose.
const INTRODUCTION_PATTERN = /^\*?\s*introduction\s*\*?$/i;
const WEBHOOK_NAME = "Erendyl Codex Masks";

/** A safe, extension-preserving filename for the portrait attachment. */
function portraitFileName(name: string, url: string): string {
  const base = name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "portrait";
  const m = url.split("?")[0].match(/\.(png|jpe?g|gif|webp|avif)$/i);
  const ext = m ? m[1].toLowerCase() : "png";
  return `${base}.${ext}`;
}

const webhookCache = new Map<string, import("discord.js").Webhook>();

// Roll bridge (2026-07-16): remember the last channel each guild's masks
// speak in, so website-initiated rolls (rollQueue.ts) land there. Cached so
// the guild_links UPDATE only fires when the channel actually changes.
const lastRollChannel = new Map<string, string>();
function trackRollChannel(guildId: string | null, channelId: string) {
  if (!guildId) return;
  if (lastRollChannel.get(guildId) === channelId) return;
  lastRollChannel.set(guildId, channelId);
  void rememberRollChannel(guildId, channelId).catch(() => {
    lastRollChannel.delete(guildId); // retry on the next message
  });
}

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
  const segments = parseMaskSegments(message.content);
  if (!segments || segments.length === 0) return;
  if (segments.length > MAX_SEGMENTS) {
    await replyAndForget(message, `That's a lot of voices - at most ${MAX_SEGMENTS} masks per message, please.`);
    return;
  }

  const campaignId = await getCampaignIdForGuild(message.guild.id);
  if (!campaignId) {
    await replyAndForget(message, "This server isn't linked to a campaign yet - a DM needs to run /link first.");
    return;
  }

  // Resolve and permission-check EVERY mask up front: a typo in the second
  // mask must not eat the whole message (nothing is deleted or posted until
  // every segment is valid).
  const charByMask = new Map<string, NonNullable<Awaited<ReturnType<typeof getCharacterByMask>>>>();
  const isDm = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  const ownedCharacterId = isDm ? null : await getOwnedCharacterId(message.author.id, campaignId);
  for (const seg of segments) {
    if (charByMask.has(seg.mask)) continue;
    const found = await getCharacterByMask(campaignId, seg.mask);
    if (!found) {
      await replyAndForget(message, `No character has the mask **[[${seg.mask}]]** - message left untouched.`);
      return;
    }
    if (!isDm && ownedCharacterId !== found.id) {
      await replyAndForget(message, `You aren't linked to **${found.name}** - see /me/profile on the website.`);
      return;
    }
    charByMask.set(seg.mask, found);
  }

  if (!(message.channel instanceof TextChannel)) {
    await replyAndForget(message, "Masks only work in regular text channels right now, not threads.");
    return;
  }

  let webhook;
  try {
    trackRollChannel(message.guildId, message.channel.id);
    webhook = await getChannelWebhook(message.channel);
    await message.delete();
  } catch (err) {
    console.error("[mask] proxy failed:", err);
    await replyAndForget(message, "I need Manage Messages and Manage Webhooks permissions in this channel to do that.");
    return;
  }

  // Post each segment in order, as its own webhook message under its own
  // character; triggers fire per segment so two NPCs can each roll from
  // their own line of the same message.
  for (const seg of segments) {
    const character = charByMask.get(seg.mask)!;
    const spoken = seg.text.replace(/\s+$/, "");

    try {
      // Introduction takes over this segment: bio as the character, portrait
      // attached as a clickable file beneath it.
      if (INTRODUCTION_PATTERN.test(spoken.trim())) {
        const bio = character.summary?.trim() || `*${character.name} offers no words about themselves.*`;
        const hasImage = !!character.portraitPath && /^https?:\/\//i.test(character.portraitPath);
        const files = hasImage
          ? [new AttachmentBuilder(character.portraitPath as string, { name: portraitFileName(character.name, character.portraitPath as string) })]
          : [];
        await webhook.send({
          content: bio.slice(0, 2000),
          username: character.name,
          avatarURL: character.portraitPath ?? undefined,
          files,
        });
        continue;
      }

      await webhook.send({
        content: spoken || "*...*",
        username: character.name,
        avatarURL: character.portraitPath ?? undefined,
      });
    } catch (err) {
      console.error("[mask] segment post failed:", err);
      continue; // one broken segment shouldn't silence the rest
    }

    if (INIT_PATTERN.test(spoken)) {
      const sheet = await getCharacterSheetData(character.id);
      const roll = computeInitiative(sheet);
      await message.channel.send(`🎲 **${character.name}** rolls Initiative: **${roll.total}** (${roll.breakdown})`);
      const battle = await getActiveBattle(message.guild.id);
      if (battle) {
        await recordRollAndRefresh(message.channel, battle, character.id, roll.total);
      }
      continue;
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
}
