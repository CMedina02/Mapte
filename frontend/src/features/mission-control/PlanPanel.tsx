import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective, Position } from '../../shared/types/contracts';

interface Props {
  regionId: string;
  objectives: Objective[];
  base: Position | null;
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  onPlanned: (m: Mission) => void;
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{props.label}</span>
      <input
        type="number"
        className="w-24 rounded bg-neutral-900 p-1 text-right"
        value={Number.isNaN(props.value) ? '' : props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}

export default function PlanPanel({ regionId, objectives, base, selectedIds, onSelectedIds, onPlanned }: Props) {
  const [maxSlope, setMaxSlope] = useState(15);
  const [speed, setSpeed] = useState(20);
  const [avoidUnknown, setAvoidUnknown] = useState(true);
  const [oxygen, setOxygen] = useState(240);
  const [reserve, setReserve] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    onSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const badNumber =
    [maxSlope, speed, oxygen, reserve].some((n) => Number.isNaN(n) || n < 0) || maxSlope > 90 || speed <= 0;

  const problem = !base
    ? 'Haz clic en el mapa para fijar la base.'
    : selectedIds.length === 0
      ? 'Selecciona al menos un objetivo.'
      : badNumber
        ? 'Revisa los parámetros (pendiente 0–90°, velocidad > 0).'
        : reserve >= oxygen
          ? 'La reserva de retorno debe ser menor que el O₂ disponible.'
          : null;

  async function plan() {
    if (problem || !base) return;
    setLoading(true);
    setError(null);
    try {
      onPlanned(
        await marsApi.planMission({
          region_id: regionId,
          base_position: base,
          objective_ids: selectedIds, // el backend decide el orden real de visita
          constraints: { max_slope_deg: maxSlope, speed_m_per_min: speed, avoid_unknown: avoidUnknown },
          resources: { oxygen_available_min: oxygen, return_reserve_min: reserve },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3 text-sm">
      <h2 className="text-xs uppercase tracking-widest text-neutral-400">Objetivos</h2>
      {objectives.map((o) => (
        <label key={o.objective_id} className="flex gap-2 rounded border border-neutral-800 p-2">
          <input
            type="checkbox"
            checked={selectedIds.includes(o.objective_id)}
            onChange={() => toggle(o.objective_id)}
          />
          <span>
            <span className="block">{o.title}</span>
            <span className="block text-xs text-neutral-500">{o.science_question}</span>
            <span className="block text-xs text-neutral-500">
              Prioridad {o.priority_weight} · ({o.position.x_m}, {o.position.y_m}) m
            </span>
          </span>
        </label>
      ))}

      <p className="text-xs text-neutral-400">
        Base: {base ? `(${base.x_m}, ${base.y_m}) m` : 'sin fijar (clic en el mapa)'}
      </p>

      <h2 className="pt-2 text-xs uppercase tracking-widest text-neutral-400">Parámetros</h2>
      <NumberField label="Pendiente máx. (°)" value={maxSlope} onChange={setMaxSlope} min={0} max={90} />
      <NumberField label="Velocidad (m/min)" value={speed} onChange={setSpeed} min={1} />
      <label className="flex items-center justify-between">
        <span>Evitar zonas sin datos</span>
        <input type="checkbox" checked={avoidUnknown} onChange={(e) => setAvoidUnknown(e.target.checked)} />
      </label>
      <NumberField label="O₂ disponible (min)" value={oxygen} onChange={setOxygen} min={0} />
      <NumberField label="Reserva retorno (min)" value={reserve} onChange={setReserve} min={0} />

      {error && <p className="text-xs text-red-500">{error}</p>}
      {!error && problem && <p className="text-xs text-amber-400">{problem}</p>}

      <button
        type="button"
        onClick={plan}
        disabled={!!problem || loading}
        className="w-full rounded bg-orange-600 p-2 font-bold disabled:opacity-40"
      >
        {loading ? 'Planificando…' : 'Planificar misión'}
      </button>
    </section>
  );
}