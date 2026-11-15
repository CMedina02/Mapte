import type { Mission, MissionPlanRequest, Position } from '../types/contracts';

export type BackendMission = Mission;

export const toMission = (mission: BackendMission): Mission => mission;

export function objectivePosition(mission: BackendMission, objectiveId: string): Position | null {
  return mission.legs.find((leg) => leg.end_label === objectiveId)?.path.at(-1) ?? null;
}

export const toPlanRequest = (request: MissionPlanRequest): MissionPlanRequest => ({
  ...request,
  activity_durations_min: request.activity_durations_min ?? {},
});
