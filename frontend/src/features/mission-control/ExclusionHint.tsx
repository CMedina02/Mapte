import { useEffect, useState } from 'react';
import type { Constraints, Mission, MissionPlanRequest, Objective, Position, RouteResult } from '../../shared/types/contracts';
import { marsApi } from '../../shared/api/client';
import type { ExcludedObjective } from '../../shared/mission';

type Legs = { out: RouteResult; back: RouteResult } | 'error' | null;

// Pendiente máxima con la que se busca la ruta alternativa cuando la del plan no fue viable
const RELAXED_SLOPE = 35;

// Qué haría falta para incluir el objetivo excluido. Se pide al backend la ruta que falta (última parada →
// objetivo → base), relajando solo el parámetro que falló, y se devuelve para dibujarla en rojo en el mapa.
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
  const slopeFailed = reason.includes('no es viable');
  const unknownFailed = reason.includes('desconocido');
  const needsRoutes = !!objective && !reason.includes('consumo');
  const [legs, setLegs] = useState<Legs>(null);

  const lastStop = mission.objective_ids.at(-1);
  const from = (lastStop && mission.legs.find((l) => l.end_label === lastStop)?.path.at(-1)) || mission.start_position;
  const constraints: Constraints = slopeFailed
    ? { ...request.constraints, max_slope_deg: Math.max(request.constraints.max_slope_deg, RELAXED_SLOPE), avoid_unknown: false }
    : unknownFailed
      ? { ...request.constraints, avoid_unknown: false }
      : request.constraints;

  useEffect(() => {
    if (!needsRoutes || !objective) return;
    let alive = true;
    const route = (start: Position, end: Position) =>
      marsApi.computeRoute({ region_id: mission.region_id, start, end, constraints });
    Promise.all([route(from, objective.position), route(objective.position, mission.return_position)])
      .then(([out, back]) => {
        if (!alive) return;
        setLegs({ out, back });
        onPaths([out.path, back.path].filter((p) => p.length > 1));
      })
      .catch(() => alive && setLegs('error'));
    return () => {
      alive = false;
    };
    // una sola consulta por misión y objetivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.mission_id, excluded.objective_id, needsRoutes]);

  const box = (children: React.ReactNode) => (
    <div className="mt-1.5 space-y-0.5 border-t border-alert-800 pt-1.5 text-alert-200">{children}</div>
  );

  if (reason.includes('consumo')) return box(<p>Indica el tiempo de actividad de cada objetivo.</p>);
  if (!needsRoutes) return null;
  if (legs === null) return box(<p className="opacity-80">Calculando…</p>);
  if (legs === 'error') return box(<p className="opacity-80">Sin enlace.</p>);
  if (legs.out.status === 'not_viable' || legs.back.status === 'not_viable') {
    return box(<p>Sin ruta posible{slopeFailed ? ` ni con pendiente ${constraints.max_slope_deg}°` : ''}.</p>);
  }

  const legend = <p className="opacity-80">En rojo en el mapa: la ruta que haría falta.</p>;
  if (slopeFailed) {
    const slope = Math.max(legs.out.max_slope_deg ?? 0, legs.back.max_slope_deg ?? 0);
    return box(
      <>
        <p>
          Pendiente máx. ≥ <span className="font-mono">{Math.ceil(slope)}°</span> (ahora {request.constraints.max_slope_deg}°)
        </p>
        {legend}
      </>,
    );
  }
  if (unknownFailed) return box(<><p>Desactiva «Evitar zonas sin datos».</p>{legend}</>);

  // Recursos: lo ya planificado + la ruta que falta + actividad, contra el O₂ disponible
  const walked = mission.legs.filter((l) => l.end_label !== 'base').map((l) => l.metrics.duration_min);
  const act = [...mission.objective_ids, excluded.objective_id].map((id) => request.activity_durations_min?.[id] ?? 0);
  const parts = [...walked, legs.out.duration_min, legs.back.duration_min];
  if (parts.some((d) => d === null)) return box(<p className="opacity-80">Duración desconocida.</p>);
  const actTotal = act.reduce((a, x) => a + x, 0);
  const need = (parts as number[]).reduce((a, x) => a + x, 0) + actTotal; // caminata + actividad, sin reserva
  const { oxygen_available_min: o2, return_reserve_min: reserve } = request.resources;
  const deficit = need + reserve - o2;
  const perObj = act.length ? Math.floor((actTotal - deficit) / act.length) : -1;

  return box(
    <>
      <p className="font-bold">Para incluirlo:</p>
      <ul className="list-disc pl-4">
        <li>
          O₂ ≥ <span className="font-mono">{Math.ceil(need + reserve)} min</span> (hay {o2})
        </li>
        {o2 - need > 0 && (
          <li>
            o reserva ≤ <span className="font-mono">{Math.floor(o2 - need)} min</span> (ahora {reserve})
          </li>
        )}
        {perObj >= 0 && (
          <li>
            o actividad ≤ <span className="font-mono">{perObj} min</span>/objetivo
          </li>
        )}
      </ul>
      {legend}
    </>,
  );
}
