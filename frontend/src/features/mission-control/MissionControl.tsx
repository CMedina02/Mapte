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

type Tab = 'plan' | 'layers';
// Íconos en línea (trazo 24×24): lucide-react rompía el pre-empaquetado de Vite (dos copias de React)
const icon = (d: string) => () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const TABS: { id: Tab; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'plan', label: 'Plan', icon: icon('M4 22V4m0 0h12l-2 4 2 4H4') },
  { id: 'layers', label: 'Capas', icon: icon('M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5') },
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
  // Solicitud del último plan hecho aquí: con ella se explica qué parámetro faltó a un objetivo excluido
  const [planReq, setPlanReq] = useState<{ id: string; req: MissionPlanRequest } | null>(null);

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

  // Con misión planificada, un clic en el mapa propone otra base (punteada) hasta recalcular
  const newBase = mission && base ? base : null;

  if (error) return <p className="p-6 text-alert-500">{error}</p>;

  return (
    // Móvil y tableta vertical: mapa arriba, pestañas y panel debajo. Desde lg: opciones a la izquierda, mapa al centro, información a la derecha.
    <div className="flex flex-col lg:h-full lg:flex-row">
      <nav className="order-2 flex shrink-0 border-b border-space-800 lg:order-1 lg:w-16 lg:flex-col lg:border-r lg:border-b-0 lg:py-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={on ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] lg:flex-none lg:py-3 ${
                on ? 'text-primary-300' : 'text-space-400 hover:text-space-200'
              }`}
            >
              <Icon />
              {label}
            </button>
          );
        })}
      </nav>

      <aside className="order-3 w-full space-y-6 p-3 sm:p-4 lg:order-2 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-space-800 xl:w-96">
        {tab === 'plan' && (
          <>
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
                  setBase(null); // la base ya es la de la misión: se quita el círculo punteado
                }}
              />
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
            stopLetters={mission ? stopLetters(mission) : undefined}
            here={mission?.current_position}
          />
        ) : (
          <p className="p-6">Cargando región…</p>
        )}
      </main>

      {/* Derecha: información de la misión planificada (ruta + bitácora) */}
      {mission && (
        <aside className="order-4 w-full space-y-6 border-t border-space-800 p-3 sm:p-4 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l xl:w-96">
          <RouteDetails mission={mission} />
          <LegTimeline mission={mission} objectives={objectives} request={planReq?.id === mission.mission_id ? planReq.req : null} />
          <DecisionLog mission={mission} objectives={objectives} />
        </aside>
      )}
    </div>
  );
}
