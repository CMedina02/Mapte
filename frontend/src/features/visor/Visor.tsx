import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Constraints, Mission, MissionPackage, Position, RouteResult } from '../../shared/types/contracts';
import { fmtDistance, fmtDuration, notices, ROUTE_STATUS, warningText } from '../../shared/format';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState } from '../mars-map/mapUtils';
import {
  isNewerMission, loadPackage, saveLastPosition, savePackage, sendQueue, updatePackageMission, useOnline, usePackageUpdates, usePendingQueue,
} from '../offline-sync/offline';
import ErrorBoundary from '../../shared/ui/ErrorBoundary';
import ResourceCheck from './ResourceCheck';
import FindingPad from './FindingPad';
import DestinationPicker, { type Destination } from './DestinationPicker';
import PositionCard from './PositionCard';
import IdleVisor from './IdleVisor';
import Radar from './nav/Radar';
import CompassTape from './nav/CompassTape';
import ElevationProfile from './nav/ElevationProfile';
import { bearingDeg, norm360, samePlace } from './nav/geo';
import { compassAvailable, useDeviceCompass } from './nav/useDeviceCompass';
import { activeMissionLeg, excludedObjectives, exclusionsCrossed, missionRoute, shortReason, stopLetters } from '../../shared/mission';
import { excludedPaths, useExcludedRoute } from '../../shared/useExcludedRoute';
import Icon from '../../shared/ui/Icon';

const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

type Phase = 'select' | 'confirm' | 'navigate' | 'arrived';

// Restricciones de respaldo para paquetes antiguos.
const EVA_CONSTRAINTS: Constraints = { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true };

const bigButton = 'btn min-h-14 px-5 text-base sm:text-lg';

