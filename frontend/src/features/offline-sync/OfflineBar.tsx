import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission } from '../../shared/types/contracts';
import { loadPackage, savePackage, sendQueue, useOnline, type PendingObservation } from './offline';

interface Props {
  mission: Mission | null;
  onMission: (m: Mission) => void;
  queue: PendingObservation[];
  setQueue: Dispatch<SetStateAction<PendingObservation[]>>;
}

const badge = 'chip';
const action = 'btn-ghost min-h-9 px-3 py-1 text-xs';

export default function OfflineBar({ mission, onMission, queue, setQueue }: Props) {
  const online = useOnline();
  const [synced, setSynced] = useState(() => {
    const m = loadPackage()?.mission;
    return m ? { id: m.mission_id, version: m.mission_version } : null;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const missionId = mission?.mission_id ?? null;
  const version = mission?.mission_version ?? null;
  const hasPkg = !!mission && synced?.id === mission.mission_id;
  const upToDate = hasPkg && synced?.version === version;

  // Transferencia automática al visor: cada misión nueva o versión nueva se empaqueta sin pulsar nada.
  // El visor (otra pestaña) recibe el cambio por el evento 'storage'; en otro dispositivo, por sondeo.
  useEffect(() => {
    if (!online || !missionId) return;
    let alive = true;
    marsApi
      .getMissionPackage(missionId)
      .then(async (pkg) => {
        if (!alive) return;
        if (pkg.package_status === 'incomplete') {
          setMsg(`Visor sin actualizar: faltan ${pkg.missing_assets.length} archivos del paquete.`);
          return;
        }
        const downloads = await Promise.allSettled(
          pkg.offline_assets.map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`${response.status} ${url}`);
          }),
        );
        if (!alive) return;
        const failed = downloads.filter((item) => item.status === 'rejected').length;
        if (failed > 0) {
          setMsg(`Visor sin actualizar: falló la descarga de ${failed} recursos.`);
          return;
        }
        savePackage(pkg);
        setSynced({ id: pkg.mission.mission_id, version: pkg.mission.mission_version });
        setMsg(null);
      })
      .catch((e: unknown) => alive && setMsg(`Visor sin actualizar: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      alive = false;
    };
  }, [online, missionId, version]);

  async function sync() {
    if (!mission) return;
    setBusy(true);
    setMsg(await sendQueue(mission, queue, onMission, setQueue));
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {msg && (
        <span role="status" className="text-xs text-space-300">
          {msg}
        </span>
      )}

      {online ? (
        <span className={`${badge} bg-green-900 text-green-300`}>● Online</span>
      ) : (
        <span className={`${badge} ${hasPkg ? 'bg-amber-900 text-amber-300' : 'bg-alert-950 text-alert-300'}`}>
          ● Offline {hasPkg ? '(Paquete Local)' : '(sin paquete)'}
        </span>
      )}

      {mission && (
        <span className={`${badge} ${upToDate ? 'bg-primary-900 text-primary-200' : 'bg-space-800 text-space-300'}`} title="Paquete que usa el visor del astronauta">
          Visor {upToDate ? 'al día' : 'sincronizando…'}
        </span>
      )}

      {queue.length > 0 && (
        <span className={`${badge} bg-primary-900 text-primary-300`}>● Cambios pendientes ({queue.length})</span>
      )}

      {online && queue.length > 0 && (
        <button type="button" className={action} onClick={sync} disabled={busy}>
          Sincronizar
        </button>
      )}
    </div>
  );
}
