import { EmbedBuilder, type Client } from "discord.js";
import {
  fetchDigestableRevealEvents,
  campaignHasFresherPending,
  markRevealEvents,
  listNotifiablePlayers,
  listEntityAccessPlayerIds,
  type RevealEvent,
} from "./db.js";

// ---------------------------------------------------------------------------
// Reveal-notification digests (Discord config suite, 2026-08-06). SQL
// triggers on the website's content tables (see db/schema.sql) queue a
// reveal_events row whenever an entity's `revealed` flips on in a campaign
// that opted in (discord_settings.notify_reveals - OFF by default). This
// worker polls that queue, waits for the reveal session to go quiet
// (DIGEST_WINDOW), then sends each linked player ONE tidy DM listing what
// just became visible to them - never one message per entity.
//
// Per-player filtering mirrors the website's visibility rule: an entity
// with entity_player_access rows is only announced to those players;
// everything else goes to every linked player of the campaign.
// ---------------------------------------------------------------------------

const POLL_MS = 20_000;
/** A digest sends once the newest pending event in its campaign is at least this old. */
const DIGEST_WINDOW_SECONDS = 120;
const MAX_LISTED = 12;

const TYPE_LABELS: Record<string, string> = {
  regions: "Region",
  locations: "Location",
  characters: "Character",
  factions: "Faction",
  storylines: "Storyline",
  artifacts: "Artifact",
  timeline_events: "Timeline event",
  maps: "Map",
  sections: "Page",
};

function digestEmbed(events: { title: string; entityType: string }[]): EmbedBuilder {
  const lines = events
    .slice(0, MAX_LISTED)
    .map((e) => `• **${e.title}** — ${TYPE_LABELS[e.entityType] ?? e.entityType}`);
  if (events.length > MAX_LISTED) lines.push(`…and ${events.length - MAX_LISTED} more.`);
  return new EmbedBuilder()
    .setColor(0xdab962)
    .setTitle(events.length === 1 ? "The Codex has grown" : `The Codex has grown: ${events.length} new entries`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Newly revealed on your campaign's Codex - log in to read." });
}

async function processOnce(client: Client): Promise<void> {
  const events = await fetchDigestableRevealEvents(DIGEST_WINDOW_SECONDS);
  if (events.length === 0) return;

  const byCampaign = new Map<string, RevealEvent[]>();
  for (const ev of events) {
    const arr = byCampaign.get(ev.campaignId) ?? [];
    arr.push(ev);
    byCampaign.set(ev.campaignId, arr);
  }

  for (const [campaignId, campaignEvents] of byCampaign) {
    try {
      // Mid-spree? Let the whole session settle into one digest.
      if (await campaignHasFresherPending(campaignId, DIGEST_WINDOW_SECONDS)) continue;

      const players = await listNotifiablePlayers(campaignId);
      if (players.length === 0) {
        await markRevealEvents(campaignEvents.map((e) => e.id), "skipped");
        continue;
      }

      // Restricted entities go only to their granted players.
      const accessByEvent = new Map<string, string[]>();
      for (const ev of campaignEvents) {
        accessByEvent.set(ev.id, await listEntityAccessPlayerIds(ev.entityType, ev.entityId));
      }

      for (const player of players) {
        const visible = campaignEvents.filter((ev) => {
          const access = accessByEvent.get(ev.id) ?? [];
          return access.length === 0 || access.includes(player.playerId);
        });
        if (visible.length === 0) continue;
        try {
          const user = await client.users.fetch(player.discordUserId);
          await user.send({ embeds: [digestEmbed(visible)] });
        } catch (err) {
          // Closed DMs / left the server - never fatal, never retried in a
          // loop: the events still get marked done below.
          console.error(`[notify] DM to ${player.displayName} failed:`, err);
        }
      }

      await markRevealEvents(campaignEvents.map((e) => e.id), "done");
    } catch (err) {
      console.error(`[notify] digest for campaign ${campaignId} failed:`, err);
    }
  }
}

export function startNotifyQueue(client: Client): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processOnce(client);
    } catch (err) {
      console.error("[notify] cycle failed:", err);
    } finally {
      running = false;
    }
  }, POLL_MS);
  console.log(`Reveal-notification queue started (every ${POLL_MS / 1000}s, ${DIGEST_WINDOW_SECONDS}s digest window).`);
}
