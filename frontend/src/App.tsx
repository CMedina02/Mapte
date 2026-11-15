import { useEffect, useState } from 'react';
import type { Mission } from './shared/types/contracts';
import MissionControl from './features/mission-control/MissionControl';
import Explorer from './features/explorer/Explorer';
import OfflineBar from './features/offline-sync/OfflineBar';
import { isNewerMission, loadPackage, updatePackageMission, usePackageUpdates, usePendingQueue } from './features/offline-sync/offline';

type View = 'control' | 'explorer';

export default function App() {
  // Si hay paquete local, la misión arranca desde ahí (permite abrir la app sin red)
  const [mission, setMission] = useState<Mission | null>(() => loadPackage()?.mission ?? null);
  const [view, setView] = useState<View>(() => (navigator.onLine ? 'control' : 'explorer'));
  const [queue, setQueue] = usePendingQueue();

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  // Cambios hechos desde el visor (hallazgos, avance) llegan al panel sin recargar
  usePackageUpdates((pkg) => setMission((m) => (m?.mission_id === pkg.mission.mission_id && isNewerMission(m, pkg.mission) ? pkg.mission : m)));

  // Pestaña activa: subrayado rojo NASA, como la navegación de un sitio de misión
  const tab = (v: View, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => setView(v)}
      className={`min-h-11 border-b-2 px-3 text-sm font-semibold tracking-wide uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        view === v ? 'border-alert-500 text-white' : 'border-transparent text-space-300 enabled:hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-dvh flex-col border-t-4 border-alert-500">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-space-800 bg-space-950/80 px-3 backdrop-blur sm:px-4">
        <p className="py-3 text-sm font-bold tracking-[0.2em] text-white uppercase">Mapte</p>
        <nav className="flex gap-1 self-stretch" aria-label="Vistas">
          {tab('control', 'Mission Control')}
          {tab('explorer', 'Explorer', !mission)}
        </nav>
        <div className="ml-auto py-2">
          <OfflineBar mission={mission} onMission={setMission} queue={queue} setQueue={setQueue} />
        </div>
      </header>
      {/* Hasta lg la vista hace scroll completa; desde lg cada panel gestiona su scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        {view === 'explorer' && mission ? (
          <Explorer mission={mission} onMission={setMission} onQueue={(o) => setQueue((q) => [...q, o])} />
        ) : (
          <MissionControl mission={mission} onMission={setMission} />
        )}
      </div>
    </div>
  );
}
