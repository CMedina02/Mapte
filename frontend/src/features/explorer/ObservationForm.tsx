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
          mission_version: mission.mission_version,
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
    return <section className="card">Todos los objetivos completados.</section>;
  }

  return (
    <section className="card">
      <p className="eyebrow">Registrar observación</p>

      <select
        className="field"
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
              className={`btn break-all ${finding === code ? 'bg-primary-600 text-white' : 'border border-space-700 bg-space-900'}`}
            >
              {code}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="field"
        rows={3}
        maxLength={1000}
        placeholder="Notas (opcional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="text-sm text-alert-500">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!validFinding || loading}
        className="btn-primary w-full"
      >
        {loading ? 'Enviando…' : 'Registrar hallazgo'}
      </button>
    </section>
  );
}
