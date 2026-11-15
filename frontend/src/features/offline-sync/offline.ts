import { useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import type { Mission, MissionPackage, ObservationRequest } from '../../shared/types/contracts';

const PKG_KEY = 'mars.package.v1';
const QUEUE_KEY = 'mars.pending.v1';

export function loadPackage(): MissionPackage | null {
  try {
    const raw = localStorage.getItem(PKG_KEY);
    return raw ? (JSON.parse(raw) as MissionPackage) : null;
  } catch {
    return null;
  }
}

export function savePackage(pkg: MissionPackage) {
  localStorage.setItem(PKG_KEY, JSON.stringify(pkg));
}

export function updatePackageMission(m: Mission) {
  const pkg = loadPackage();
  if (pkg?.mission.mission_id !== m.mission_id) return;
  try {
    savePackage({ ...pkg, mission: m });
  } catch (e) {
    console.warn('No se pudo actualizar el paquete local', e);
  }
}

export type PendingObservation = Omit<ObservationRequest, 'mission_version'>;

function loadQueue(): PendingObservation[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as PendingObservation[];
  } catch {
    return [];
  }
}

export function usePendingQueue() {
  const [queue, setQueue] = useState<PendingObservation[]>(loadQueue);
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn('No se pudo guardar la cola', e);
    }
  }, [queue]);
  return [queue, setQueue] as const;
}


function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
// ---------- Envío de la cola al reconectar ----------

// Envía las observaciones en orden con la versión vigente. Se detiene en el primer error
// (409 recarga la misión vía mutateMission) y devuelve el mensaje a mostrar.
export async function sendQueue(
  mission: Mission,
  queue: PendingObservation[],
  onMission: (m: Mission) => void,
  setQueue: Dispatch<SetStateAction<PendingObservation[]>>,
): Promise<string> {
  let current = mission;
  for (const item of queue) {
    const err = await mutateMission(
      current.mission_id,
      () => marsApi.submitObservation(current.mission_id, { ...item, mission_version: current.version }),
      (m) => {
        current = m;
        onMission(m);
      },
    );
    if (err) return err;
    setQueue((q) => q.slice(1));
  }
  return 'Cambios sincronizados ✓';
}
