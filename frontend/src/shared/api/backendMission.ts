// Adaptador del contrato REAL de misiones del backend (backend/app/modules/missions/api/schemas.py)
// al tipo Mission que usa la interfaz. Solo traduce forma y nombres: no recalcula ninguna métrica.
import type { Decision, Mission, MissionPlanRequest, MissionStatus, Position, Resources, RouteResult } from '../types/contracts';

export interface BackendLeg {
  leg_id: string;
  route_id: string;
  start_label: string; // 'base' u objective_id
  end_label: string;
  status: RouteResult['status'];
  path: Position[];
  metrics: {
    distance_m: number | null;
    duration_min: number | null;
    ascent_m: number | null;
    max_slope_deg: number | null;
    unknown_segments: number;
  };
  warnings: string[];
  assumptions: string[];
}

export interface BackendMission {
  mission_id: string;
  mission_version: number;
  region_id: string;
  frame_id: string;
  terrain_version: string;
  lifecycle_status: 'draft' | 'active' | 'completed' | 'aborted';
  viability_status: RouteResult['status'];
  start_position: Position;
  current_position: Position | null;
  return_position: Position;
  objective_ids: string[];
  completed_objective_ids: string[];
  next_objective_id: string | null;
  legs: BackendLeg[];
  resources: Resources;
  resource_evaluation: { status: string; reason_codes: string[]; warnings: string[] };
  alerts: string[];
  decision_log: Decision[];
  evidence_ids: string[];
}

const LIFECYCLE: Record<BackendMission['lifecycle_status'], MissionStatus> = {
  draft: 'planned',
  active: 'in_progress',
  completed: 'completed',
  aborted: 'cancelled',
};

// Tramos del backend → una ruta para dibujar. Suma las métricas que ya calculó el backend
// (null si algún tramo no la tiene: nunca se rellena con 0). La viabilidad es la del plan completo.
function legsToRoute(b: BackendMission): RouteResult {
  const legs = b.legs;
  const sum = (k: 'distance_m' | 'duration_min' | 'ascent_m') =>
    legs.length && legs.every((l) => l.metrics[k] !== null) ? legs.reduce((a, l) => a + (l.metrics[k] ?? 0), 0) : null;
  const slopes = legs.map((l) => l.metrics.max_slope_deg);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const path = legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1)));
  const last = legs.at(-1);
  return {
    route_id: legs.map((l) => l.route_id).join('+') || `${b.mission_id}-v${b.mission_version}`,
    region_id: b.region_id,
    frame_id: b.frame_id,
    terrain_version: b.terrain_version,
    path,
    return_start_index: legs.length > 1 && last?.end_label === 'base' ? path.length - last.path.length : undefined,
    distance_m: sum('distance_m'),
    duration_min: sum('duration_min'),
    ascent_m: sum('ascent_m'),
    max_slope_deg: legs.length && slopes.every((s) => s !== null) ? Math.max(...(slopes as number[])) : null,
    status: b.viability_status,
    unknown_segments: legs.reduce((a, l) => a + l.metrics.unknown_segments, 0),
    warnings: uniq(legs.flatMap((l) => l.warnings)), // los de recursos ya llegan como código en b.alerts
    evidence_ids: b.evidence_ids,
    assumptions: uniq(legs.flatMap((l) => l.assumptions)),
  };
}

export function toMission(b: BackendMission): Mission {
  return {
    mission_id: b.mission_id,
    region_id: b.region_id,
    version: b.mission_version,
    status: LIFECYCLE[b.lifecycle_status],
    base_position: b.start_position,
    current_position: b.current_position,
    objective_ids: b.objective_ids,
    route: legsToRoute(b),
    resources: { oxygen_available_min: b.resources.oxygen_available_min, return_reserve_min: b.resources.return_reserve_min },
    completed_objective_ids: b.completed_objective_ids,
    next_objective_id: b.next_objective_id,
    alerts: b.alerts,
    decision_log: b.decision_log,
    evidence_ids: b.evidence_ids,
    sample_only: false,
  };
}

// La posición de un objetivo dentro de la misión: el final del tramo que llega a él (ya ajustado a la celda)
export function objectivePosition(b: BackendMission, objectiveId: string): Position | null {
  const leg = b.legs.find((l) => l.end_label === objectiveId);
  return leg?.path.at(-1) ?? null;
}

export const toPlanRequest = (req: MissionPlanRequest) => ({
  region_id: req.region_id,
  base_position: req.base_position,
  objective_ids: req.objective_ids,
  constraints: req.constraints,
  resources: req.resources,
  activity_durations_min: req.activity_durations_min ?? {},
});
