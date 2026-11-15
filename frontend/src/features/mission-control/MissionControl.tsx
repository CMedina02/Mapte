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

  if (error) return <p className="p-6 text-alert-500">{error}</p>;

  return (
    // Móvil y tableta vertical: mapa arriba y panel debajo (scroll de página). Desde lg: panel lateral + mapa.
    <div className="flex flex-col lg:h-full lg:flex-row">
      <aside className="order-2 w-full space-y-6 p-3 sm:p-4 lg:order-1 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-space-800 xl:w-96">
        <section>
          <label htmlFor="region" className="eyebrow">
            Región
          </label>
          <select
            id="region"
            className="field mt-1"
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
          {manifest && <p className="mt-1 text-xs text-space-400">Frame: {manifest.frame.frame_id}</p>}
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

      <main className="relative order-1 h-[60dvh] shrink-0 border-b border-space-800 lg:order-2 lg:h-auto lg:flex-1 lg:border-b-0">
        {manifest ? (
          <MarsMap
            manifest={manifest}
            objectives={objectives}
            focus={[...objectives.map((o) => o.position), ...(manifest.hazards ?? []).flatMap((h) => h.polygon)]}
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