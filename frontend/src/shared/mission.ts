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
// Un tramo recalculado desde un punto libre del radar sale de «You».
export function stopLetters(mission: Mission): Record<string, string> {
  return Object.fromEntries([
    ['base', 'A'],
    ['current_position', 'You'],
    ...mission.objective_ids.map((id, i) => [id, String.fromCharCode(66 + i)]),
  ]);
}

export interface DecisionPoint {
  stop: string;
  oxygen_left_min: number | null; // O₂ al llegar ahí (minutos de caminata ya calculados por el backend)
  can_continue: boolean | null; // null cuando no hay siguiente parada.
  can_return: boolean | null; // regresar a base desde aquí conserva la reserva
}

export interface ExcludedObjective {
  objective_id: string;
  reason: string;
}

// El motivo de cada OBJECTIVE_EXCLUDED se obtiene de la bitácora.
export function excludedObjectives(mission: Mission): ExcludedObjective[] {
  const prefix = 'OBJECTIVE_EXCLUDED:';
  return mission.alerts
    .filter((a) => a.startsWith(prefix))
    .map((a) => {
      const id = a.slice(prefix.length);
      const msg = mission.decision_log.find((d) => d.event_type === 'objective_excluded' && d.message.includes(id))?.message;
      return { objective_id: id, reason: msg?.split(/excluded: |excluido: /)[1]?.replace(/\.$/, '') ?? 'no reason recorded' };
    });
}

// El planificador solo añade paradas compatibles con la reserva de regreso.
// Si hubo exclusiones, el límite es la última parada aceptada.
export function decisionPoints(mission: Mission): DecisionPoint[] {
  const viable = mission.viability_status === 'viable';
  const dur = mission.legs.map((l) => l.metrics.duration_min);
  const used = (n: number) =>
    dur.slice(0, n).some((d) => d === null) ? null : dur.slice(0, n).reduce<number>((a, d) => a + (d ?? 0), 0);
  const excluded = excludedObjectives(mission).length > 0;
  // Paradas según los tramos vigentes: tras un recálculo se sale del objetivo donde está el astronauta
  const legs = mission.legs;
  const stops = legs.length ? [legs[0].start_label, ...legs.slice(0, -1).map((l) => l.end_label)] : ['base'];
  return stops.map((stop, i) => {
    const isLast = i === stops.length - 1;
    const u = used(i);
    return {
      stop,
      oxygen_left_min: u === null ? null : mission.resources.oxygen_available_min - u,
      can_continue: isLast ? (excluded ? false : null) : viable ? true : null,
      can_return: stop === 'base' && i === 0 ? true : viable ? true : null,
    };
  });
}

// Tipo de motivo del backend (acepta también los textos en español de misiones guardadas antes)
export type ReasonKind = 'resources' | 'previous' | 'slope' | 'unknown' | 'consumption' | 'limit';
export function reasonKind(r: string): ReasonKind | null {
  if (/resources|recursos/.test(r)) return 'resources';
  if (/earlier excluded|anterior excluido/.test(r)) return 'previous';
  if (/not viable|no es viable/.test(r)) return 'slope';
  if (/unknown terrain|desconocido/.test(r)) return 'unknown';
  if (/consumption|consumo/.test(r)) return 'consumption';
  if (/limit|límite/.test(r)) return 'limit';
  return null;
}

// Motivos del backend en pocas palabras
const SHORT_REASON: Record<ReasonKind, string> = {
  resources: 'not enough oxygen to return with reserve',
  previous: 'depends on an earlier objective',
  slope: 'no safe path',
  unknown: 'the path crosses terrain with no data',
  consumption: 'work time is missing',
  limit: 'the calculation did not finish',
};
export const shortReason = (r: string) => {
  const k = reasonKind(r);
  return k ? SHORT_REASON[k] : r;
};

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

// Comprueba cruces de exclusión antes de mostrar una ruta como viable.
export function exclusionsCrossed(path: Position[], hazards: Hazard[]): string[] {
  return hazards
    .filter((h) => h.kind === 'exclusion' && path.some((p) => insidePolygon(p, h.polygon)))
    .map((h) => h.risk_factor);
}
