import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import { mutateMission } from '../../shared/api/mutateMission';
import { findingText } from '../../shared/format';
import type { Mission, Objective, Photo } from '../../shared/types/contracts';
import type { PendingObservation } from '../offline-sync/offline';

interface Props {
  mission: Mission;
  objective: Objective;
  photo?: Photo; // Imagen de Curiosity como referencia del sitio.
  onMission: (m: Mission) => void;
  onQueue: (o: PendingObservation) => void;
  onDone: (message: string) => void;
  onBack: () => void;
  onExplore: () => void; // abre la ficha del objetivo con todas las fotos
}

<<<<<<< HEAD
// En el objetivo: el astronauta elige lo que observa, puede dejar una nota y la misión sigue al siguiente
export default function FindingPad({ mission, objective, photo, onMission, onQueue, onDone, onBack, onExplore }: Props) {
=======
export default function FindingPad({ mission, objective, photo, onMission, onQueue, onDone, onBack }: Props) {
>>>>>>> aa7575928a95d914c6953b8baa9765203b624df1
  const [code, setCode] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!code) return;
    const obs = { objective_id: objective.objective_id, finding_code: code, ...(notes.trim() ? { notes: notes.trim() } : {}) };
    if (!navigator.onLine) {
      onQueue(obs);
      onDone('Saved. It will be sent when the connection is back.');
      return;
    }
    setBusy(true);
    const err = await mutateMission(
      mission.mission_id,
      () => marsApi.submitObservation(mission.mission_id, { ...obs, mission_version: mission.mission_version }),
      onMission,
    );
    setBusy(false);
    if (err) setError(err);
    else onDone('Finding recorded. Route recalculated to the next destination.');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        {photo && (
          <button type="button" onClick={onExplore} className="shrink-0" title="View rover photos at this site">
            <img src={photo.image_url} alt={`Photo of ${objective.title}`} className="size-16 rounded-xl object-cover" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-space-400">What do you observe?</p>
          <p className="leading-snug font-medium text-space-50">{objective.title.split(' — ')[0]}</p>
        </div>
        <button type="button" onClick={onBack} disabled={busy} className="btn-ghost min-h-9 px-4">
          Back
        </button>
      </div>

      <div role="radiogroup" aria-label="Finding" className="flex flex-wrap gap-2">
        {objective.possible_findings.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={code === c}
            disabled={busy}
            onClick={() => setCode(c)}
            className={`min-h-10 rounded-full border px-4 text-sm transition-colors ${
              code === c ? 'border-primary-400 bg-primary-600 text-white' : 'border-white/15 text-space-100 hover:bg-white/5'
            }`}
          >
            {findingText(c)}
          </button>
        ))}
      </div>

      <textarea
        className="field min-h-16 resize-none"
        placeholder="Notes (optional)"
        maxLength={1000}
        value={notes}
        disabled={busy}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="text-sm text-alert-400">{error}</p>}
      <button type="button" disabled={!code || busy} onClick={send} className="btn-primary min-h-12 w-full text-base">
        {busy ? 'Recording…' : 'Record and continue'}
      </button>
    </div>
  );
}
