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
      onClick={() => setView(v)}
      className={`rounded px-4 py-2 disabled:opacity-40 ${view === v ? 'bg-orange-600 font-bold' : 'bg-neutral-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col bg-neutral-950 font-mono text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 p-2">
        {tab('control', 'Mission Control')}
        {tab('explorer', 'Explorer', !mission)}
        {mission && (
          <span className="ml-auto text-xs text-neutral-400">
            {mission.mission_id} · v{mission.version} · {mission.status}
          </span>
        )}
        <OfflineBar mission={mission} onMission={setMission} queue={queue} setQueue={setQueue} />
      </header>
      <div className="min-h-0 flex-1">
        {view === 'explorer' && mission ? (
          <Explorer mission={mission} onMission={setMission} onQueue={(o) => setQueue((q) => [...q, o])} />
        ) : (
          <MissionControl mission={mission} onMission={setMission} />
        )}
      </div>
    </div>
  );
}