import { useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, MissionPlanRequest, Objective, Position } from '../../shared/types/contracts';
import Icon from '../../shared/ui/Icon';
import Slider from '../../shared/ui/Slider';

interface Props {
  regionId: string;
  objectives: Objective[];
  base: Position | null;
  replan?: boolean;
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  onPlanned: (m: Mission, req: MissionPlanRequest) => void;
}

// Valores iniciales del escenario EVA.
const DEFAULTS = { slope: 15, speed: 20, avoidUnknown: true, oxygen: 480, reserve: 60, activity: 45 };

const hours = (min: number) => (min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`);

export default function PlanPanel({ regionId, objectives, base, replan, selectedIds, onSelectedIds, onPlanned }: Props) {
  const [maxSlope, setMaxSlope] = useState(DEFAULTS.slope);
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const [avoidUnknown, setAvoidUnknown] = useState(DEFAULTS.avoidUnknown);
  const [oxygen, setOxygen] = useState(DEFAULTS.oxygen);
  const [reserve, setReserve] = useState(DEFAULTS.reserve);
  const [activityMin, setActivityMin] = useState(DEFAULTS.activity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    onSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const isDefault =
    maxSlope === DEFAULTS.slope &&
    speed === DEFAULTS.speed &&
    avoidUnknown === DEFAULTS.avoidUnknown &&
    oxygen === DEFAULTS.oxygen &&
    reserve === DEFAULTS.reserve &&
    activityMin === DEFAULTS.activity;

  const problem = !base
    ? 'Toca el mapa para elegir el punto de salida.'
    : selectedIds.length === 0
      ? 'Elige al menos un objetivo.'
      : reserve >= oxygen
        ? 'La reserva debe ser menor que el oxígeno disponible.'
        : null;

  async function plan() {
    if (problem || !base) return;
    setLoading(true);
    setError(null);
    try {
      const req: MissionPlanRequest = {
        region_id: regionId,
        base_position: base,
        objective_ids: selectedIds,
        constraints: { max_slope_deg: maxSlope, speed_m_per_min: speed, avoid_unknown: avoidUnknown },
        resources: { oxygen_available_min: oxygen, return_reserve_min: reserve },
        activity_durations_min: Object.fromEntries(selectedIds.map((id) => [id, activityMin])),
      };
      onPlanned(await marsApi.planMission(req), req);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5 text-sm">
      <div className="space-y-2">
        <h2 className="eyebrow">Objetivos</h2>
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-space-800 bg-space-900">
          {objectives.map((o, i) => {
            const order = selectedIds.indexOf(o.objective_id);
            const [name, detail] = o.title.split(' — ');
            return (
              <li key={o.objective_id} className={i ? 'border-t border-space-800' : undefined}>
                <button
                  type="button"
                  aria-pressed={order >= 0}
                  onClick={() => toggle(o.objective_id)}
                  title={o.science_question}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-space-800"
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      order >= 0 ? 'bg-primary-600 text-white' : 'border border-space-700 text-transparent'
                    }`}
                  >
                    {order >= 0 ? String.fromCharCode(66 + order) : ''}
                  </span>
                  <span className="min-w-0">
                    <span className="block leading-snug font-medium text-space-50">{name}</span>
                    {detail && <span className="block truncate text-xs text-space-400">{detail}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-1 text-xs text-space-400">La letra indica el orden de visita.</p>
      </div>

      <details className="group rounded-[var(--radius-card)] border border-space-800 bg-space-900">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
          <Icon name="tune" className="text-space-400" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-space-50">Ajustes</span>
            <span className="block truncate text-xs text-space-400">
              {isDefault ? 'Valores de referencia de la NASA' : `${hours(oxygen)} de oxígeno · reserva ${reserve} min`}
            </span>
          </span>
          <Icon name="expandMore" className="text-space-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-space-800 px-4 pt-4 pb-5">
          <Slider label="Oxígeno disponible" value={oxygen} min={120} max={1200} step={15} display={hours(oxygen)} onChange={setOxygen} />
          <Slider label="Reserva para volver" value={reserve} min={0} max={120} step={5} display={`${reserve} min`} onChange={setReserve} />
          <Slider label="Tiempo en cada objetivo" value={activityMin} min={0} max={120} step={5} display={`${activityMin} min`} onChange={setActivityMin} />
          <Slider label="Pendiente máxima" value={maxSlope} min={5} max={35} step={1} display={`${maxSlope}°`} onChange={setMaxSlope} />
          <Slider label="Ritmo de caminata" value={speed} min={10} max={50} step={1} display={`${(speed * 0.06).toFixed(1)} km/h`} onChange={setSpeed} />
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-space-200">Evitar terreno sin datos</span>
            <button
              type="button"
              role="switch"
              aria-checked={avoidUnknown}
              onClick={() => setAvoidUnknown((v) => !v)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${avoidUnknown ? 'bg-primary-600' : 'bg-space-700'}`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${avoidUnknown ? 'left-6' : 'left-1'}`}
              />
            </button>
          </label>
          {!isDefault && (
            <button
              type="button"
              className="text-sm font-medium text-primary-600 hover:underline"
              onClick={() => {
                setMaxSlope(DEFAULTS.slope);
                setSpeed(DEFAULTS.speed);
                setAvoidUnknown(DEFAULTS.avoidUnknown);
                setOxygen(DEFAULTS.oxygen);
                setReserve(DEFAULTS.reserve);
                setActivityMin(DEFAULTS.activity);
              }}
            >
              Restablecer
            </button>
          )}
        </div>
      </details>

      <div className="space-y-2">
        {error && <p className="px-1 text-xs text-alert-500">{error}</p>}
        {!error && problem && <p className="px-1 text-xs text-space-400">{problem}</p>}
        <button type="button" onClick={plan} disabled={!!problem || loading} className="btn-primary w-full">
          {loading ? 'Calculando ruta…' : replan ? 'Recalcular desde aquí' : 'Planificar'}
        </button>
      </div>
    </section>
  );
}
