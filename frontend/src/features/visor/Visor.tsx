import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Constraints, Mission, MissionPackage, Position, RouteResult } from '../../shared/types/contracts';
import { fmt, ROUTE_STATUS, warningText } from '../../shared/format';
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
import { activeMissionLeg, missionRoute } from '../../shared/mission';

// three.js pesa: se descarga solo al abrir la vista 3D
const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

type Phase = 'select' | 'confirm' | 'navigate' | 'arrived';

// Respaldo para paquetes históricos sin restricciones; los paquetes actuales llevan las del plan.
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

  // En vivo desde el panel de control: el panel guarda el paquete y esta pestaña lo recibe al instante
  usePackageUpdates((p) => {
    setPkg(p);
    setMission((m) => (isNewerMission(m, p.mission) ? p.mission : m));
  });

  // Entre dispositivos (casco ↔ centro de control) no hay evento 'storage': se consulta la misión cada 5 s
  useEffect(() => {
    if (!online || !missionId) return;
    const id = setInterval(() => {
      marsApi
        .getMission(missionId)
        .then((m) => setMission((cur) => (cur?.mission_id === m.mission_id && isNewerMission(cur, m) ? m : cur)))
        .catch(() => {}); // sin enlace: se sigue con el paquete local
    }, 5000);
    return () => clearInterval(id);
  }, [online, missionId]);

  // Sin misión: mapa con la posición del astronauta mientras el panel asigna una
  if (!pkg || !mission) {
    return (
      <IdleVisor
        onPackage={(p) => {
          // El astronauta planificó su propia misión: se guarda como paquete y el visor pasa a navegar
          savePackage(p);
          setPkg(p);
          setMission(p.mission);
        }}
      />
    );
  }
  // key: una misión nueva desde el panel reinicia el flujo del visor (destino, fase)
  return <VisorHud key={mission.mission_id} pkg={pkg} mission={mission} setMission={setMission} />;
}

