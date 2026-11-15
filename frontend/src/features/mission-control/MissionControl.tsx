import { useEffect, useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, MissionPlanRequest, Objective, Position, Region, RegionManifest } from '../../shared/types/contracts';
import MarsMap from '../mars-map/MarsMap';
import LayerPanel from '../mars-map/LayerPanel';
import { initialLayerState, type LayerState } from '../mars-map/mapUtils';
import PlanPanel from './PlanPanel';
import DecisionLog from './DecisionLog';
import RouteDetails from './RouteDetails';
import LegTimeline from './LegTimeline';
import { missionRoute, stopLetters } from '../../shared/mission';
import Icon, { type IconName } from '../../shared/ui/Icon';

type Tab = 'plan' | 'layers';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'plan', label: 'Plan', icon: 'flag' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
];

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
  const [tab, setTab] = useState<Tab>('plan');
  const [planReq, setPlanReq] = useState<{ id: string; req: MissionPlanRequest } | null>(null);
  const [failed, setFailed] = useState<{ id: string; paths: Position[][] } | null>(null);

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

  // Con un plan activo, el clic propone una base para el siguiente cálculo.
  const newBase = mission && base ? base : null;

  if (error) return <p className="p-6 text-alert-500">{error}</p>;

  return (
    // En móvil, el mapa queda encima de los controles.
    <div className="flex flex-col lg:h-full lg:flex-row">
      <nav className="order-2 flex shrink-0 justify-center gap-2 border-b border-space-800 bg-space-900 py-2 lg:order-1 lg:w-20 lg:flex-col lg:justify-start lg:gap-4 lg:border-r lg:border-b-0 lg:py-4">
        {TABS.map(({ id, label, icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={on ? 'page' : undefined}
              className="group flex flex-col items-center gap-1 px-3 text-xs font-medium"
            >
              <span
                className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                  on ? 'bg-primary-950 text-primary-200' : 'text-space-400 group-hover:bg-space-800'
                }`}
              >
                <Icon name={icon} />
              </span>
              <span className={on ? 'text-space-50' : 'text-space-400'}>{label}</span>
            </button>
          );
        })}
      </nav>

      <aside className="order-3 w-full space-y-6 p-4 sm:p-5 lg:order-2 lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-space-800 xl:w-72">
        {tab === 'plan' && (
          <>
            <section>
              <label htmlFor="region" className="eyebrow">
                Region
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
            </section>
            {manifest && (
              <PlanPanel
                regionId={manifest.region_id}
                objectives={objectives}
                base={base ?? mission?.start_position ?? null}
                replan={!!newBase}
                selectedIds={selectedIds}
                onSelectedIds={setSelectedIds}
                onPlanned={(m, req) => {
                  onMission(m);
                  setPlanReq({ id: m.mission_id, req });
                  setBase(null);
                }}
              />
            )}
            {(mission || base || selectedIds.length > 0) && (
              <button
                type="button"
                className="btn-ghost w-full"
                onClick={() => {
                  // Borra la ruta planificada y la selección para empezar de cero
                  onMission(null);
                  setBase(null);
                  setSelectedIds([]);
                  setFailed(null);
                  setPlanReq(null);
                }}
              >
                <Icon name="replay" />
                Reset routes
              </button>
            )}
          </>
        )}
        {tab === 'layers' && manifest && (
          <LayerPanel
            layers={manifest.layers}
            state={layerState}
            onChange={(id, next) => setLayerState((prev) => ({ ...prev, [id]: next }))}
          />
        )}
      </aside>

      <main className="relative order-1 lg:order-3 h-[60dvh] shrink-0 border-b border-space-800 lg:h-auto lg:flex-1 lg:border-b-0">
        {manifest ? (
          <MarsMap
            manifest={manifest}
            objectives={objectives}
            focus={[...objectives.map((o) => o.position), ...(manifest.hazards ?? []).flatMap((h) => h.polygon)]}
            selectedObjectiveIds={selectedIds}
            basePosition={mission?.start_position ?? base}
            pendingBase={newBase}
            layerState={layerState}
            onMapClick={setBase}
            route={mission ? missionRoute(mission) : null}
            legs={mission?.legs}
            failedPaths={failed && failed.id === mission?.mission_id ? failed.paths : undefined}
            stopLetters={mission ? stopLetters(mission) : undefined}
            here={mission?.current_position}
          />
        ) : (
          <p className="p-6 text-space-400">Loading map…</p>
        )}
      </main>

      {mission && (
        <aside className="order-4 w-full space-y-6 border-t border-space-800 p-4 sm:p-5 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l xl:w-96">
          <RouteDetails mission={mission} hazards={manifest?.hazards} />
          <LegTimeline mission={mission} objectives={objectives} hazards={manifest?.hazards} onFailedPaths={(paths) => setFailed({ id: mission.mission_id, paths })} request={planReq?.id === mission.mission_id ? planReq.req : null} />
          <DecisionLog mission={mission} objectives={objectives} />
        </aside>
      )}
    </div>
  );
}
