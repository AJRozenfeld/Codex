"use client";

import { useState } from "react";
import type { MapEntity } from "@/lib/types";
import { MapExplorer } from "./MapExplorer";
import { MapCharacterList } from "./MapCharacterList";

// Client-side composition root for the public /maps page. Lives here (rather
// than inline in app/maps/page.tsx) purely so it can hold the "which map is
// currently shown" state that MapExplorer reports via onCurrentMapChange and
// hand it down to the sidebar - MapExplorer itself never renders the
// sidebar, keeping the two fully independent components as Aviv asked.
export function MapsWithCharacterList({ maps }: { maps: MapEntity[] }) {
  const rootMap = maps.find((m) => m.isRoot) ?? maps[0];
  const [currentMap, setCurrentMap] = useState<MapEntity | undefined>(rootMap);

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0">
        <MapExplorer maps={maps} onCurrentMapChange={setCurrentMap} />
      </div>
      <div className="w-full lg:w-64 lg:shrink-0">
        <MapCharacterList tokens={currentMap?.tokens ?? []} mapName={currentMap?.name} />
      </div>
    </div>
  );
}
