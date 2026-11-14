import { useEffect, useState } from 'react';
import { marsApi } from './shared/api/client';
import type { Objective, Position, RegionManifest } from './shared/types/contracts';
import MarsMap from './features/mars-map/MarsMap';
import LayerPanel from './features/mars-map/LayerPanel';
import { initialLayerState, type LayerState } from './features/mars-map/mapUtils';

export default function App() {
  const [manifest, setManifest] = useState<RegionManifest | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [base, setBase] = useState<Position | null>(null);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [region] = await marsApi.getRegions();
      const [m, objs, mission] = await Promise.all([
        marsApi.getManifest(region.region_id),
        marsApi.getObjectives(region.region_id),
        marsApi.getMission('mission-demo-001'), // temporal: la base llega con la misión (FE-03)
      ]);
      setManifest(m);
      setObjectives(objs);
      setBase(mission.base_position);
      setLayerState(initialLayerState(m.layers));
    })().catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="p-6 text-red-500">{error}</p>;
  if (!manifest) return <p className="p-6 font-mono">Cargando región…</p>;

  return (
    <div className="flex h-screen bg-neutral-950 font-mono text-neutral-100">
      <aside className="w-72 overflow-y-auto border-r border-neutral-800 p-4">
        <p className="mb-4 text-xs text-neutral-500">Frame: {manifest.frame.frame_id}</p>
        <LayerPanel
          layers={manifest.layers}
          state={layerState}
          onChange={(id, next) => setLayerState((prev) => ({ ...prev, [id]: next }))}
        />
      </aside>
      <main className="flex-1">
        <MarsMap manifest={manifest} objectives={objectives} basePosition={base} layerState={layerState} />
      </main>
    </div>
  );
}