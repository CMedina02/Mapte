import type {
  Health, Mission, MissionPackage, ObjectivesResponse, ObservationRequest,
  ContingencyRequest, PhotosResponse, RegionManifest, RegionsResponse, RouteResult,
} from '../types/contracts';
import { MarsApiError } from './errors';

import regions from '../../../../contracts/examples/regions.json';
import manifest from '../../../../contracts/examples/region_manifest.json';
import objectives from '../../../../contracts/examples/objectives.json';
import photos from '../../../../contracts/examples/photos.json';
import route from '../../../../contracts/examples/route_response.json';
import planResponse from '../../../../contracts/examples/mission_plan_response.json';
import observationResponse from '../../../../contracts/examples/observation_response.json';
import contingencyResponse from '../../../../contracts/examples/contingency_response.json';
import missionPackage from '../../../../contracts/examples/mission_package.json';

const as = <T>(json: unknown) => structuredClone(json) as T;

let mission = as<Mission>(planResponse);

function advance(next: unknown, clientVersion: number): Mission {
  if (clientVersion !== mission.version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'La misión cambió en el servidor; recarga el estado.');
  }
  mission = { ...as<Mission>(next), version: mission.version + 1 };
  return structuredClone(mission);
}

export const mockApi = {
  health: (): Health => ({ status: 'ok', api_version: 'mock' }),
  regions: () => as<RegionsResponse>(regions).regions,
  manifest: () => as<RegionManifest>(manifest),
  objectives: () => as<ObjectivesResponse>(objectives).objectives,
  photos: (objectiveId?: string) => {
    const all = as<PhotosResponse>(photos).photos;
    return objectiveId ? all.filter((p) => p.objective_id === objectiveId) : all;
  },
  route: () => as<RouteResult>(route),
  plan: () => (mission = as<Mission>(planResponse)),
  mission: () => structuredClone(mission),
  observation: (req: ObservationRequest) => advance(observationResponse, req.mission_version),
  contingency: (req: ContingencyRequest) => advance(contingencyResponse, req.mission_version),
  package: () => ({ ...as<MissionPackage>(missionPackage), mission: structuredClone(mission) }),
};