function VisorHud({ pkg, mission, setMission }: { pkg: MissionPackage; mission: Mission; setMission: (m: Mission) => void }) {
  const manifest = pkg.region_manifest;
  const [layerState] = useState(() => initialLayerState(manifest.layers));
  const [phase, setPhase] = useState<Phase>('select');
  const [notice, setNotice] = useState<string | null>(null);
  // 3D siempre que haya terreno; el 2D a pantalla completa queda solo como respaldo si el 3D falla
  const [view3d, setView3d] = useState(() => !!manifest.terrain);
  const [heading, setHeading] = useState<number | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false); // mapa de selección (se abre tocando el radar)
  const [custom, setCustom] = useState<Position | null>(null); // punto libre que el astronauta marcó en el mapa
  // Hacia dónde mira el astronauta: brújula del dispositivo (casco/brazo) o, en escritorio, la posición del ratón
  const compass = useDeviceCompass();
  const [hasCompass] = useState(compassAvailable);
  const [mouseLook, setMouseLook] = useState<number | null>(null);
  const lookHeading = compass.heading ?? mouseLook;
  const [previews, setPreviews] = useState<Record<string, RouteResult | 'error'>>({});
  const [queue, setQueue] = usePendingQueue();
  const online = useOnline();

  const plannedRoute = missionRoute(mission);
  const activeLeg = activeMissionLeg(mission);
  const here = mission.current_position ?? activeLeg?.path[0] ?? mission.start_position;
  // Se recuerda para mostrarla aunque después no haya misión
  useEffect(() => saveLastPosition(here), [here]);
  const hereLabel = samePlace(here, mission.return_position)
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
      ? [{ id: 'base', title: 'Regresar a base', position: mission.return_position, recommended: pending.length === 0 }]
      : []),
    ...(custom ? [{ id: 'custom', title: 'Punto marcado', position: custom, recommended: false }] : []),
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
          ? 'Sin enlace: se muestra la ruta del plan.'
          : 'Sin enlace: este destino no tiene ruta calculada. Elige el destino del plan o espera al enlace.'
        : null;
  const shownRoute = legRoute ?? plannedRoute;
  const bearing = bearingDeg(here, dest.position);

  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
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

  // Tocar el mapa: cerca (< 150 m) de un objetivo o la base lo elige; en cualquier otro punto, ese punto es el destino
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
      {status && <span className={`chip border ${status.cls}`}>{status.label}</span>}
      {legRoute && (
        <span className="font-mono">
          {fmt(legRoute.distance_m, 'm')} · {fmt(legRoute.duration_min, 'min')}
        </span>
      )}
      {routeNote && <span className="text-xs text-space-300">{routeNote}</span>}
    </span>
  );

  // Globo sobre el destino con los recursos que costaría llegar (métricas del backend; O₂ = minutos de caminata)
  const o2Left = legRoute?.duration_min == null ? null : o2 - legRoute.duration_min;
  const pin = {
    position: dest.position,
    content: (
      <div className="hud w-56 space-y-1.5 p-2 text-xs shadow-lg shadow-black/50">
        <p className="truncate font-bold">{dest.title}</p>
        {status && <span className={`chip border ${status.cls}`}>{status.label}</span>}
        {legRoute ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 font-mono">
            <dt className="text-space-300">Distancia</dt>
            <dd>{fmt(legRoute.distance_m, 'm')}</dd>
            <dt className="text-space-300">O₂ a gastar</dt>
            <dd>{fmt(legRoute.duration_min, 'min')}</dd>
            <dt className="text-space-300">O₂ al llegar</dt>
            <dd className={o2Left !== null && o2Left < reserve ? 'text-alert-400' : 'text-green-400'}>{fmt(o2Left, 'min')}</dd>
            <dt className="text-space-300">Reserva</dt>
            <dd>{fmt(reserve, 'min')}</dd>
          </dl>
        ) : (
          <p className="text-space-300">{routeNote}</p>
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
      pin={picker ? pin : null}
    />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      {/* Mapa a pantalla completa; los instrumentos flotan encima */}
      <div
        className="absolute inset-0"
        // Ratón sin pulsar: el centro de la pantalla mira al destino y cada borde gira 180° hacia su lado.
        // Al arrastrar (inclinar/acercar) el ratón deja de mandar hasta que se suelta.
        onPointerDown={() => setMouseLook(null)}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || e.buttons !== 0 || compass.enabled || !view3d) return;
          const x = e.clientX / e.currentTarget.clientWidth - 0.5;
          setMouseLook(Math.round(norm360(bearing + x * 360)));
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
                onError={on3dError}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d()
        )}
      </div>

      {/* ---------- Franja superior: posición · estado, compás, alertas ---------- */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col gap-2 sm:inset-x-3 sm:top-3">
        {/* md+: 3 columnas iguales a los lados → el compás queda centrado en pantalla, igual que la alerta.
            En móvil el compás baja a su propia línea. */}
        <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-1 md:grid-cols-[1fr_minmax(0,300px)_1fr]">
          <PositionCard frame={manifest.frame} here={here} label={hereLabel} online={online} />
          {!picking && phase !== 'confirm' && (
            <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
              <CompassTape heading={view3d ? heading : null} bearing={bearing} />
            </div>
          )}
          {/* Controles solo cuando hacen falta: brújula del dispositivo y cola sin enviar */}
          {((hasCompass && view3d) || queue.length > 0) && (
            <div className="hud pointer-events-auto col-start-2 row-start-1 flex min-h-9 items-center gap-2 justify-self-end px-2 py-1 text-[11px] tracking-widest uppercase md:col-start-3">
              {hasCompass && view3d && (
                <button
                  type="button"
                  className={`btn min-h-7 border px-2 py-0.5 text-[11px] ${compass.enabled ? 'border-green-500 text-green-300' : 'border-primary-400 text-primary-200'}`}
                  aria-pressed={compass.enabled}
                  aria-label="Orientar la vista con la brújula del dispositivo"
                  onClick={async () => {
                    if (compass.enabled) compass.disable();
                    else if (!(await compass.enable())) setNotice('Sin permiso para usar la brújula del dispositivo.');
                  }}
                >
                  🧭{compass.enabled && compass.heading === null ? '…' : ''}
                </button>
              )}
              {queue.length > 0 && <span>{queue.length} pend.</span>}
              {online && queue.length > 0 && (
                <button
                  type="button"
                  className="btn min-h-7 border border-primary-500 px-2 py-0.5 text-[11px] text-primary-300"
                  onClick={async () => setNotice(await sendQueue(mission, queue, setMission, setQueue))}
                >
                  Enviar
                </button>
              )}
            </div>
          )}
        </div>

        {mission.alerts.length > 0 && (
          <div role="alert" className="mx-auto max-w-md rounded border border-alert-500 bg-alert-950/85 px-2 py-0.5 text-[11px] font-semibold text-alert-100">
            {/* Al astronauta solo la primera alerta; el detalle completo está en el panel de control */}
            ⚠ {warningText(mission.alerts[0])}
            {mission.alerts.length > 1 && <span className="font-normal opacity-80"> (+{mission.alerts.length - 1})</span>}
          </div>
        )}
      </div>

      {/* ---------- Franja inferior: radar (abre el mapa) + panel esencial ---------- */}
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
            />
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 flex size-7 items-center justify-center rounded-full border border-primary-400 bg-primary-700 text-sm text-white group-hover:bg-primary-600"
            >
              ⤢
            </span>
          </button>

          <section className="hud pointer-events-auto ml-auto w-full min-w-0 space-y-2 p-3 backdrop-blur-sm sm:max-w-md">
            <div className="flex items-center gap-2 text-[11px]" title="Rojo: reserva de retorno">
              <span className="font-mono">O₂ {fmt(o2, 'min')}</span>
              <div
                className="flex h-2 flex-1 overflow-hidden rounded bg-primary-950"
                role="img"
                aria-label={`Reserva de retorno ${reserve} de ${o2} minutos de O₂`}
              >
                <div className="bg-alert-600" style={{ width: `${reservePct}%` }} />
                <div className="flex-1 bg-primary-500" />
              </div>
              <span className="font-mono text-alert-300">Res. {fmt(reserve, 'min')}</span>
            </div>

            {phase === 'select' && (
              <div className="space-y-1">
                <p className="truncate font-bold">
                  <span className="eyebrow mr-2">Destino</span>
                  {dest.title}
                </p>
                {legSummary}
              </div>
            )}

            {phase === 'navigate' && legRoute && (
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="eyebrow">Navegando a</p>
                  <p className="truncate font-bold">{dest.title}</p>
                  {legSummary}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary-200">
                      Perfil
                      {legRoute.warnings.length > 0 && <span className="text-amber-300"> · ⚠ {legRoute.warnings.length} aviso(s)</span>}
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
              // ponytail: la posición no se mueve hasta que el backend acepte posiciones libres en /progress
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">Llegaste al punto marcado.</p>
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
                  onBack={() => setPhase('navigate')}
                  mission={mission}
                  objective={objective}
                  onMission={setMission}
                  onQueue={(o) => setQueue((q) => [...q, o])}
                  onDone={backToSelect}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">Llegaste a la base.</p>
                  <button
                    type="button"
                    className={`${bigButton} bg-primary-600 text-white`}
                    onClick={async () => {
                      // Sin objetivos pendientes: la EVA termina y se cierra la misión (si la versión cambió, se recarga)
                      if (pending.length === 0 && mission.lifecycle_status !== 'completed') {
                        const err = await mutateMission(
                          mission.mission_id,
                          () => marsApi.completeMission(mission.mission_id, mission.mission_version, mission.return_position),
                          setMission,
                        );
                        if (err) return setNotice(err);
                      }
                      backToSelect(pending.length === 0 ? 'EVA completada ✓' : undefined);
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

      {/* ---------- Mapa de selección: elegir destino y verificar ruta ---------- */}
      {picking && phase !== 'confirm' && (
        <div role="dialog" aria-modal="true" aria-label="Elegir destino" className="absolute inset-0 z-20 flex flex-col bg-space-950 lg:flex-row">
          <div className="relative min-h-0 flex-1">{map2d(true)}</div>
          <aside className="hud m-2 space-y-3 p-3 sm:p-4 lg:w-96 lg:self-end">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">¿A dónde vas? · toca un punto o elige</p>
              <button type="button" className="btn min-h-9 px-3 text-lg" aria-label="Cerrar mapa" onClick={() => setPicking(false)}>
                ✕
              </button>
            </div>
            <DestinationPicker
              destinations={destinations}
              selectedId={dest.id}
              here={here}
              onSelect={(id) => {
                setNotice(null);
                setChosenId(id);
              }}
            />
            {legSummary}
            <button
              type="button"
              disabled={!legRoute}
              className={`${bigButton} w-full bg-primary-600 text-white enabled:hover:bg-primary-500`}
              onClick={() => setPhase('confirm')}
            >
              Verificar ruta
            </button>
          </aside>
        </div>
      )}

      {phase === 'confirm' && legRoute && (
        <ResourceCheck
          route={legRoute}
          resources={mission.resources}
          targetTitle={dest.title}
          onConfirm={() => {
            setPicking(false);
            setPhase('navigate'); // ponytail: local hasta que exista el endpoint de navegación
          }}
          onCancel={() => setPhase('select')}
        />
      )}
    </div>
  );
}
