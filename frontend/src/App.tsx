import { useEffect, useState } from 'react';
import mapteLogo from '../../Mapte-logo.svg';
import type { Mission } from './shared/types/contracts';
import MissionControl from './features/mission-control/MissionControl';
import OfflineBar from './features/offline-sync/OfflineBar';
import { isNewerMission, loadPackage, updatePackageMission, usePackageUpdates, usePendingQueue } from './features/offline-sync/offline';

export default function App() {
  const [mission, setMission] = useState<Mission | null>(() => loadPackage()?.mission ?? null);
  const [queue, setQueue] = usePendingQueue();

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  usePackageUpdates((pkg) => setMission((m) => (m?.mission_id === pkg.mission.mission_id && isNewerMission(m, pkg.mission) ? pkg.mission : m)));

  return (
    <div className="flex h-dvh flex-col bg-space-950 text-space-100">
      <header className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 border-b border-space-800 bg-space-900 px-4 sm:px-6">
        <svg role="img" aria-label="Mapte" className="shrink-0 mix-blend-lighten" width="176" height="48" viewBox="440 185 1320 360">
          <image href={mapteLogo} width="2172" height="724" />
        </svg>
        <div className="ml-auto py-2">
          <OfflineBar mission={mission} onMission={setMission} queue={queue} setQueue={setQueue} />
        </div>
      </header>
      {/* En pantallas grandes, cada panel controla su propio desplazamiento. */}
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <MissionControl mission={mission} onMission={setMission} />
      </div>
    </div>
  );
}
