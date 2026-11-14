import { useEffect, useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective, Position, Region, RegionManifest } from '../../shared/types/contracts';
import MarsMap from '../mars-map/MarsMap';
import LayerPanel from '../mars-map/LayerPanel';
import { initialLayerState, type LayerState } from '../mars-map/mapUtils';
import PlanPanel from './PlanPanel';
import DecisionLog from './DecisionLog';
import RouteBanner from './RouteBanner';

interface Props {
  mission: Mission | null;
  onMission: (m: Mission | null) => void;
}

export default function MissionControl({ mission, onMission }: Props) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<RegionManifest | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [layerState, setLayerState] = useState<Record<string, LayerState>>({});
  const [base, setBase] = useState<Position | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marsApi
      .getRegions()
      .then((rs) => {
        setRegions(rs);
        setRegionId(rs.find((r) => r.available)?.region_id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!regionId) return;
    Promise.all([marsApi.getManifest(regionId), marsApi.getObjectives(regionId)])
      .then(([m, objs]) => {
        setManifest(m);
        setObjectives(objs);
        setLayerState(initialLayerState(m.layers));
        setBase(null);
        setSelectedIds([]);
      })
      .catch((e) => setError(String(e)));
  }, [regionId]);

  if (error) return <p className="p-6 font-mono text-red-500">{error}</p>;

  return (
        <div className="flex h-full">
      <aside className="w-80 space-y-6 overflow-y-auto border-r border-neutral-800 p-4">
        <section>
          <label htmlFor="region" className="text-xs uppercase tracking-widest text-neutral-400">
            Región
          </label>
          <select
            id="region"
            className="mt-1 w-full rounded bg-neutral-900 p-2 text-sm"
            value={regionId ?? ''}
            onChange={(e) => {
              setRegionId(e.target.value);
              onMission(null);
            }}
          >
            {regions.map((r) => (
              <option key={r.region_id} value={r.region_id} disabled={!r.available}>
                {r.name}
              </option>
            ))}
          </select>
          {manifest && <p className="mt-1 text-xs text-neutral-500">Frame: {manifest.frame.frame_id}</p>}
        </section>

        {manifest && (
          <>
            <LayerPanel
              layers={manifest.layers}
              state={layerState}
              onChange={(id, next) => setLayerState((prev) => ({ ...prev, [id]: next }))}
            />
            <PlanPanel
              regionId={manifest.region_id}
              objectives={objectives}
              base={base}
              selectedIds={selectedIds}
              onSelectedIds={setSelectedIds}
              onPlanned={onMission}
            />
            {mission && <DecisionLog mission={mission} />}
          </>
        )}
      </aside>

      <main className="relative flex-1">
        {manifest ? (
          <MarsMap
            manifest={manifest}
            objectives={objectives}
            selectedObjectiveIds={selectedIds}
            basePosition={mission?.base_position ?? base}
            layerState={layerState}
            onMapClick={setBase}
            route={mission?.route ?? null}
          />
        ) : (
          <p className="p-6">Cargando región…</p>
        )}
        {mission && <RouteBanner route={mission.route} />}
      </main>
    </div>
  );
}