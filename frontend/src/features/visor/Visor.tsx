import { useEffect, useState } from 'react';
import type { Mission } from '../../shared/types/contracts';
import { fmt } from '../../shared/format';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState } from '../mars-map/mapUtils';
import { loadPackage, updatePackageMission, useOnline, usePendingQueue } from '../offline-sync/offline';
import ResourceCheck from './ResourceCheck';
import FindingPad from './FindingPad';

type Phase = 'select' | 'confirm' | 'navigate' | 'arrived';

const panel = 'rounded border border-orange-500/60 bg-black/80';
const bigButton = 'rounded p-4 text-lg font-bold disabled:opacity-40';

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
      <div className="flex h-screen items-center justify-center bg-black p-6 text-center font-mono text-orange-300">
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
    <div className="flex h-screen flex-col gap-2 bg-black p-2 font-mono text-orange-300">
      <header className={`${panel} flex items-center justify-between px-4 py-2 text-xs uppercase tracking-widest`}>
        <span>
          Nav · {mission.mission_id} · v{mission.version}
        </span>
        <span>
          {queue.length > 0 && `${queue.length} pendiente(s) · `}
          {online ? '● Enlace' : '● Sin enlace (paquete local)'}
        </span>
      </header>

      {mission.alerts.length > 0 && (
        <div role="alert" className="rounded border border-red-500 bg-red-950/90 px-4 py-2 font-bold text-red-200">
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

      <footer className={`${panel} space-y-3 p-4`}>
        <div className="flex items-center gap-3 text-sm">
          <span>O₂ {fmt(o2, 'min')}</span>
          <div className="flex h-3 flex-1 overflow-hidden rounded bg-orange-950" title="Rojo: reserva de retorno">
            <div className="bg-red-600" style={{ width: `${reservePct}%` }} />
            <div className="flex-1 bg-orange-500" />
          </div>
          <span>Reserva {fmt(reserve, 'min')}</span>
        </div>

        {phase === 'select' &&
          (target ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase text-orange-500">Siguiente destino</p>
                <p className="text-lg font-bold">{target.title}</p>
              </div>
              <button
                type="button"
                className={`${bigButton} bg-sky-600 text-white`}
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase text-orange-500">Navegando a</p>
              <p className="text-lg font-bold">{target.title}</p>
              {}
              <p className="text-sm">
                Ruta {fmt(mission.route.distance_m, 'm')} · {fmt(mission.route.duration_min, 'min')}
              </p>
            </div>
            <div className="flex gap-2">
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

        {notice && <p className="text-sm text-sky-300">{notice}</p>}
      </footer>
    </div>
  );
}