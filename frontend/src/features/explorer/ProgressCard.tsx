import type { Mission, Objective } from '../../shared/types/contracts';
import { fmtDistance, fmtDuration, notices, ROUTE_STATUS } from '../../shared/format';
import { missionRoute } from '../../shared/mission';
import Icon from '../../shared/ui/Icon';

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
        Objetivo actual · {done} de {total} completados
      </p>
      {current ? (
        <>
          <p className="text-xl font-medium text-space-50">{current.title}</p>
          <p className="text-sm text-space-300">{current.science_question}</p>
          <p className="text-xs text-space-400">Actividades: {current.activities.join(', ')}</p>
        </>
      ) : (
        <p className="text-xl text-space-50">{total ? 'Todos los objetivos completados' : 'Sin objetivos en el plan'}</p>
      )}

      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-space-950 p-3">
          <dt className="text-xs text-space-400">Oxígeno</dt>
          <dd className="text-lg font-medium text-space-50">{fmtDuration(o2)}</dd>
        </div>
        <div className="rounded-2xl bg-space-950 p-3">
          <dt className="text-xs text-space-400">Reserva</dt>
          <dd className="text-lg font-medium text-space-50">{fmtDuration(reserve)}</dd>
        </div>
        <div className={`rounded-2xl p-3 ${margin !== null && margin <= 0 ? 'bg-alert-950 text-alert-300' : 'bg-space-950'}`}>
          <dt className="text-xs text-space-400">Margen</dt>
          <dd className="text-lg font-medium">{fmtDuration(margin)}</dd>
        </div>
      </dl>

      <p className="text-xs text-space-400">
        Ruta {(ROUTE_STATUS[route.status] ?? ROUTE_STATUS.unknown).label.toLowerCase()} · {fmtDistance(route.distance_m)}
      </p>
      {notices(route.warnings).map((w) => (
        <p key={w} className="flex gap-1.5 text-xs text-amber-300">
          <Icon name="warning" size={16} />
          {w}
        </p>
      ))}
    </section>
  );
}
