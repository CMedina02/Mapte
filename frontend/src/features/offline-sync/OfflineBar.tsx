import { useState, type Dispatch, type SetStateAction } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import type { Mission } from '../../shared/types/contracts';
import { loadPackage, savePackage, useOnline, type PendingObservation } from './offline';

interface Props {
  mission: Mission | null;
  onMission: (m: Mission) => void;
  queue: PendingObservation[];
  setQueue: Dispatch<SetStateAction<PendingObservation[]>>;
}

const badge = 'rounded px-2 py-1 text-xs font-bold';
const action = 'rounded bg-neutral-800 px-3 py-1 text-xs disabled:opacity-40';

export default function OfflineBar({ mission, onMission, queue, setQueue }: Props) {
  const online = useOnline();
  const [pkgMissionId, setPkgMissionId] = useState(() => loadPackage()?.mission.mission_id ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const hasPkg = !!mission && pkgMissionId === mission.mission_id;

  async function transfer() {
    if (!mission) return;
    setBusy(true);
    setMsg(null);
    try {
      const pkg = await marsApi.getMissionPackage(mission.mission_id);
      savePackage(pkg);
      await Promise.allSettled(pkg.offline_assets.map((url) => fetch(url)));
      setPkgMissionId(pkg.mission.mission_id);
      onMission(pkg.mission);
      setMsg('Paquete transferido ✓');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    if (!mission) return;
    setBusy(true);
    setMsg(null);
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
      if (err) {
        setMsg(err);
        setBusy(false);
        return;
      }
      setQueue((q) => q.slice(1));
    }
    setMsg('Cambios sincronizados ✓');
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-neutral-400">{msg}</span>}

      {online ? (
        <span className={`${badge} bg-green-900 text-green-300`}>● Online</span>
      ) : (
        <span className={`${badge} ${hasPkg ? 'bg-amber-900 text-amber-300' : 'bg-red-950 text-red-300'}`}>
          ● Offline {hasPkg ? '(Paquete Local)' : '(sin paquete)'}
        </span>
      )}

      {queue.length > 0 && (
        <span className={`${badge} bg-sky-900 text-sky-300`}>● Cambios pendientes ({queue.length})</span>
      )}

      {online && queue.length > 0 && (
        <button type="button" className={action} onClick={sync} disabled={busy}>
          Sincronizar
        </button>
      )}

      {online && mission && (
        <button type="button" className={action} onClick={transfer} disabled={busy}>
          {hasPkg ? 'Actualizar paquete' : 'Transferir paquete'}
        </button>
      )}
    </div>
  );
}