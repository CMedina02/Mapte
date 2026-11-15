// /sim — demo automática: al entrar, el backend crea la caminata simulada y el visor la reproduce.
// El astronauta sigue la ruta A*, se desvía a propósito y el backend avisa y recalcula. El cliente
// solo interpola la posición entre dos respuestas para que el 3D se vea fluido; no calcula nada.
//
// Parámetros opcionales: ?speed=120 (×tiempo, máx. 600), ?side=left|right, ?at=0.4 (fracción de la ruta), ?deviate=0
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Objective, Position, RegionManifest } from '../../shared/types/contracts';
import { marsApi } from '../../shared/api/client';
import { simApi, type SimAction, type SimCreate, type SimState } from '../../shared/api/sim';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState } from '../mars-map/mapUtils';
import ErrorBoundary from '../../shared/ui/ErrorBoundary';

const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

const STEP_MS = 500; // un paso del backend cada medio segundo real (avisos y recálculos no se pisan)
const TICK_MS = 50; // refresco de la posición interpolada
const ALERT_MS = 5000; // cuánto queda visible un aviso de recálculo o llegada

function requestFromUrl(): SimCreate {
  const q = new URLSearchParams(location.search);
  const num = (k: string) => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const side = q.get('side');
  return {
    speed_factor: num('speed'),
    deviation:
      q.get('deviate') === '0'
        ? null
        : { at_fraction: num('at'), side: side === 'left' || side === 'right' ? side : undefined },
  };
}

const lerp = (a: Position, b: Position, u: number): Position => ({
  x_m: a.x_m + (b.x_m - a.x_m) * u,
  y_m: a.y_m + (b.y_m - a.y_m) * u,
  z_m: a.z_m != null && b.z_m != null ? a.z_m + (b.z_m - a.z_m) * u : b.z_m,
  frame_id: b.frame_id,
});

const STATUS_LABEL: Record<SimState['status'], string> = {
  following: 'En ruta',
  drifting: 'Fuera de ruta',
  arrived: 'Llegó al destino',
  stopped: 'Detenido',
};

