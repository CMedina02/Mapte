import { useEffect, useState } from 'react';
import type { Mission } from './shared/types/contracts';
import MissionControl from './features/mission-control/MissionControl';
import OfflineBar from './features/offline-sync/OfflineBar';
import { isNewerMission, loadPackage, updatePackageMission, usePackageUpdates, usePendingQueue } from './features/offline-sync/offline';

export default function App() {
  // Si hay paquete local, la misión arranca desde ahí (permite abrir la app sin red)
  const [mission, setMission] = useState<Mission | null>(() => loadPackage()?.mission ?? null);
  const [queue, setQueue] = usePendingQueue();

  useEffect(() => {
    if (mission) updatePackageMission(mission);
  }, [mission]);

  // Cambios hechos desde el visor (hallazgos, avance) llegan al panel sin recargar
  usePackageUpdates((pkg) => setMission((m) => (m?.mission_id === pkg.mission.mission_id && isNewerMission(m, pkg.mission) ? pkg.mission : m)));

  return (
    <div className="flex h-dvh flex-col bg-space-950 text-space-100">
      <header className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 border-b border-space-800 bg-space-900 px-4 sm:px-6">
        <p className="flex items-center gap-2 text-[22px] font-medium tracking-tight text-space-50">
          <span className="size-3 rounded-full bg-primary-600" aria-hidden />
          Mapte
        </p>
        <div className="ml-auto py-2">
          <OfflineBar mission={mission} onMission={setMission} queue={queue} setQueue={setQueue} />
        </div>
      </header>
      {/* Hasta lg la vista hace scroll completa; desde lg cada panel gestiona su scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        {/* Hallazgos, notas y avance los registra el astronauta desde su visor */}
        <MissionControl mission={mission} onMission={setMission} />
      </div>
    </div>
  );
}
