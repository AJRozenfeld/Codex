import { getCurrentCampaignId } from "@/lib/campaign-queries";
import {
  adminGetBoardItemsWithPreviews,
  adminCreateBoardItem,
  adminUpdateBoardItem,
  adminDeleteBoardItem,
  adminGetLinkPreview,
  adminSearchLinkableEntities,
  type BoardItemWithPreview,
  type LinkSearchResult,
} from "@/lib/board-queries";
import type { BoardItemType, InheritableEntityType } from "@/lib/types";
import { Whiteboard } from "@/components/Whiteboard";

export const dynamic = "force-dynamic";

async function createItemAction(input: {
  type: BoardItemType;
  x: number;
  y: number;
  entityType?: InheritableEntityType;
  entityId?: string;
}): Promise<BoardItemWithPreview> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  const created = await adminCreateBoardItem(campaignId, {
    type: input.type,
    x: input.x,
    y: input.y,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  });
  if (created.type === "link" && created.entityType && created.entityId) {
    const preview = await adminGetLinkPreview(campaignId, created.entityType, created.entityId);
    return { ...created, preview };
  }
  return { ...created, preview: null };
}

async function updatePositionAction(id: string, x: number, y: number, width: number, height: number): Promise<void> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpdateBoardItem(campaignId, id, { x, y, width, height });
}

async function updateContentAction(id: string, title: string, body: string): Promise<void> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpdateBoardItem(campaignId, id, { title, body });
}

async function updateColorAction(id: string, color: string | null): Promise<void> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpdateBoardItem(campaignId, id, { color });
}

async function bringToFrontAction(id: string): Promise<void> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminUpdateBoardItem(campaignId, id, { bringToFront: true });
}

async function deleteItemAction(id: string): Promise<void> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  await adminDeleteBoardItem(campaignId, id);
}

async function searchLinkableAction(query: string): Promise<LinkSearchResult[]> {
  "use server";
  const campaignId = await getCurrentCampaignId();
  return adminSearchLinkableEntities(campaignId, query);
}

export default async function DmScreenPage() {
  const campaignId = await getCurrentCampaignId();
  const items = await adminGetBoardItemsWithPreviews(campaignId);

  return (
    <div>
      <h1 className="font-display text-2xl text-gold mb-2">DM Screen</h1>
      <p className="text-sm text-parchment/40 mb-6">
        Your whiteboard for this campaign - notes, cheatsheets, and quick links to any article, laid
        out however you like. Never shown to players.
      </p>
      <Whiteboard
        initialItems={items}
        createItemAction={createItemAction}
        updatePositionAction={updatePositionAction}
        updateContentAction={updateContentAction}
        updateColorAction={updateColorAction}
        bringToFrontAction={bringToFrontAction}
        deleteItemAction={deleteItemAction}
        searchLinkableAction={searchLinkableAction}
      />
    </div>
  );
}
