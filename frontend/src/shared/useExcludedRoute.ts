import { useEffect, useState } from 'react';
import type { Constraints, Mission, Position, RouteResult } from './types/contracts';
import { marsApi } from './api/client';
import { reasonKind } from './mission';

export type ExcludedRoute = { out: RouteResult; back: RouteResult } | 'error' | null;

// Pendiente máxima con la que se busca la ruta alternativa cuando la del plan no fue viable
export const RELAXED_SLOPE = 35;

// Se afloja solo el parámetro que hizo fallar el objetivo (según el motivo del backend)
export function relaxedConstraints(reason: string, c: Constraints): Constraints {
  const kind = reasonKind(reason);
  if (kind === 'slope') return { ...c, max_slope_deg: Math.max(c.max_slope_deg, RELAXED_SLOPE), avoid_unknown: false };
  if (kind === 'unknown') return { ...c, avoid_unknown: false };
  return c;
}

// Ruta que haría falta para un objetivo excluido: última parada aceptada → objetivo → base, calculada
// por el backend. Panel y visor la dibujan en rojo. Una sola consulta por misión y objetivo.
export function useExcludedRoute(
  mission: Mission,
  target: { objective_id: string; position: Position; reason: string } | null,
  constraints: Constraints,
): ExcludedRoute {
  const [route, setRoute] = useState<ExcludedRoute>(null);
  const enabled = !!target && reasonKind(target.reason) !== 'consumption';

  useEffect(() => {
    if (!enabled || !target) return;
    let alive = true;
    const lastStop = mission.objective_ids.at(-1);
    const from = (lastStop && mission.legs.find((l) => l.end_label === lastStop)?.path.at(-1)) || mission.start_position;
    const c = relaxedConstraints(target.reason, constraints);
    const compute = (start: Position, end: Position) =>
      marsApi.computeRoute({ region_id: mission.region_id, start, end, constraints: c });
    Promise.all([compute(from, target.position), compute(target.position, mission.return_position)])
      .then(([out, back]) => alive && setRoute({ out, back }))
      .catch(() => alive && setRoute('error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.mission_id, target?.objective_id, enabled]);

  return route;
}

export const excludedPaths = (r: ExcludedRoute): Position[][] =>
  r && r !== 'error' ? [r.out.path, r.back.path].filter((p) => p.length > 1) : [];
