import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import type { Mission, MissionPackage, ObservationRequest, Position } from '../../shared/types/contracts';

const PKG_KEY = 'mars.package.v3'; // v3: misión con el contrato versionado del backend (legs, lifecycle_status)
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

export function clearPackage() {
  localStorage.removeItem(PKG_KEY);
}

export function updatePackageMission(m: Mission) {
  const pkg = loadPackage();
  if (pkg?.mission.mission_id !== m.mission_id) return;
  try {
    savePackage({ ...pkg, mission: m });
  } catch (e) {
    console.warn('Could not update the local package', e);
  }
}

export const isNewerMission = (a: Mission | null, b: Mission) =>
  !a || a.mission_id !== b.mission_id || b.mission_version > a.mission_version;

<<<<<<< HEAD
// Otra pestaña (panel ↔ visor) guardó el paquete: el evento 'storage' llega al instante en el mismo navegador.
// ponytail: entre dispositivos distintos lo cubre el sondeo de GET /missions/{id}; WebSocket/SSE si hace falta < 1 s.
export function usePackageUpdates(onPkg: (pkg: MissionPackage | null) => void) {
=======
// storage sincroniza el paquete entre pestañas del mismo navegador.
export function usePackageUpdates(onPkg: (pkg: MissionPackage) => void) {
>>>>>>> aa7575928a95d914c6953b8baa9765203b624df1
  const ref = useRef(onPkg);
  useEffect(() => {
    ref.current = onPkg;
  });
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== PKG_KEY && e.key !== null) return;
      if (!e.newValue) {
        ref.current(null);
        return;
      }
      try {
        ref.current(JSON.parse(e.newValue) as MissionPackage);
      } catch {
        /* paquete corrupto: se ignora */
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
}

export type PendingObservation =Omit<ObservationRequest, 'mission_version'>;

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
      console.warn('Could not save the queue', e);
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

// La cola usa la versión vigente y se detiene en el primer error.
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
      () => marsApi.submitObservation(current.mission_id, { ...item, mission_version: current.mission_version }),
      (m) => {
        current = m;
        onMission(m);
      },
    );
    if (err) return err;
    setQueue((q) => q.slice(1));
  }
  return 'Changes sent';
}

const POS_KEY = 'mars.lastpos.v1';
export function loadLastPosition(): Position | null {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Position | null;
  } catch {
    return null;
  }
}
export const saveLastPosition = (p: Position) => localStorage.setItem(POS_KEY, JSON.stringify(p));
