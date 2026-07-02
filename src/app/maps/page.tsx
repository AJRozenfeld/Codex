import { getMapExplorerData } from "@/lib/queries";
import { getViewerContext } from "@/lib/player-session";
import { SectionHeading, EmptyState } from "@/components/Card";
import { MapExplorer } from "@/components/MapExplorer";

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
        <MapExplorer maps={maps} />
      )}
    </div>
  );
}
