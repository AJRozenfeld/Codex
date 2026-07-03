import { getMapExplorerData } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState } from "@/components/Card";
import { MapsWithCharacterList } from "@/components/MapsWithCharacterList";

export const dynamic = "force-dynamic";

export default async function MapsPage() {
  const viewer = await getViewerContext();
  const maps = await getMapExplorerData(viewer);

  return (
    <div>
      <SectionHeading eyebrow="Chart the World" title="Maps" />
      {maps.length === 0 ? (
        <EmptyState message="No maps have been revealed yet." />
      ) : (
        <MapsWithCharacterList maps={maps} />
      )}
    </div>
  );
}
