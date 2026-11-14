import { useEffect, useState } from 'react';
import type { Mission } from './shared/types/contracts';
import MissionControl from './features/mission-control/MissionControl';
import Explorer from './features/explorer/Explorer';
import OfflineBar from './features/offline-sync/OfflineBar';
import { loadPackage, updatePackageMission, usePendingQueue } from './features/offline-sync/offline';

type View = 'control' | 'explorer';

export default function App() {
  // Si hay paquete local, la misión arranca desde ahí (permite abrir la app sin red)
  const [mission, setMission] = useState<Mission | null>(() => loadPackage()?.mission ?? null);
  const [view, setView] = useState<View>(() => (navigator.onLine ? 'control' : 'explorer'));
  const [queue, setQueue] = usePendingQueue();

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  const tab = (v: View, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => setView(v)}
      className={view === v ? 'btn-primary' : 'btn-ghost'}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-2 py-2 sm:px-3">
        <nav className="flex gap-2" aria-label="Vistas">
          {tab('control', 'Mission Control')}
          {tab('explorer', 'Explorer', !mission)}
        </nav>
        {mission && (
          <span className="hidden text-xs text-neutral-400 lg:inline">
            {mission.mission_id} · v{mission.version} · {mission.status}
          </span>
        )}
        <div className="ml-auto">
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