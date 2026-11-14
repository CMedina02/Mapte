import type { Mission, Objective } from '../../shared/types/contracts';
import { fmt } from '../../shared/format';

export default function ProgressCard({ mission, current }: { mission: Mission; current: Objective | null }) {
  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
  // Resta simple de dos valores del backend; no es un modelo de consumo
  const margin = o2 == null || reserve == null ? null : o2 - reserve;
  const done = mission.completed_objective_ids.length;
  const total = mission.objective_ids.length;

  return (
    <section className="space-y-3 rounded border border-neutral-700 p-4">
      <p className="text-xs uppercase tracking-widest text-neutral-400">
        Objetivo actual · {done}/{total} completados
      </p>
      {current ? (
        <>
          <p className="text-lg font-bold">{current.title}</p>
          <p className="text-sm text-neutral-400">{current.science_question}</p>
          <p className="text-xs text-neutral-500">Actividades: {current.activities.join(', ')}</p>
        </>
      ) : (
        <p className="text-lg">Sin objetivo pendiente</p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-neutral-900 p-2">
          <dt className="text-xs text-neutral-500">O₂ disponible</dt>
          <dd className="text-xl">{fmt(o2, 'min')}</dd>
        </div>
        <div className="rounded bg-neutral-900 p-2">
          <dt className="text-xs text-neutral-500">Reserva retorno</dt>
          <dd className="text-xl">{fmt(reserve, 'min')}</dd>
        </div>
        <div className={`rounded p-2 ${margin !== null && margin <= 0 ? 'bg-red-950 text-red-300' : 'bg-neutral-900'}`}>
          <dt className="text-xs text-neutral-500">Margen (O₂ − reserva)</dt>
          <dd className="text-xl">{fmt(margin, 'min')}</dd>
        </div>
      </dl>

      <p className="text-xs text-neutral-500">
        Ruta: {mission.route.status} · {fmt(mission.route.distance_m, 'm')} · pendiente máx.{' '}
        {fmt(mission.route.max_slope_deg, '°')}
      </p>
      {mission.route.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-300">
          ⚠ {w}
        </p>
      ))}
    </section>
  );
}