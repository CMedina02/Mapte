import { useEffect, useState } from 'react';
import type { Mission } from '../../shared/types/contracts';
import { fmt } from '../../shared/format';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState } from '../mars-map/mapUtils';
import { loadPackage, sendQueue, updatePackageMission, useOnline, usePendingQueue } from '../offline-sync/offline';
import ResourceCheck from './ResourceCheck';
import FindingPad from './FindingPad';

type Phase = 'select' | 'confirm' | 'navigate' | 'arrived';

const panel = 'hud';
const bigButton = 'btn min-h-14 px-5 text-base sm:text-lg';

export default function Visor() {
  const [pkg] = useState(loadPackage);
  const [mission, setMission] = useState<Mission | null>(() => pkg?.mission ?? null);
  const [layerState] = useState(() => (pkg ? initialLayerState(pkg.region_manifest.layers) : {}));
  const [phase, setPhase] = useState<Phase>('select');
  const [notice, setNotice] = useState<string | null>(null);
  const [queue, setQueue] = usePendingQueue();
  const online = useOnline();

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  if (!pkg || !mission) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black p-6 text-center text-orange-300">
        <p>
          Sin paquete de misión.
          <br />
          Transfiérelo desde el panel de control.
        </p>
      </div>
    );
  }

  const target = pkg.objectives.find((o) => o.objective_id === mission.next_objective_id) ?? null;
  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
  const reservePct = o2 > 0 ? Math.min(100, (reserve / o2) * 100) : 100;

  return (
    <div className="flex h-dvh flex-col gap-2 bg-black p-2 text-orange-300 sm:gap-3 sm:p-3">
      <header className={`${panel} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs tracking-widest uppercase sm:px-4`}>
        <span>
          Nav · {mission.mission_id} · v{mission.version}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {queue.length > 0 && <span>{queue.length} pendiente(s) ·</span>}
          {online && queue.length > 0 && (
            <button
              type="button"
              className="btn min-h-9 border border-sky-500 px-2 py-1 text-xs text-sky-300"
              onClick={async () => setNotice(await sendQueue(mission, queue, setMission, setQueue))}
            >
              Enviar pendientes
            </button>
          )}
          <span>{online ? '● Enlace' : '● Sin enlace (paquete local)'}</span>
        </span>
      </header>

      {mission.alerts.length > 0 && (
        <div role="alert" className="rounded-md border border-red-500 bg-red-950/90 px-3 py-2 text-sm font-bold text-red-200 sm:px-4">
          ⚠ {mission.alerts.join(' · ')}
        </div>
      )}

      <main className={`${panel} relative min-h-0 flex-1 overflow-hidden`}>
        <MarsMap
          manifest={pkg.region_manifest}
          objectives={pkg.objectives}
          selectedObjectiveIds={target ? [target.objective_id] : []}
          basePosition={mission.base_position}
          layerState={layerState}
          route={mission.route}
          focus={[mission.base_position, ...mission.route.path]}
        />
        {phase === 'confirm' && target && (
          <ResourceCheck
            mission={mission}
            targetTitle={target.title}
            onConfirm={() => setPhase('navigate')} // ponytail: local hasta que exista el endpoint de navegación
            onCancel={() => setPhase('select')}
          />
        )}
      </main>

      <footer className={`${panel} space-y-3 p-3 sm:p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs sm:flex-nowrap sm:text-sm">
          <span>O₂ {fmt(o2, 'min')}</span>
          <div
            className="order-last flex h-3 basis-full overflow-hidden rounded bg-orange-950 sm:order-none sm:flex-1 sm:basis-auto"
            role="img"
            aria-label={`Reserva de retorno ${reserve} de ${o2} minutos de O₂`}
            title="Rojo: reserva de retorno"
          >
            <div className="bg-red-600" style={{ width: `${reservePct}%` }} />
            <div className="flex-1 bg-orange-500" />
          </div>
          <span>Reserva {fmt(reserve, 'min')}</span>
        </div>

        {phase === 'select' &&
          (target ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase text-orange-500">Siguiente destino</p>
                <p className="text-lg font-bold">{target.title}</p>
              </div>
              <button
                type="button"
                className={`${bigButton} w-full bg-sky-600 text-white sm:w-auto`}
                onClick={() => {
                  setNotice(null);
                  setPhase('confirm');
                }}
              >
                Verificar ruta
              </button>
            </div>
          ) : (
            <p className="text-lg">Sin destinos pendientes. Regresa a la base.</p>
          ))}

        {phase === 'navigate' && target && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase text-orange-500">Navegando a</p>
              <p className="text-lg font-bold">{target.title}</p>
              {/* ponytail: distancia total de la ruta; la restante llega con la posición del astronauta */}
              <p className="text-sm">
                Distancia: {fmt(mission.route.distance_m, 'm')} · Tiempo: {fmt(mission.route.duration_min, 'min')}
              </p>
              {mission.route.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-300">
                  ⚠ {w}
                </p>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button type="button" className={`${bigButton} border border-orange-500`} onClick={() => setPhase('select')}>
                Cancelar
              </button>
              <button type="button" className={`${bigButton} bg-green-700 text-white`} onClick={() => setPhase('arrived')}>
                Llegué
              </button>
            </div>
          </div>
        )}

        {phase === 'arrived' && target && (
          <FindingPad
            onBack={() => setPhase('navigate')}
            mission={mission}
            objective={target}
            onMission={setMission}
            onQueue={(o) => setQueue((q) => [...q, o])}
            onDone={(msg) => {
              setNotice(msg);
              setPhase('select');
            }}
          />
        )}

        {notice && (
          <p role="status" className="text-sm text-sky-300">
            {notice}
          </p>
        )}
      </footer>
    </div>
  );
}