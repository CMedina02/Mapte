import { useEffect } from 'react';
import type { Mission, MissionPlanRequest, Objective, Position } from '../../shared/types/contracts';
import { fmtDuration } from '../../shared/format';
import { reasonKind, type ExcludedObjective } from '../../shared/mission';
import { excludedPaths, relaxedConstraints, useExcludedRoute } from '../../shared/useExcludedRoute';

// Qué haría falta para incluir el objetivo excluido. El backend calcula la ruta que falta (última parada →
// objetivo → base) aflojando solo el parámetro que falló; se devuelve para dibujarla en rojo en el mapa.
export default function ExclusionHint({
  mission,
  excluded,
  objective,
  request,
  onPaths,
}: {
  mission: Mission;
  excluded: ExcludedObjective;
  objective: Objective | undefined;
  request: MissionPlanRequest;
  onPaths: (paths: Position[][]) => void;
}) {
  const reason = excluded.reason;
  const kind = reasonKind(reason);
  const slopeFailed = kind === 'slope';
  const unknownFailed = kind === 'unknown';
  const needsRoutes = !!objective && kind !== 'consumption';
  const constraints = relaxedConstraints(reason, request.constraints);
  const legs = useExcludedRoute(
    mission,
    objective ? { objective_id: objective.objective_id, position: objective.position, reason } : null,
    request.constraints,
  );
  useEffect(() => {
    if (legs) onPaths(excludedPaths(legs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs]);

  const box = (children: React.ReactNode) => (
    <div className="mt-3 space-y-1 border-t border-alert-800 pt-3 text-alert-200">{children}</div>
  );

  if (kind === 'consumption') return box(<p>Specify how long you will work at each objective.</p>);
  if (!needsRoutes) return null;
  if (legs === null) return box(<p className="opacity-80">Calculating what would be needed…</p>);
  if (legs === 'error') return box(<p className="opacity-80">Offline: cannot calculate it.</p>);
  if (legs.out.status === 'not_viable' || legs.back.status === 'not_viable') {
    return box(<p>No path possible{slopeFailed ? `, not even with ${constraints.max_slope_deg}° slopes` : ''}.</p>);
  }

  const legend = <p className="opacity-80">On the map, in red, the path it would take.</p>;
  if (slopeFailed) {
    const slope = Math.max(legs.out.max_slope_deg ?? 0, legs.back.max_slope_deg ?? 0);
    return box(
      <>
        <p>
          It would require allowing slopes of <span className="font-medium">{Math.ceil(slope)}°</span> (currently{' '}
          {request.constraints.max_slope_deg}°).
        </p>
        {legend}
      </>,
    );
  }
  if (unknownFailed) return box(<><p>It would require allowing terrain with no data.</p>{legend}</>);

  // Recursos: lo ya planificado + la ruta que falta + actividad, contra el O₂ disponible
  const walked = mission.legs.filter((l) => l.end_label !== 'base').map((l) => l.metrics.duration_min);
  const act = [...mission.objective_ids, excluded.objective_id].map((id) => request.activity_durations_min?.[id] ?? 0);
  const parts = [...walked, legs.out.duration_min, legs.back.duration_min];
  if (parts.some((d) => d === null)) return box(<p className="opacity-80">The path duration is unknown.</p>);
  const actTotal = act.reduce((a, x) => a + x, 0);
  const need = (parts as number[]).reduce((a, x) => a + x, 0) + actTotal; // caminata + actividad, sin reserva
  const { oxygen_available_min: o2, return_reserve_min: reserve } = request.resources;
  const deficit = need + reserve - o2;
  const perObj = act.length ? Math.floor((actTotal - deficit) / act.length) : -1;

  return box(
    <>
      <p className="font-medium">To include it you would need:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>
          {fmtDuration(Math.ceil(need + reserve))} of oxygen (you have {fmtDuration(o2)})
        </li>
        {o2 - need > 0 && <li>or a reserve of at most {Math.floor(o2 - need)} min (currently {reserve} min)</li>}
        {perObj >= 0 && <li>or at most {perObj} min of work per objective</li>}
      </ul>
      {legend}
    </>,
  );
}
