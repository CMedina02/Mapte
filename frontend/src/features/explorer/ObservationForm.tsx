import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective } from '../../shared/types/contracts';
import type { PendingObservation } from '../offline-sync/offline';
import { mutateMission } from '../../shared/api/mutateMission';

interface Props {
  mission: Mission;
  objectives: Objective[];
  onUpdated: (m: Mission) => void;
  onQueue: (o: PendingObservation) => void;
}

export default function ObservationForm({ mission, objectives, onUpdated, onQueue }: Props) {
  const [objectiveId, setObjectiveId] = useState('');
  const [finding, setFinding] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = objectives.filter(
    (o) => mission.objective_ids.includes(o.objective_id) && !mission.completed_objective_ids.includes(o.objective_id),
  );
  const selectedId = objectiveId || mission.next_objective_id || '';
  const objective = pending.find((o) => o.objective_id === selectedId) ?? null;
  const validFinding = !!objective?.possible_findings.includes(finding);

  async function submit() {
    if (!objective || !validFinding) return;
    if (!navigator.onLine) {
      onQueue({
        objective_id: objective.objective_id,
        finding_code: finding,
        notes: notes.trim() || undefined,
      });
      setObjectiveId('');
      setFinding('');
      setNotes('');
      setError('Sin conexión: observación guardada en cola; se enviará al sincronizar.');
      return;
    }
    setLoading(true);
    const err = await mutateMission(
      mission.mission_id,
      () =>
        marsApi.submitObservation(mission.mission_id, {
          mission_version: mission.version,
          objective_id: objective.objective_id,
          finding_code: finding,
          notes: notes.trim() || undefined,
        }),
      onUpdated,
    );
    setError(err);
    if (!err) {
      setObjectiveId('');
      setFinding('');
      setNotes('');
    }
    setLoading(false);
  }

  if (pending.length === 0) {
    return <section className="rounded border border-neutral-700 p-4">Todos los objetivos completados.</section>;
  }

  return (
    <section className="space-y-3 rounded border border-neutral-700 p-4">
      <p className="text-xs uppercase tracking-widest text-neutral-400">Registrar observación</p>

      <select
        className="w-full rounded bg-neutral-900 p-3"
        value={selectedId}
        onChange={(e) => {
          setObjectiveId(e.target.value);
          setFinding('');
        }}
      >
        <option value="" disabled>
          Elige objetivo…
        </option>
        {pending.map((o) => (
          <option key={o.objective_id} value={o.objective_id}>
            {o.title}
          </option>
        ))}
      </select>

      {objective && (
        <div className="grid grid-cols-2 gap-2">
          {objective.possible_findings.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={finding === code}
              onClick={() => setFinding(code)}
              className={`rounded p-3 text-sm ${finding === code ? 'bg-orange-600 font-bold' : 'bg-neutral-800'}`}
            >
              {code}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="w-full rounded bg-neutral-900 p-3 text-sm"
        rows={3}
        maxLength={1000}
        placeholder="Notas (opcional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!validFinding || loading}
        className="w-full rounded bg-orange-600 p-3 font-bold disabled:opacity-40"
      >
        {loading ? 'Enviando…' : 'Registrar hallazgo'}
      </button>
    </section>
  );
}
