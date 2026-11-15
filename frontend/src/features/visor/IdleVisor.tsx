import { lazy, Suspense, useEffect, useState } from 'react';
import type { MissionPackage, Objective, Position, RegionManifest } from '../../shared/types/contracts';
import { marsApi } from '../../shared/api/client';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState, type LayerState } from '../mars-map/mapUtils';
import { loadLastPosition, saveLastPosition, useOnline } from '../offline-sync/offline';
import PositionCard from './PositionCard';
import Radar from './nav/Radar';
import { bearingDeg, cardinal } from './nav/geo';
import ErrorBoundary from '../../shared/ui/ErrorBoundary';
import Icon from '../../shared/ui/Icon';

const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

// Valores de EVA cuando el astronauta planifica solo (referencias NASA: ~8 h de traje, reserva de retorno,
// paradas de geología de 30–60 min, pendiente segura a pie ≤ 15°)
const EVA_PLAN = {
  constraints: { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true },
  resources: { oxygen_available_min: 480, return_reserve_min: 60 },
  activity_min: 45,
};

// Visor sin misión asignada: el astronauta ve el terreno 3D, su posición y su radar. Desde el radar puede
// elegir objetivos y planificar su propia misión (desde donde está); también la puede recibir del panel.
export default function IdleVisor({ onPackage }: { onPackage: (pkg: MissionPackage) => void }) {
  const online = useOnline();
  const [region, setRegion] = useState<{ manifest: RegionManifest; objectives: Objective[]; layers: Record<string, LayerState> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [here, setHere] = useState(loadLastPosition);
  const [use3d, setUse3d] = useState(true); // 3D desde el inicio; el 2D solo si el 3D falla
  const [heading, setHeading] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]); // en el orden en que se eligen = orden de visita
  const [planning, setPlanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    marsApi
      .getRegions()
      .then((rs) => {
        const id = rs.find((r) => r.available)?.region_id;
        if (!id) throw new Error('sin región disponible');
        return Promise.all([marsApi.getManifest(id), marsApi.getObjectives(id)] as const);
      })
      .then(([manifest, objectives]) => setRegion({ manifest, objectives, layers: initialLayerState(manifest.layers) }))
      .catch(() => setFailed(true));
  }, []);

  if (!region) {
    return (
      <div className="flex h-dvh items-center justify-center bg-space-950 p-6 text-center text-sm text-space-200">
        {failed ? 'Sin misión y sin enlace con el panel de control.' : 'Cargando mapa…'}
      </div>
    );
  }

  const { manifest, objectives } = region;
  const b = manifest.bounds_local_m;
  // Sin posición conocida, la cámara 3D mira el centro de la zona (no se guarda como posición)
  const view = here ?? { x_m: (b.min_x + b.max_x) / 2, y_m: (b.min_y + b.max_y) / 2, frame_id: manifest.frame.frame_id };
  const imageryLayer =
    manifest.layers.find((l) => l.layer_id === manifest.terrain?.texture_layer_id) ?? manifest.layers.find((l) => l.kind === 'optical');
  const imagery = imageryLayer?.asset_url ? { url: imageryLayer.asset_url, bounds: manifest.bounds_local_m } : null;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // En el mapa: tocar cerca (< 300 m) de un objetivo lo agrega/quita; en otro punto, fija tu posición
  // ponytail: sin localización del traje, la posición se fija tocando el mapa (simulación para la demo)
  const onMapClick = (p: Position) => {
    const near = objectives
      .map((o) => ({ o, m: Math.hypot(o.position.x_m - p.x_m, o.position.y_m - p.y_m) }))
      .sort((a, c) => a.m - c.m)[0];
    if (picking && near && near.m < 300) return toggle(near.o.objective_id);
    setHere(p);
    saveLastPosition(p);
  };

  const plan = async () => {
    if (!here || chosen.length === 0) return;
    setPlanning(true);
    setMsg(null);
    try {
      const mission = await marsApi.planMission({
        region_id: manifest.region_id,
        base_position: here,
        objective_ids: chosen,
        constraints: EVA_PLAN.constraints,
        resources: EVA_PLAN.resources,
        activity_durations_min: Object.fromEntries(chosen.map((id) => [id, EVA_PLAN.activity_min])),
      });
      onPackage(await marsApi.getMissionPackage(mission.mission_id));
    } catch (e) {
      setMsg(`No se pudo planificar: ${e instanceof Error ? e.message : String(e)}`);
      setPlanning(false);
    }
  };

  const map2d = (
    <MarsMap
      manifest={manifest}
      objectives={objectives}
      selectedObjectiveIds={chosen}
      basePosition={null}
      layerState={region.layers}
      route={null}
      here={here}
      focus={here ? [here, ...objectives.map((o) => o.position)] : undefined}
      onMapClick={onMapClick}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      <div className="absolute inset-0">
        {use3d && manifest.terrain ? (
          <ErrorBoundary fallback={map2d}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm">Cargando terreno 3D…</p>}>
              <Terrain3D
                manifest={manifest}
                terrain={manifest.terrain}
                route={null}
                base={null}
                objectives={objectives}
                targetId={null}
                here={view}
                destination={null}
                onHeading={setHeading}
                onError={() => setUse3d(false)}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-wrap items-start gap-2 sm:inset-x-3 sm:top-3">
        {here && <PositionCard frame={manifest.frame} here={here} label="Sin misión" online={online} />}
        <p className="hud mx-auto px-3 py-1.5 text-xs">Sin misión</p>
      </div>

      {/* Radar: abre la selección de objetivos */}
      {!picking && (
        <button
          type="button"
          className="group absolute bottom-2 left-2 z-20 aspect-square w-28 rounded-full focus-visible:outline-2 focus-visible:outline-primary-300 sm:bottom-3 sm:left-3 sm:w-44 lg:w-52"
          aria-label="Abrir mapa para elegir objetivos y planificar misión"
          onClick={() => setPicking(true)}
        >
          <Radar
            center={view}
            target={null}
            base={view}
            path={[]}
            hazards={manifest.hazards ?? []}
            heading={use3d ? heading : null}
            imagery={imagery}
            unknownZones={manifest.terrain?.quality_zones?.filter((z) => z.quality === 'unknown')}
          />
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 flex size-8 items-center justify-center rounded-full bg-primary-600 text-white shadow-md group-hover:bg-primary-500"
          >
            <Icon name="expand" size={16} />
          </span>
        </button>
      )}

      {picking && (
        <div role="dialog" aria-modal="true" aria-label="Elegir misión" className="absolute inset-0 z-30 flex flex-col bg-space-950 lg:flex-row">
          <div className="relative min-h-0 flex-1">{map2d}</div>
          <aside className="hud m-2 max-h-[55dvh] space-y-3 overflow-y-auto p-3 sm:p-4 lg:max-h-none lg:w-96 lg:self-end">
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-medium text-space-50">Elige tus objetivos</p>
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-full text-space-200 hover:bg-white/10"
                aria-label="Cerrar"
                onClick={() => setPicking(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <ul className="space-y-1.5">
              {objectives.map((o) => {
                const n = chosen.indexOf(o.objective_id);
                const dist = here ? Math.hypot(o.position.x_m - here.x_m, o.position.y_m - here.y_m) : null;
                const brg = here ? bearingDeg(here, o.position) : null;
                return (
                  <li key={o.objective_id}>
                    <button
                      type="button"
                      aria-pressed={n >= 0}
                      onClick={() => toggle(o.objective_id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                        n >= 0 ? 'border-green-500 bg-green-950/60' : 'border-space-700 bg-space-900/70 hover:border-primary-400'
                      }`}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-space-500 font-mono text-xs">
                        {n >= 0 ? String.fromCharCode(66 + n) : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{o.title.split(' — ')[0]}</span>
                        {dist !== null && brg !== null && (
                          <span className="block text-[11px] text-space-300">
                            {(dist / 1000).toFixed(1)} km · {Math.round(brg)}° {cardinal(brg)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-space-400">
              O₂ {EVA_PLAN.resources.oxygen_available_min} · reserva {EVA_PLAN.resources.return_reserve_min} · {EVA_PLAN.activity_min} min/objetivo
            </p>
            {!here && <p className="text-xs text-amber-300">Toca el mapa para fijar tu posición.</p>}
            {msg && <p className="text-xs text-alert-300">{msg}</p>}
            <button
              type="button"
              disabled={!here || chosen.length === 0 || planning || !online}
              onClick={plan}
              className="btn min-h-14 w-full bg-primary-600 px-5 text-base text-white enabled:hover:bg-primary-500 sm:text-lg"
            >
              {planning ? 'Calculando…' : 'Planificar'}
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
