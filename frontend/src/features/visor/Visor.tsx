import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Constraints, Mission, MissionPackage, RouteResult } from '../../shared/types/contracts';
import { fmt, ROUTE_STATUS } from '../../shared/format';
import { marsApi } from '../../shared/api/client';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState } from '../mars-map/mapUtils';
import { loadPackage, sendQueue, updatePackageMission, useOnline, usePendingQueue } from '../offline-sync/offline';
import ErrorBoundary from '../../shared/ui/ErrorBoundary';
import ResourceCheck from './ResourceCheck';
import FindingPad from './FindingPad';
import DestinationPicker, { type Destination } from './DestinationPicker';
import PositionCard from './PositionCard';
import Radar from './nav/Radar';
import CompassTape from './nav/CompassTape';
import ElevationProfile from './nav/ElevationProfile';
import { bearingDeg, samePlace } from './nav/geo';

// three.js pesa: se descarga solo al abrir la vista 3D
const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

type Phase = 'select' | 'confirm' | 'navigate' | 'arrived';

// ponytail: restricciones estándar de EVA para calcular tramos desde el visor (el plan no viaja en Mission);
// cuando exista el endpoint de navegación, el backend usará las restricciones de la misión.
const EVA_CONSTRAINTS: Constraints = { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true };

const bigButton = 'btn min-h-14 px-5 text-base sm:text-lg';

export default function Visor() {
  const [pkg] = useState(loadPackage);
  const [mission, setMission] = useState<Mission | null>(() => pkg?.mission ?? null);

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  if (!pkg || !mission) {
    return (
      <div className="flex h-dvh items-center justify-center bg-space-950 p-6 text-center text-space-100">
        <p>
          Sin paquete de misión.
          <br />
          Transfiérelo desde el panel de control.
        </p>
      </div>
    );
  }
  return <VisorHud pkg={pkg} mission={mission} setMission={setMission} />;
}