const ALERT_STYLE: Record<Exclude<SimAction, 'none'>, string> = {
  warn: 'border-amber-500 bg-amber-950/90 text-amber-200',
  rerouted: 'border-alert-500 bg-alert-950/90 text-alert-200',
  stop: 'border-alert-500 bg-alert-950/90 text-alert-200',
  arrived: 'border-green-500 bg-green-950/90 text-green-200',
};

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export default function SimVisor() {
  const [sim, setSim] = useState<SimState | null>(null);
  const [region, setRegion] = useState<{ manifest: RegionManifest; objectives: Objective[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [here, setHere] = useState<Position | null>(null);
  const [alert, setAlert] = useState<{ action: Exclude<SimAction, 'none'>; message: string; until: number } | null>(null);
  const [start, setStart] = useState<Position | null>(null);
  const [use3d, setUse3d] = useState(true);
  const [run, setRun] = useState(0); // incrementar = reiniciar la simulación
  // Tramo de interpolación: de la posición mostrada a la última que dio el backend
  const anim = useRef<{ from: Position; to: Position; at: number } | null>(null);
  const inFlight = useRef(false);

  const show = useCallback((s: SimState) => {
    setSim(s);
    const now = performance.now();
    const shown = anim.current ? lerp(anim.current.from, anim.current.to, Math.min((now - anim.current.at) / STEP_MS, 1)) : s.position;
    anim.current = { from: shown, to: s.position, at: now };
    if (s.action !== 'none') {
      setAlert({ action: s.action, message: s.message, until: s.action === 'warn' ? now + STEP_MS * 1.5 : now + ALERT_MS });
    }
  }, []);

  // Al entrar (o al reiniciar): crear la simulación y cargar el terreno de su región
  useEffect(() => {
    let alive = true;
    let simId: string | null = null;
    simApi
      .create(requestFromUrl())
      .then(async (s) => {
        simId = s.sim_id;
        if (!alive) return;
        setStart(s.position);
        show(s);
        const [manifest, objectives] = await Promise.all([marsApi.getManifest(s.route.region_id), marsApi.getObjectives(s.route.region_id)]);
        if (alive) setRegion({ manifest, objectives });
      })
      .catch((e) => {
        if (alive) setError(`No se pudo iniciar la simulación: ${e instanceof Error ? e.message : e}. ¿Está el backend en :8000?`);
      });
    return () => {
      alive = false;
      if (simId) simApi.remove(simId).catch(() => {});
    };
  }, [run, show]);

  // Bucle automático: un paso cada STEP_MS mientras corre y no ha terminado
  const simId = sim?.sim_id ?? null;
  const finished = sim?.status === 'arrived' || sim?.status === 'stopped';
  const ready = !!region;
  useEffect(() => {
    if (!simId || !running || finished || !ready) return;
    const id = setInterval(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      simApi
        .step(simId, STEP_MS / 1000)
        .then(show)
        .catch((e) => {
          setRunning(false);
          setError(`Se perdió el enlace con el backend: ${e instanceof Error ? e.message : e}`);
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [simId, running, finished, ready, show]);

  // Posición mostrada: interpolación lineal entre respuestas (solo visual)
  useEffect(() => {
    const id = setInterval(() => {
      const a = anim.current;
      if (!a) return;
      const u = Math.min((performance.now() - a.at) / STEP_MS, 1);
      setHere((cur) => (u >= 1 && cur && cur.x_m === a.to.x_m && cur.y_m === a.to.y_m ? cur : lerp(a.from, a.to, u)));
      setAlert((al) => (al && performance.now() > al.until ? null : al));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const restart = () => {
    anim.current = null;
    setSim(null);
    setAlert(null);
    setError(null);
    setRunning(true);
    setRun((n) => n + 1);
  };
  const onHeading = useCallback(() => {}, []);
  const on3dError = useCallback(() => setUse3d(false), []);

  if (error && !sim) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-space-950 p-6 text-center text-sm text-space-200">
        <p>{error}</p>
        <button type="button" className="btn-primary" onClick={restart}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!sim || !region || !here) {
    return <div className="flex h-dvh items-center justify-center bg-space-950 text-sm text-space-200">Preparando simulación…</div>;
  }

  const { manifest, objectives } = region;
  const target = objectives.find((o) => Math.hypot(o.position.x_m - sim.destination.x_m, o.position.y_m - sim.destination.y_m) < 15);
  const map2d = (
    <MarsMap
      manifest={manifest}
      objectives={objectives}
      selectedObjectiveIds={target ? [target.objective_id] : []}
      basePosition={start}
      layerState={initialLayerState(manifest.layers)}
      route={sim.route}
      focus={[here, sim.destination, ...sim.route.path]}
      here={here}
    />
  );
  const rerouted = sim.log.filter((e) => e.event_type === 'rerouted').length;

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      <div className="absolute inset-0">
        {use3d && manifest.terrain ? (
          <ErrorBoundary fallback={map2d}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm">Cargando terreno 3D…</p>}>
              <Terrain3D
                manifest={manifest}
                terrain={manifest.terrain}
                route={sim.route}
                base={start}
                objectives={objectives}
                targetId={target?.objective_id ?? null}
                here={here}
                destination={sim.destination}
                onHeading={onHeading}
                lookHeading={Math.round(sim.heading_deg)}
                onError={on3dError}
                follow
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d
        )}
      </div>

      {/* Etiqueta fija: nada simulado se presenta como medido */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
        <p className="rounded-full border border-amber-500 bg-space-950/85 px-4 py-1 text-xs font-bold tracking-widest text-amber-300 uppercase">
          Simulación · terreno y rutas reales, caminata simulada ×{sim.speed_factor}
        </p>
      </div>

      {alert && (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center px-3">
          <p role="alert" className={`rounded-lg border-2 px-5 py-3 text-base font-bold shadow-lg sm:text-lg ${ALERT_STYLE[alert.action]}`}>
            {alert.message}
          </p>
        </div>
      )}

      {/* Estado de la caminata (lo que devuelve el backend) */}
      <section className="absolute top-14 left-3 w-64 rounded-lg border border-space-700 bg-space-950/85 p-3 text-sm backdrop-blur max-sm:hidden">
        <p className={`text-xs font-bold tracking-widest uppercase ${sim.on_route ? 'text-green-400' : 'text-amber-300'}`}>
          {STATUS_LABEL[sim.status]}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-space-300">Destino</dt>
          <dd className="truncate">{target?.title ?? 'Punto marcado'}</dd>
          <dt className="text-space-300">Restante</dt>
          <dd>{sim.remaining_m == null ? 'Recalculando…' : `${Math.round(sim.remaining_m)} m`}</dd>
          <dt className="text-space-300">ETA</dt>
          <dd>{sim.eta_min == null ? '—' : `${Math.round(sim.eta_min)} min`}</dd>
          <dt className="text-space-300">Desvío</dt>
          <dd className={sim.deviation_m >= sim.thresholds.warn_m ? 'font-bold text-amber-300' : ''}>{Math.round(sim.deviation_m)} m</dd>
          <dt className="text-space-300">Rumbo</dt>
          <dd>{Math.round(sim.heading_deg)}°</dd>
          <dt className="text-space-300">Recálculos</dt>
          <dd>{rerouted}</dd>
          <dt className="text-space-300">Tiempo EVA</dt>
          <dd>{clock(sim.t_s)}</dd>
        </dl>
        <p className="mt-2 text-xs text-space-400">
          Aviso a {sim.thresholds.warn_m} m · recálculo a {sim.thresholds.reroute_m} m
        </p>
      </section>

      {/* Bitácora del backend */}
      <section className="absolute bottom-3 left-3 max-h-56 w-80 overflow-y-auto rounded-lg border border-space-700 bg-space-950/85 p-3 text-xs backdrop-blur max-sm:inset-x-3 max-sm:w-auto">
        <p className="mb-1 font-bold tracking-widest text-space-300 uppercase">Bitácora</p>
        <ol className="space-y-1">
          {sim.log.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 font-mono text-space-400">{clock(e.t_s)}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="absolute right-3 bottom-3 flex gap-2">
        {!finished && (
          <button type="button" className="btn-go" onClick={() => setRunning((r) => !r)}>
            {running ? '⏸ Pausa' : '▶ Continuar'}
          </button>
        )}
        <button type="button" className="btn-primary" onClick={restart}>
          ↺ Reiniciar
        </button>
      </div>
      {error && <p className="absolute right-3 bottom-16 max-w-xs rounded bg-alert-950/90 p-2 text-xs text-alert-200">{error}</p>}
    </div>
  );
}
