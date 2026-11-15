import type { Hazard, Mission, MissionLeg, Position, RouteResult, RouteStatus } from './types/contracts';

const statusRank: Record<RouteStatus, number> = { viable: 0, unknown: 1, not_viable: 2 };

export function activeMissionLeg(mission: Mission): MissionLeg | null {
  if (mission.legs.length === 0) return null;
  if (mission.next_objective_id) {
    return mission.legs.find((leg) => leg.end_label === mission.next_objective_id) ?? mission.legs[0];
  }
  return mission.legs.find((leg) => leg.end_label === 'base') ?? mission.legs[0];
}

export function missionRoute(mission: Mission): RouteResult {
  const legs = mission.legs;
  const drawableLegs: MissionLeg[] = [];
  for (const leg of legs) {
    if (leg.status === 'not_viable' || leg.path.length === 0) break;
    const previousLeg = drawableLegs[drawableLegs.length - 1];
    const previous = previousLeg?.path[previousLeg.path.length - 1];
    const first = leg.path[0];
    if (
      previous &&
      (previous.frame_id !== first.frame_id ||
        previous.x_m !== first.x_m ||
        previous.y_m !== first.y_m)
    ) break;
    drawableLegs.push(leg);
  }
  const path = drawableLegs.flatMap((leg, index) => (index === 0 ? leg.path : leg.path.slice(1)));
  const known = (key: 'distance_m' | 'duration_min' | 'ascent_m') => {
    if (drawableLegs.length === 0) return null;
    const values = drawableLegs.map((leg) => leg.metrics[key]);
    return values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  const slopes = drawableLegs.map((leg) => leg.metrics.max_slope_deg);
  const status = drawableLegs.length === 0
    ? legs[0]?.status ?? 'viable'
    : drawableLegs.reduce<RouteStatus>(
        (worst, leg) => (statusRank[leg.status] > statusRank[worst] ? leg.status : worst),
        'viable',
      );
  return {
    route_id: legs.map((leg) => leg.route_id).join('+') || `${mission.mission_id}-empty`,
    region_id: mission.region_id,
    frame_id: mission.frame_id,
    terrain_version: mission.terrain_version,
    path,
    distance_m: known('distance_m'),
    duration_min: known('duration_min'),
    ascent_m: known('ascent_m'),
    max_slope_deg:
      slopes.length === 0 || slopes.some((value) => value === null)
        ? null
        : Math.max(0, ...slopes.map((value) => value ?? 0)),
    status,
    unknown_segments: drawableLegs.reduce((total, leg) => total + leg.metrics.unknown_segments, 0),
    warnings: [...new Set(drawableLegs.flatMap((leg) => leg.warnings))],
    evidence_ids: mission.evidence_ids,
    assumptions: [...new Set(drawableLegs.flatMap((leg) => leg.assumptions))],
  };
}

// Letra de cada parada para identificar los tramos: base = A, objetivos en orden = B, C, …
export function stopLetters(mission: Mission): Record<string, string> {
  return Object.fromEntries([
    ['base', 'A'],
    ...mission.objective_ids.map((id, i) => [id, String.fromCharCode(66 + i)]),
  ]);
}

export interface DecisionPoint {
  stop: string; // 'base' u objective_id: dónde se decide
  oxygen_left_min: number | null; // O₂ al llegar ahí (minutos de caminata ya calculados por el backend)
  can_continue: boolean | null; // seguir al siguiente objetivo conserva el regreso seguro (null: no hay siguiente)
  can_return: boolean | null; // regresar a base desde aquí conserva la reserva
}

export interface ExcludedObjective {
  objective_id: string;
  reason: string;
}

// Objetivos que el backend dejó fuera del plan: alerta OBJECTIVE_EXCLUDED:<id> + motivo en la bitácora
export function excludedObjectives(mission: Mission): ExcludedObjective[] {
  const prefix = 'OBJECTIVE_EXCLUDED:';
  return mission.alerts
    .filter((a) => a.startsWith(prefix))
    .map((a) => {
      const id = a.slice(prefix.length);
      const msg = mission.decision_log.find((d) => d.event_type === 'objective_excluded' && d.message.includes(id))?.message;
      return { objective_id: id, reason: msg?.split('excluido: ')[1]?.replace(/\.$/, '') ?? 'sin motivo registrado' };
    });
}

// El planificador del backend solo acepta un objetivo si desde él el regreso a base conserva la reserva
// (plan de prefijo seguro). Por eso, en un plan viable, cada parada aceptada permite regresar y seguir
// a la siguiente; el límite es la última parada aceptada cuando hubo objetivos excluidos.
export function decisionPoints(mission: Mission): DecisionPoint[] {
  const viable = mission.viability_status === 'viable';
  const dur = mission.legs.map((l) => l.metrics.duration_min);
  const used = (n: number) =>
    dur.slice(0, n).some((d) => d === null) ? null : dur.slice(0, n).reduce<number>((a, d) => a + (d ?? 0), 0);
  const excluded = excludedObjectives(mission).length > 0;
  const stops = ['base', ...mission.objective_ids];
  return stops.map((stop, i) => {
    const isLast = i === stops.length - 1;
    const u = used(i);
    return {
      stop,
      oxygen_left_min: u === null ? null : mission.resources.oxygen_available_min - u,
      can_continue: isLast ? (excluded ? false : null) : viable ? true : null,
      can_return: i === 0 ? true : viable ? true : null,
    };
  });
}

// Motivos del backend en pocas palabras
export const shortReason = (r: string) =>
  r.includes('recursos')
    ? 'no alcanza el oxígeno para volver con reserva'
    : r.includes('anterior excluido')
      ? 'depende de un objetivo anterior'
      : r.includes('no es viable')
        ? 'no hay un camino seguro'
        : r.includes('desconocido')
          ? 'el camino cruza terreno sin datos'
          : r.includes('consumo')
            ? 'falta el tiempo de trabajo'
            : r.includes('límite')
              ? 'el cálculo no terminó'
              : r;

// Punto dentro de polígono (ray casting) en el marco local
function insidePolygon(p: Position, poly: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y_m > p.y_m !== b.y_m > p.y_m && p.x_m < ((b.x_m - a.x_m) * (p.y_m - a.y_m)) / (b.y_m - a.y_m) + a.x_m) inside = !inside;
  }
  return inside;
}

// Zonas de exclusión que pisa un camino. El A* del backend aún no las usa (STATIC_HAZARDS_NOT_AVAILABLE),
// así que el cliente lo detecta para no presentar como segura una ruta que las cruza.
export function exclusionsCrossed(path: Position[], hazards: Hazard[]): string[] {
  return hazards
    .filter((h) => h.kind === 'exclusion' && path.some((p) => insidePolygon(p, h.polygon)))
    .map((h) => h.risk_factor);
}