function VisorHud({ pkg, mission, setMission }: { pkg: MissionPackage; mission: Mission; setMission: (m: Mission) => void }) {
  const manifest = pkg.region_manifest;
  const [layerState] = useState(() => initialLayerState(manifest.layers));
  const [phase, setPhase] = useState<Phase>('select');
  const [notice, setNotice] = useState<string | null>(null);
  const [view3d, setView3d] = useState(() => !!manifest.terrain); // 3D por defecto si hay terreno
  const [heading, setHeading] = useState<number | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, RouteResult | 'error'>>({});
  const [queue, setQueue] = usePendingQueue();
  const online = useOnline();

  // Dónde está el astronauta: inicio de la ruta restante que entrega el backend.
  // ponytail: cuando el backend mande mission.current_position, usarla aquí.
  const here = mission.route.path[0] ?? mission.base_position;
  const hereLabel = samePlace(here, mission.base_position)
    ? 'Base'
    : (pkg.objectives.find((o) => samePlace(here, o.position))?.title ?? 'En ruta');

  // Destinos posibles: objetivos pendientes + regreso a base. Por defecto, el que marca el plan.
  const pending = pkg.objectives.filter(
    (o) => mission.objective_ids.includes(o.objective_id) && !mission.completed_objective_ids.includes(o.objective_id),
  );
  const destinations: Destination[] = [
    ...pending.map((o) => ({
      id: o.objective_id,
      title: o.title,
      position: o.position,
      recommended: o.objective_id === mission.next_objective_id,
    })),
    // Regresar a base solo tiene sentido si no estás ya en ella (o si no queda nada pendiente)
    ...(hereLabel !== 'Base' || pending.length === 0
      ? [{ id: 'base', title: 'Regresar a base', position: mission.base_position, recommended: pending.length === 0 }]
      : []),
  ];
  const defaultId = pending.some((o) => o.objective_id === mission.next_objective_id) ? mission.next_objective_id! : 'base';
  const dest = destinations.find((d) => d.id === chosenId) ?? destinations.find((d) => d.id === defaultId)!;
  const objective = pkg.objectives.find((o) => o.objective_id === dest.id) ?? null;

  // Ruta del tramo actual → destino elegido (la calcula el backend)
  const previewKey = `${dest.id}@${Math.round(here.x_m)},${Math.round(here.y_m)}`;
  const preview = previews[previewKey];
  useEffect(() => {
    if (preview !== undefined) return;
    let alive = true;
    marsApi
      .computeRoute({ region_id: mission.region_id, start: here, end: dest.position, constraints: EVA_CONSTRAINTS })
      .then((r) => alive && setPreviews((p) => ({ ...p, [previewKey]: r })))
      .catch(() => alive && setPreviews((p) => ({ ...p, [previewKey]: 'error' })));
    return () => {
      alive = false;
    };
  }, [preview, previewKey, mission.region_id, here, dest.position]);

  const isPlanNext = dest.id === mission.next_objective_id;
  const legRoute: RouteResult | null =
    preview && preview !== 'error' ? preview : preview === 'error' && isPlanNext ? mission.route : null;
  const routeNote =
    preview === undefined
      ? 'Calculando ruta…'
      : preview === 'error'
        ? isPlanNext
          ? 'Sin enlace: se muestra la ruta del plan.'
          : 'Sin enlace: este destino no tiene ruta calculada. Elige el destino del plan o espera al enlace.'
        : null;
  const shownRoute = legRoute ?? mission.route;
  const bearing = bearingDeg(here, dest.position);

  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
  const reservePct = o2 > 0 ? Math.min(100, (reserve / o2) * 100) : 100;

  const on3dError = useCallback((msg: string) => {
    setNotice(msg);
    setView3d(false);
  }, []);

  const backToSelect = (msg?: string) => {
    setNotice(msg ?? null);
    setChosenId(null);
    setPhase('select');
  };

  const map2d = (
    <MarsMap
      manifest={manifest}
      objectives={pkg.objectives}
      selectedObjectiveIds={objective ? [objective.objective_id] : []}
      basePosition={mission.base_position}
      layerState={layerState}
      route={shownRoute}
      focus={[here, dest.position, ...shownRoute.path]}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      {/* Mapa a pantalla completa; los instrumentos flotan encima */}
      <div className="absolute inset-0">
        {view3d && manifest.terrain ? (
          <ErrorBoundary fallback={map2d}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm">Cargando terreno 3D…</p>}>
              <Terrain3D
                manifest={manifest}
                terrain={manifest.terrain}
                route={shownRoute}
                base={mission.base_position}
                objectives={pkg.objectives}
                targetId={objective?.objective_id ?? null}
                here={here}
                destination={dest.position}
                onHeading={setHeading}
                onError={on3dError}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d
        )}
      </div>

      {/* ---------- Franja superior ---------- */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col gap-2 sm:inset-x-3 sm:top-3">
        <div className="flex items-start justify-between gap-2">
          <PositionCard frame={manifest.frame} here={here} label={hereLabel} />
          <div className="hud pointer-events-auto flex flex-wrap items-center justify-end gap-2 px-2 py-1.5 text-[11px] tracking-widest uppercase">
            {manifest.terrain && (
              <button
                type="button"
                className="btn min-h-9 border border-primary-400 px-2 py-1 text-xs text-primary-200"
                aria-pressed={view3d}
                onClick={() => setView3d((v) => !v)}
              >
                {view3d ? 'Ver 2D' : 'Ver 3D'}
              </button>
            )}
            {queue.length > 0 && <span>{queue.length} pendiente(s)</span>}
            {online && queue.length > 0 && (
              <button
                type="button"
                className="btn min-h-9 border border-primary-500 px-2 py-1 text-xs text-primary-300"
                onClick={async () => setNotice(await sendQueue(mission, queue, setMission, setQueue))}
              >
                Enviar
              </button>
            )}
            <span className={online ? 'text-green-400' : 'text-amber-300'}>● {online ? 'Enlace' : 'Sin enlace'}</span>
          </div>
        </div>

        {phase !== 'confirm' && <CompassTape heading={view3d ? heading : null} bearing={bearing} />}

        {mission.alerts.length > 0 && (
          <div role="alert" className="mx-auto max-w-xl rounded-md border border-alert-500 bg-alert-950/90 px-3 py-2 text-sm font-bold text-alert-100">
            ⚠ {mission.alerts.join(' · ')}
          </div>
        )}
      </div>

      {/* ---------- Franja inferior: radar + panel de acción ---------- */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col items-start gap-2 sm:inset-x-3 sm:bottom-3 sm:flex-row sm:items-end">
        {phase !== 'confirm' && (
          <div className="aspect-square w-28 shrink-0 sm:w-40 lg:w-48">
            <Radar
              center={here}
              target={dest.position}
              base={mission.base_position}
              path={shownRoute.path}
              hazards={manifest.hazards ?? []}
              heading={view3d ? heading : null}
            />
          </div>
        )}

        <section className="hud pointer-events-auto w-full space-y-3 p-3 backdrop-blur-sm sm:ml-auto sm:max-w-xl sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs sm:flex-nowrap sm:text-sm">
            <span>O₂ {fmt(o2, 'min')}</span>
            <div
              className="order-last flex h-2.5 basis-full overflow-hidden rounded bg-primary-950 sm:order-none sm:flex-1 sm:basis-auto"
              role="img"
              aria-label={`Reserva de retorno ${reserve} de ${o2} minutos de O₂`}
              title="Rojo: reserva de retorno"
            >
              <div className="bg-alert-600" style={{ width: `${reservePct}%` }} />
              <div className="flex-1 bg-primary-500" />
            </div>
            <span>Reserva {fmt(reserve, 'min')}</span>
          </div>

          {phase === 'select' && (
            <>
              <p className="eyebrow">¿A dónde vas?</p>
              <DestinationPicker
                destinations={destinations}
                selectedId={dest.id}
                here={here}
                onSelect={(id) => {
                  setNotice(null);
                  setChosenId(id);
                }}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  {legRoute ? (
                    <>
                      <span className={`chip border ${(ROUTE_STATUS[legRoute.status] ?? ROUTE_STATUS.unknown).cls}`}>
                        {(ROUTE_STATUS[legRoute.status] ?? ROUTE_STATUS.unknown).label}
                      </span>{' '}
                      {fmt(legRoute.distance_m, 'm')} · {fmt(legRoute.duration_min, 'min')}
                    </>
                  ) : null}
                  {routeNote && <p className="mt-1 text-xs text-space-300">{routeNote}</p>}
                </div>
                <button
                  type="button"
                  disabled={!legRoute}
                  className={`${bigButton} w-full bg-primary-600 text-white enabled:hover:bg-primary-500 sm:w-auto`}
                  onClick={() => {
                    setNotice(null);
                    setPhase('confirm');
                  }}
                >
                  Verificar ruta
                </button>
              </div>
            </>
          )}

          {phase === 'navigate' && legRoute && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Navegando a</p>
                <p className="text-lg font-bold">{dest.title}</p>
                <p className="text-sm">
                  Distancia {fmt(legRoute.distance_m, 'm')} · Tiempo {fmt(legRoute.duration_min, 'min')}
                </p>
                <div className="mt-2">
                  <ElevationProfile path={legRoute.path} datum={manifest.terrain?.vertical_datum} />
                </div>
                {legRoute.warnings.length > 0 && (
                  // Plegado para no tapar el terreno; se abre con un toque
                  <details className="text-xs text-amber-300">
                    <summary className="cursor-pointer font-semibold">⚠ {legRoute.warnings.length} aviso(s) de ruta</summary>
                    {legRoute.warnings.map((w) => (
                      <p key={w} className="mt-1">
                        {w}
                      </p>
                    ))}
                  </details>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col">
                <button type="button" className={`${bigButton} border border-primary-500`} onClick={() => setPhase('select')}>
                  Cambiar
                </button>
                <button type="button" className={`${bigButton} bg-green-700 text-white`} onClick={() => setPhase('arrived')}>
                  Llegué
                </button>
              </div>
            </div>
          )}

          {phase === 'arrived' &&
            (objective ? (
              <FindingPad
                onBack={() => setPhase('navigate')}
                mission={mission}
                objective={objective}
                onMission={setMission}
                onQueue={(o) => setQueue((q) => [...q, o])}
                onDone={backToSelect}
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-lg font-bold">Llegaste a la base.</p>
                <button type="button" className={`${bigButton} bg-primary-600 text-white`} onClick={() => backToSelect()}>
                  Listo
                </button>
              </div>
            ))}

          {notice && (
            <p role="status" className="text-sm text-primary-200">
              {notice}
            </p>
          )}
        </section>
      </div>

      {phase === 'confirm' && legRoute && (
        <ResourceCheck
          route={legRoute}
          resources={mission.resources}
          targetTitle={dest.title}
          onConfirm={() => setPhase('navigate')} // ponytail: local hasta que exista el endpoint de navegación
          onCancel={() => setPhase('select')}
        />
      )}
    </div>
  );
}
