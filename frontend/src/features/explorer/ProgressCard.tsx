import type { Mission, Objective } from '../../shared/types/contracts';
import { fmt } from '../../shared/format';
import { missionRoute } from '../../shared/mission';

export default function ProgressCard({ mission, current }: { mission: Mission; current: Objective | null }) {
  const route = missionRoute(mission);
  const { oxygen_available_min: o2, return_reserve_min: reserve } = mission.resources;
  // Resta simple de dos valores del backend; no es un modelo de consumo
  const margin = o2 == null || reserve == null ? null : o2 - reserve;
  const done = mission.completed_objective_ids.length;
  const total = mission.objective_ids.length;

  return (
    <section className="card">
      <p className="eyebrow">
        Objetivo actual · {done}/{total} completados
      </p>
      {current ? (
        <>
          <p className="text-lg font-bold">{current.title}</p>
          <p className="text-sm text-space-300">{current.science_question}</p>
          <p className="text-xs text-space-400">Actividades: {current.activities.join(', ')}</p>
        </>
      ) : (
        <p className="text-lg">Sin objetivo pendiente</p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-space-900 p-2">
          <dt className="text-xs text-space-400">O₂ disponible</dt>
          <dd className="text-lg sm:text-xl">{fmt(o2, 'min')}</dd>
        </div>
        <div className="rounded bg-space-900 p-2">
          <dt className="text-xs text-space-400">Reserva retorno</dt>
          <dd className="text-lg sm:text-xl">{fmt(reserve, 'min')}</dd>
        </div>
        <div className={`rounded p-2 ${margin !== null && margin <= 0 ? 'bg-alert-950 text-alert-300' : 'bg-space-900'}`}>
          <dt className="text-xs text-space-400">Margen (O₂ − reserva)</dt>
          <dd className="text-lg sm:text-xl">{fmt(margin, 'min')}</dd>
        </div>
      </dl>

      <p className="text-xs text-space-400">
        Ruta: {route.status} · {fmt(route.distance_m, 'm')} · pendiente máx.{' '}
        {fmt(route.max_slope_deg, '°')}
      </p>
      {route.warnings.map((w) => (
        <p key={w} className="text-xs text-amber-300">
          ⚠ {w}
        </p>
      ))}
    </section>
  );
}