export default function Visor() {
  const [pkg, setPkg] = useState(loadPackage);
  const [mission, setMission] = useState<Mission | null>(() => pkg?.mission ?? null);
  const online = useOnline();
  const missionId = mission?.mission_id ?? null;

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  // El evento storage recibe paquetes guardados por el panel.
  usePackageUpdates((p) => {
    setPkg(p);
    setMission((m) => (isNewerMission(m, p.mission) ? p.mission : m));
  });

  // Una vez cargado el paquete, consulta la misión cada 5 s.
  useEffect(() => {
    if (!online || !missionId) return;
    const id = setInterval(() => {
      marsApi
        .getMission(missionId)
        .then((m) => setMission((cur) => (cur?.mission_id === m.mission_id && isNewerMission(cur, m) ? m : cur)))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [online, missionId]);

  if (!pkg || !mission) {
    return (
      <IdleVisor
        onPackage={(p) => {
          savePackage(p);
          setPkg(p);
          setMission(p.mission);
        }}
      />
    );
  }
  // Un cambio de misión reinicia el estado del visor.
  return <VisorHud key={mission.mission_id} pkg={pkg} mission={mission} setMission={setMission} />;
}

function VisorHud({ pkg, mission, setMission }: { pkg: MissionPackage; mission: Mission; setMission: (m: Mission) => void }) {
  const manifest = pkg.region_manifest;
  const [layerState] = useState(() => initialLayerState(manifest.layers));
  const [phase, setPhase] = useState<Phase>('select');
  const [notice, setNotice] = useState<string | null>(null);
  // La vista 2D queda como respaldo si el 3D falla.
  const [view3d, setView3d] = useState(() => !!manifest.terrain);
  const [heading, setHeading] = useState<number | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState<Position | null>(null);
  // El rumbo viene de la brújula o del ratón.
  const compass = useDeviceCompass();
  const [hasCompass] = useState(compassAvailable);
  const [mouseLook, setMouseLook] = useState<number | null>(null);
  const [mousePitch, setMousePitch] = useState<number | null>(null);
  const lookHeading = compass.heading ?? mouseLook;
  const [previews, setPreviews] = useState<Record<string, RouteResult | 'error'>>({});
  const [queue, setQueue] = usePendingQueue();
  const online = useOnline();

  const plannedRoute = missionRoute(mission);
  const activeLeg = activeMissionLeg(mission);
  const here = mission.current_position ?? activeLeg?.path[0] ?? mission.start_position;
  useEffect(() => saveLastPosition(here), [here]);
  const hereLabel = samePlace(here, mission.return_position)
    ? 'Base'
    : (pkg.objectives.find((o) => samePlace(here, o.position))?.title ?? 'En ruta');

  const pending = pkg.objectives.filter(
    (o) => mission.objective_ids.includes(o.objective_id) && !mission.completed_objective_ids.includes(o.objective_id),
  );
  const destinations: Destination[] = [
    ...pending.map((o) => ({
      id: o.objective_id,
      title: o.title,
      position: o.position,
      recommended: o.objective_id === mission.next_objective_id,
      reach: mission.viability_status === 'viable' ? ('ok' as const) : undefined,
    })),
    ...(hereLabel !== 'Base' || pending.length === 0
      ? [{ id: 'base', title: 'Regresar a base', position: mission.return_position, recommended: pending.length === 0 }]
      : []),
    ...(custom ? [{ id: 'custom', title: 'Punto marcado', position: custom, recommended: false }] : []),
  ];
  // Traza en rojo la alternativa del primer objetivo excluido.
  const firstExcluded = excludedObjectives(mission)[0];
  const excludedObj = firstExcluded && pkg.objectives.find((o) => o.objective_id === firstExcluded.objective_id);
  const failedPaths = excludedPaths(
    useExcludedRoute(
      mission,
      excludedObj ? { objective_id: excludedObj.objective_id, position: excludedObj.position, reason: firstExcluded.reason } : null,
      mission.routing_constraints ?? EVA_CONSTRAINTS,
    ),
  );

  const letters = stopLetters(mission);
  const done = mission.completed_objective_ids.length;
  const total = mission.objective_ids.length;

  const unreachable: Destination[] = excludedObjectives(mission).flatMap((x) => {
    const o = pkg.objectives.find((ob) => ob.objective_id === x.objective_id);
    return o ? [{ id: o.objective_id, title: o.title, position: o.position, recommended: false, reach: 'no' as const, note: shortReason(x.reason) }] : [];
  });
  const defaultId = pending.some((o) => o.objective_id === mission.next_objective_id) ? mission.next_objective_id! : 'base';
  const dest = destinations.find((d) => d.id === chosenId) ?? destinations.find((d) => d.id === defaultId)!;
  const objective = pkg.objectives.find((o) => o.objective_id === dest.id) ?? null;

  const previewKey = `${dest.id}@${Math.round(here.x_m)},${Math.round(here.y_m)}`;
  const preview = previews[previewKey];
  useEffect(() => {
    if (preview !== undefined) return;
    let alive = true;
    marsApi
      .computeRoute({ region_id: mission.region_id, start: here, end: dest.position, constraints: mission.routing_constraints ?? EVA_CONSTRAINTS })
      .then((r) => alive && setPreviews((p) => ({ ...p, [previewKey]: r })))
      .catch(() => alive && setPreviews((p) => ({ ...p, [previewKey]: 'error' })));
    return () => {
      alive = false;
    };
  }, [preview, previewKey, mission.region_id, mission.routing_constraints, here, dest.position]);

  const isPlanNext = dest.id === mission.next_objective_id;
  const legRoute: RouteResult | null =
    preview && preview !== 'error' ? preview : preview === 'error' && isPlanNext ? plannedRoute : null;
  const routeNote =
    preview === undefined
      ? 'Calculando ruta…'
      : preview === 'error'
        ? isPlanNext
          ? 'Sin conexión: se muestra la ruta del plan'
          : 'Sin conexión para calcular esta ruta'
        : null;
  const shownRoute = legRoute ?? plannedRoute;
  const bearing = bearingDeg(here, dest.position);

  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
  const alerts = [
    ...exclusionsCrossed(shownRoute.path, manifest.hazards ?? []).map((z) => `La ruta cruza ${z}`),
    ...notices([], mission.alerts),
  ];
  const reservePct = o2 > 0 ? Math.min(100, (reserve / o2) * 100) : 100;

  const imageryLayer =
    manifest.layers.find((l) => l.layer_id === manifest.terrain?.texture_layer_id) ??
    manifest.layers.find((l) => l.kind === 'optical');
  const imagery = imageryLayer?.asset_url ? { url: imageryLayer.asset_url, bounds: manifest.bounds_local_m } : null;

  const on3dError = useCallback((msg: string) => {
    setNotice(msg);
    setView3d(false);
  }, []);

  const backToSelect = (msg?: string) => {
    setNotice(msg ?? null);
    setChosenId(null);
    setPhase('select');
  };

  // Un toque a menos de 150 m selecciona una parada. Fuera de ese radio fija un destino libre.
  const pickNear = (p: Position) => {
    const near = destinations
      .filter((d) => d.id !== 'custom')
      .map((d) => ({ d, m: Math.hypot(d.position.x_m - p.x_m, d.position.y_m - p.y_m) }))
      .sort((a, b) => a.m - b.m)[0];
    setNotice(null);
    if (near && near.m < 150) return setChosenId(near.d.id);
    setCustom(p);
    setChosenId('custom');
  };

  const status = legRoute ? (ROUTE_STATUS[legRoute.status] ?? ROUTE_STATUS.unknown) : null;
  const legSummary = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {status && <span className={`chip ${status.cls}`}>{status.label}</span>}
      {legRoute && (
        <span className="text-space-200">
          {fmtDuration(legRoute.duration_min)} · {fmtDistance(legRoute.distance_m)}
        </span>
      )}
      {routeNote && <span className="text-xs text-space-300">{routeNote}</span>}
    </span>
  );

  // Para llegar al destino, el modelo usa minutos de marcha como consumo de O₂.
  const o2Left = legRoute?.duration_min == null ? null : o2 - legRoute.duration_min;
  const pin = {
    position: dest.position,
    content: (
      <div className="hud w-60 space-y-2 p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 font-medium text-space-50">{dest.title.split(' — ')[0]}</p>
          {status && <span className={`chip shrink-0 ${status.cls}`}>{status.label}</span>}
        </div>
        {legRoute ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
            <dt className="text-space-300">Camino</dt>
            <dd className="text-right text-space-50">
              {fmtDuration(legRoute.duration_min)} · {fmtDistance(legRoute.distance_m)}
            </dd>
            <dt className="text-space-300">Oxígeno al llegar</dt>
            <dd className={`text-right font-medium ${o2Left !== null && o2Left < reserve ? 'text-alert-400' : 'text-green-400'}`}>
              {fmtDuration(o2Left)}
            </dd>
            <dt className="text-space-300">Reserva</dt>
            <dd className="text-right text-space-50">{fmtDuration(reserve)}</dd>
          </dl>
        ) : (
          <p className="text-xs text-space-300">{routeNote}</p>
        )}
      </div>
    ),
  };

  const map2d = (picker = false) => (
    <MarsMap
      manifest={manifest}
      objectives={pkg.objectives}
      selectedObjectiveIds={objective ? [objective.objective_id] : []}
      basePosition={mission.return_position}
      layerState={layerState}
      route={shownRoute}
      focus={[here, dest.position, ...shownRoute.path]}
      onMapClick={picker ? pickNear : undefined}
      here={here}
      failedPaths={failedPaths}
      pin={picker ? pin : null}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      <div
        className="absolute inset-0"
        // El ratón controla el rumbo mientras no se arrastra la cámara.
        onPointerDown={() => {
          setMouseLook(null);
          setMousePitch(null);
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || e.buttons !== 0 || compass.enabled || !view3d) return;
          const x = e.clientX / e.currentTarget.clientWidth - 0.5;
          setMouseLook(Math.round(norm360(bearing + x * 360)));
          const y = e.clientY / e.currentTarget.clientHeight;
          setMousePitch(1.45 - y * 1.0);
        }}
      >
        {view3d && manifest.terrain ? (
          <ErrorBoundary fallback={map2d()}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm">Cargando terreno 3D…</p>}>
              <Terrain3D
                manifest={manifest}
                terrain={manifest.terrain}
                route={shownRoute}
                base={mission.return_position}
                objectives={pkg.objectives}
                targetId={objective?.objective_id ?? null}
                here={here}
                destination={dest.position}
                onHeading={setHeading}
                lookHeading={lookHeading}
                lookPitch={compass.enabled ? null : mousePitch}
                onError={on3dError}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d()
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col gap-2 sm:inset-x-3 sm:top-3">
        {/* Las columnas laterales simétricas mantienen centrado el compás. */}
        <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1 md:grid-cols-[1fr_minmax(0,300px)_1fr]">
          <PositionCard frame={manifest.frame} here={here} label={hereLabel} online={online} />
          {!picking && phase !== 'confirm' && (
            <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
              <CompassTape heading={view3d ? heading : null} bearing={bearing} />
            </div>
          )}
          {((hasCompass && view3d) || queue.length > 0) && (
            <div className="hud pointer-events-auto col-start-2 row-start-1 flex min-h-10 items-center gap-2 justify-self-end px-2 py-1 text-xs md:col-start-3">
              {hasCompass && view3d && (
                <button
                  type="button"
                  className={`flex size-8 items-center justify-center rounded-full transition-colors ${compass.enabled ? 'bg-primary-600 text-white' : 'text-space-200 hover:bg-white/10'}`}
                  aria-pressed={compass.enabled}
                  aria-label="Orientar la vista con la brújula del dispositivo"
                  onClick={async () => {
                    if (compass.enabled) compass.disable();
                    else if (!(await compass.enable())) setNotice('Sin permiso de brújula.');
                  }}
                >
                  <Icon name="compass" size={20} className={compass.enabled && compass.heading === null ? 'animate-pulse' : ''} />
                </button>
              )}
              {queue.length > 0 && <span className="px-1 text-space-300">{queue.length} sin enviar</span>}
              {online && queue.length > 0 && (
                <button
                  type="button"
                  className="rounded-full px-3 py-1 font-medium text-primary-200 hover:bg-white/10"
                  onClick={async () => setNotice(await sendQueue(mission, queue, setMission, setQueue))}
                >
                  Enviar
                </button>
              )}
            </div>
          )}
        </div>

        {alerts.length > 0 && (
          <div role="alert" className="mx-auto flex max-w-md items-center gap-2 rounded-full bg-alert-600/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur">
            <Icon name="warning" size={16} />
            {alerts[0]}
            {alerts.length > 1 && <span className="font-normal opacity-80"> (+{alerts.length - 1})</span>}
          </div>
        )}
      </div>

      {!picking && phase !== 'confirm' && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex items-end gap-2 sm:inset-x-3 sm:bottom-3">
          <button
            type="button"
            className="group pointer-events-auto relative aspect-square w-28 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-primary-300 sm:w-44 lg:w-52"
            aria-label="Abrir mapa para elegir destino y verificar ruta"
            onClick={() => {
              setNotice(null);
              setPicking(true);
            }}
          >
            <Radar
              center={here}
              target={dest.position}
              base={mission.return_position}
              path={shownRoute.path}
              hazards={manifest.hazards ?? []}
              heading={view3d ? heading : null}
              imagery={imagery}
              unknownZones={manifest.terrain?.quality_zones?.filter((z) => z.quality === 'unknown')}
              failedPaths={failedPaths}
            />
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 flex size-8 items-center justify-center rounded-full bg-primary-600 text-white shadow-md group-hover:bg-primary-500"
            >
              <Icon name="expand" size={16} />
            </span>
          </button>

          <section className="hud pointer-events-auto ml-auto w-full min-w-0 space-y-3 p-4 sm:max-w-md">
            <div className="flex items-center gap-3 text-xs" title="En rojo, la reserva para volver">
              <span className="text-space-300">Oxígeno</span>
              <span className="font-medium text-space-50">{fmtDuration(o2)}</span>
              <div
                className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-primary-950"
                role="img"
                aria-label={`Reserva de retorno ${reserve} de ${o2} minutos de O₂`}
              >
                <div className="bg-alert-600" style={{ width: `${reservePct}%` }} />
                <div className="flex-1 bg-primary-500" />
              </div>
              <span className="text-alert-300">Reserva {fmtDuration(reserve)}</span>
            </div>

            {total > 0 && (
              <div className="flex items-center gap-2 text-xs text-space-300">
                <span className="flex gap-1" aria-hidden>
                  {mission.objective_ids.map((id) => (
                    <span
                      key={id}
                      className={`h-1.5 w-5 rounded-full ${mission.completed_objective_ids.includes(id) ? 'bg-green-400' : 'bg-white/15'}`}
                    />
                  ))}
                </span>
                {done === total ? 'Objetivos completados: vuelve a la base' : `${done} de ${total} objetivos completados`}
              </div>
            )}

            {phase === 'select' && (
              <div className="space-y-1">
                <p className="text-xs text-space-400">Destino</p>
                <p className="truncate text-lg font-medium text-space-50">{dest.title.split(' — ')[0]}</p>
                {legSummary}
              </div>
            )}

            {phase === 'navigate' && legRoute && (
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs text-space-400">Rumbo a</p>
                  <p className="truncate text-lg font-medium text-space-50">{dest.title.split(' — ')[0]}</p>
                  {legSummary}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary-200">
                      Perfil del camino
                      {legRoute.warnings.length > 0 && (
                        <span className="text-amber-300">
                          {' '}
                          · {legRoute.warnings.length === 1 ? '1 aviso' : `${legRoute.warnings.length} avisos`}
                        </span>
                      )}
                    </summary>
                    <div className="mt-2">
                      <ElevationProfile path={legRoute.path} datum={manifest.terrain?.vertical_datum} />
                    </div>
                    {legRoute.warnings.map((w) => (
                      <p key={w} className="mt-1 text-amber-300">
                        {warningText(w)}
                      </p>
                    ))}
                  </details>
                </div>
                <button type="button" className={`${bigButton} shrink-0 bg-green-700 text-white`} onClick={() => setPhase('arrived')}>
                  Llegué
                </button>
              </div>
            )}

            {phase === 'arrived' && dest.id === 'custom' && (
              // Llegar a un destino libre no actualiza la posición de misión.
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">En el punto marcado</p>
                <button
                  type="button"
                  className={`${bigButton} bg-primary-600 text-white`}
                  onClick={() => {
                    setCustom(null);
                    backToSelect();
                  }}
                >
                  Listo
                </button>
              </div>
            )}
            {phase === 'arrived' &&
              dest.id !== 'custom' &&
              (objective ? (
                <FindingPad
                  photo={pkg.photos.find((p) => p.objective_id === objective.objective_id)}
                  onBack={() => setPhase('navigate')}
                  mission={mission}
                  objective={objective}
                  onMission={setMission}
                  onQueue={(o) => setQueue((q) => [...q, o])}
                  onDone={backToSelect}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">En base</p>
                  <button
                    type="button"
                    className={`${bigButton} bg-primary-600 text-white`}
                    onClick={async () => {
                      // Si cambió la versión, la mutación recarga el estado antes de cerrar.
                      if (pending.length === 0 && mission.lifecycle_status !== 'completed') {
                        const err = await mutateMission(
                          mission.mission_id,
                          () => marsApi.completeMission(mission.mission_id, mission.mission_version, mission.return_position),
                          setMission,
                        );
                        if (err) return setNotice(err);
                      }
                      backToSelect(pending.length === 0 ? 'Caminata completada' : undefined);
                    }}
                  >
                    Listo
                  </button>
                </div>
              ))}

            {notice && (
              <p role="status" className="text-xs text-primary-200">
                {notice}
              </p>
            )}
          </section>
        </div>
      )}

      {picking && phase !== 'confirm' && (
        <div role="dialog" aria-modal="true" aria-label="Elegir destino" className="absolute inset-0 z-20 flex flex-col bg-space-950 lg:flex-row">
          <aside className="order-2 flex max-h-[60dvh] flex-col border-white/10 bg-space-950 lg:order-1 lg:max-h-none lg:w-80 lg:border-r">
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <p className="text-lg font-medium text-space-50">¿A dónde vas?</p>
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-full text-space-200 hover:bg-white/10"
                aria-label="Cerrar mapa"
                onClick={() => setPicking(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
              <p className="text-xs text-space-400">Elige un destino de la lista o toca cualquier punto del mapa.</p>
              <DestinationPicker
                destinations={[...destinations, ...unreachable]}
                selectedId={dest.id}
                here={here}
                letters={letters}
                onSelect={(id) => {
                  setNotice(null);
                  setChosenId(id);
                }}
              />
              <section className="space-y-3 rounded-[var(--radius-card)] border border-white/10 bg-space-900/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[26px] leading-tight font-medium text-space-50">
                      {legRoute ? fmtDuration(legRoute.duration_min) : '—'}
                    </p>
                    <p className="text-sm text-space-400">
                      {legRoute ? `${fmtDistance(legRoute.distance_m)} hasta ${dest.title.split(' — ')[0]}` : routeNote}
                    </p>
                  </div>
                  {status && <span className={`chip mt-1 ${status.cls}`}>{status.label}</span>}
                </div>
                {legRoute && (
                  <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-sm">
                    <div>
                      <dt className="text-xs text-space-400">Oxígeno al llegar</dt>
                      <dd className={`font-medium ${o2Left !== null && o2Left < reserve ? 'text-alert-400' : 'text-space-50'}`}>
                        {fmtDuration(o2Left)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-space-400">Ascenso</dt>
                      <dd className="font-medium text-space-50">{legRoute.ascent_m == null ? 'Sin dato' : `${Math.round(legRoute.ascent_m)} m`}</dd>
                    </div>
                  </dl>
                )}
              </section>
            </div>
            <div className="border-t border-white/10 p-4">
              <button
                type="button"
                disabled={!legRoute}
                className="btn-primary min-h-12 w-full text-base"
                onClick={() => setPhase('confirm')}
              >
                Verificar ruta
              </button>
            </div>
          </aside>
          <div className="relative order-1 min-h-0 flex-1 lg:order-2">{map2d(true)}</div>
        </div>
      )}

      {phase === 'confirm' && legRoute && (
        <ResourceCheck
          route={legRoute}
          resources={mission.resources}
          targetTitle={dest.title}
          onConfirm={() => {
            setPicking(false);
            setPhase('navigate');
          }}
          onCancel={() => setPhase('select')}
        />
      )}
    </div>
  );
}
