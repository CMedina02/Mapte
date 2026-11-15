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

  // Pestañas estilo Material: texto azul y barra inferior redondeada en la activa
  const tab = (v: View, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => setView(v)}
      className={`relative flex min-h-14 items-center px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        view === v ? 'text-primary-600' : 'text-space-400 enabled:hover:text-space-100'
      }`}
    >
      {label}
      {view === v && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary-600" />}
    </button>
  );

  return (
    <div className="flex h-dvh flex-col bg-space-950 text-space-100">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-space-800 bg-space-900 px-4 sm:px-6">
        <p className="flex items-center gap-2 text-[22px] font-medium tracking-tight text-space-50">
          <span className="size-3 rounded-full bg-primary-600" aria-hidden />
          Mapte
        </p>
        <nav className="flex self-stretch" aria-label="Vistas">
          {tab('control', 'Control de misión')}
          {tab('explorer', 'Explorador', !mission)}
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
