import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import type { Mission, Objective } from '../../shared/types/contracts';
import type { PendingObservation } from '../offline-sync/offline';

interface Props {
  mission: Mission;
  objective: Objective;
  onMission: (m: Mission) => void;
  onQueue: (o: PendingObservation) => void;
  onDone: (message: string) => void;
  onBack: () => void;
}

export default function FindingPad({ mission, objective, onMission, onQueue, onDone, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(code: string) {
    const obs = { objective_id: objective.objective_id, finding_code: code };
    if (!navigator.onLine) {
      onQueue(obs);
      onDone('Sin enlace: hallazgo guardado; se enviará al reconectar.');
      return;
    }
    setBusy(true);
    const err = await mutateMission(
      mission.mission_id,
      () => marsApi.submitObservation(mission.mission_id, { ...obs, mission_version: mission.version }),
      onMission,
    );
    setBusy(false);
    if (err) setError(err);
    else onDone('Hallazgo registrado.');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">¿Qué observas en {objective.title}?</p>
        <button type="button" onClick={onBack} disabled={busy} className="btn min-h-9 border border-primary-500 px-3 py-1 text-primary-300">
          Volver
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        {objective.possible_findings.map((code) => (
          <button
            key={code}
            type="button"
            disabled={busy}
            onClick={() => send(code)}
            className="btn min-h-14 break-all border border-primary-500 bg-primary-950 text-base text-primary-200 sm:text-lg"
          >
            {code}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-alert-400">{error}</p>}
    </div>
  );
}