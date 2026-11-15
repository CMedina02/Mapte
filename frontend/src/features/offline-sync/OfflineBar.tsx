import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission } from '../../shared/types/contracts';
import { savePackage, sendQueue, useOnline, type PendingObservation } from './offline';

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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const missionId = mission?.mission_id ?? null;
  const version = mission?.mission_version ?? null;

  // El visor recibe el paquete por storage en el mismo navegador y por sondeo entre dispositivos.
  useEffect(() => {
    if (!online || !missionId) return;
    let alive = true;
    marsApi
      .getMissionPackage(missionId)
      .then(async (pkg) => {
        if (!alive) return;
        if (pkg.package_status === 'incomplete') {
          setMsg(`Visor not updated: ${pkg.missing_assets.length} package files missing.`);
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
          setMsg(`Visor not updated: ${failed} resources failed to download.`);
          return;
        }
        savePackage(pkg);
        setMsg(null);
      })
      .catch((e: unknown) => alive && setMsg(`Visor not updated: ${e instanceof Error ? e.message : String(e)}`));
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

      {/* Solo lo que pide atención: sin conexión. 'En línea' y 'visor al día' son el estado normal. */}
      {!online && <span className={`${badge} bg-amber-900 text-amber-300`}>Offline</span>}

      {queue.length > 0 && (
        <span className={`${badge} bg-primary-900 text-primary-300`}>{queue.length} unsent</span>
      )}

      {online && queue.length > 0 && (
        <button type="button" className={action} onClick={sync} disabled={busy}>
          Sync
        </button>
      )}
    </div>
  );
}
