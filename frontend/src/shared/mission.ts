import type { Mission, MissionLeg, RouteResult, RouteStatus } from './types/contracts';

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
  const path = legs.flatMap((leg, index) => (index === 0 ? leg.path : leg.path.slice(1)));
  const known = (key: 'distance_m' | 'duration_min' | 'ascent_m') => {
    const values = legs.map((leg) => leg.metrics[key]);
    return values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  const slopes = legs.map((leg) => leg.metrics.max_slope_deg);
  const status = legs.reduce<RouteStatus>(
    (worst, leg) => (statusRank[leg.status] > statusRank[worst] ? leg.status : worst),
    mission.viability_status,
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
    max_slope_deg: slopes.some((value) => value === null) ? null : Math.max(0, ...slopes.map((value) => value ?? 0)),
    status,
    unknown_segments: legs.reduce((total, leg) => total + leg.metrics.unknown_segments, 0),
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    evidence_ids: mission.evidence_ids,
    assumptions: [...new Set(legs.flatMap((leg) => leg.assumptions))],
  };
}
