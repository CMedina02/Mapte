import type {
  Health, Mission, MissionPackage, MissionPlanRequest, ObjectivesResponse, ObservationRequest,
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

let pendingFail = import.meta.env.VITE_MOCK_FAIL as string | undefined;

function advance(next: unknown, clientVersion: number): Mission {
  if (pendingFail === '503') {
    pendingFail = undefined;
    throw new MarsApiError(503, 'SERVICE_UNAVAILABLE', 'Servicio no disponible (simulado).');
  }
  if (pendingFail === '409') {
    pendingFail = undefined;
    mission = { ...mission, version: mission.version + 1 }; 
  }
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
  plan: (req: MissionPlanRequest) => {
    const example = as<Mission>(planResponse);
    const all = as<ObjectivesResponse>(objectives).objectives;
    const stops = req.objective_ids.flatMap((id) => all.filter((o) => o.objective_id === id));
    mission = {
      ...example,
      region_id: req.region_id,
      base_position: req.base_position,
      objective_ids: req.objective_ids,
      next_objective_id: req.objective_ids[0] ?? null,
      resources: req.resources,
      route: {
        ...example.route,
        path: [req.base_position, ...stops.map((o) => o.position)],
        distance_m: null,
        duration_min: null,
        ascent_m: null,
        max_slope_deg: null,
        status: 'unknown',
        warnings: ['Ruta mock en línea recta: el backend real calcula la ruta y sus métricas.'],
      },
    };
    return structuredClone(mission);
  },  mission: () => structuredClone(mission),
  observation: (req: ObservationRequest) => advance(observationResponse, req.mission_version),
  contingency: (req: ContingencyRequest) => advance(contingencyResponse, req.mission_version),
  package: () => ({ ...as<MissionPackage>(missionPackage), mission: structuredClone(mission) }),
};