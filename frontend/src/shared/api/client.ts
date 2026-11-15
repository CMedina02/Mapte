import type {
  ApiError, ContingencyRequest, Health, Mission, MissionPackage, MissionPlanRequest,
  Objective, ObjectivesResponse, ObservationRequest, Photo, PhotosResponse, Region,
  PreventiveSupportRequest, PreventiveSupportResponse, RegionManifest, RegionsResponse,
  RouteRequest, RouteResult,
} from '../types/contracts';
import { MarsApiError } from './errors';
import { mockApi } from './mockAdapter';

export { MarsApiError };

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const BASE_URL = '/api/v1';
const enc = encodeURIComponent;

function assertOnline() {
  if (!navigator.onLine) {
    throw new MarsApiError(0, 'OFFLINE', 'Sin conexión: operando con el paquete local.');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  assertOnline();
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new MarsApiError(0, 'NETWORK_ERROR', 'Sin conexión con el servidor.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new MarsApiError(
      res.status,
      body?.error.code ?? `HTTP_${res.status}`,
      body?.error.message ?? res.statusText,
      body?.error.details,
    );
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

async function mocked<T>(fn: () => T): Promise<T> {
  assertOnline();
  await mockApi.ready(); // el mock carga una vez el DEM real para sus simulaciones
  await new Promise((r) => setTimeout(r, 250));
  return fn();
}

export const marsApi = {
  health: (): Promise<Health> =>
    USE_MOCK ? mocked(mockApi.health) : request('/health'),

  getRegions: (): Promise<Region[]> =>
    USE_MOCK ? mocked(mockApi.regions) : request<RegionsResponse>('/regions').then((r) => r.regions),

  getManifest: (regionId: string): Promise<RegionManifest> =>
    USE_MOCK ? mocked(mockApi.manifest) : request(`/regions/${enc(regionId)}/manifest`),

  getObjectives: (regionId: string): Promise<Objective[]> =>
    USE_MOCK
      ? mocked(mockApi.objectives)
      : request<ObjectivesResponse>(`/regions/${enc(regionId)}/objectives`).then((r) => r.objectives),

  getPhotos: (regionId: string, objectiveId?: string): Promise<Photo[]> =>
    USE_MOCK
      ? mocked(() => mockApi.photos(objectiveId))
      : request<PhotosResponse>(
          `/regions/${enc(regionId)}/photos${objectiveId ? `?objective_id=${enc(objectiveId)}` : ''}`,
        ).then((r) => r.photos),

  computeRoute: (req: RouteRequest): Promise<RouteResult> =>
    USE_MOCK ? mocked(() => mockApi.route(req)) : post('/routes/compute', req),

  planMission: (req: MissionPlanRequest): Promise<Mission> =>
    USE_MOCK ? mocked(() => mockApi.plan(req)) : post('/missions/plan', req),
  getMission: (missionId: string): Promise<Mission> =>
    USE_MOCK ? mocked(mockApi.mission) : request(`/missions/${enc(missionId)}`),

  submitObservation: (missionId: string, req: ObservationRequest): Promise<Mission> =>
    USE_MOCK ? mocked(() => mockApi.observation(req)) : post(`/missions/${enc(missionId)}/observations`, req),

  triggerContingency: (missionId: string, req: ContingencyRequest): Promise<Mission> =>
    USE_MOCK ? mocked(() => mockApi.contingency(req)) : post(`/missions/${enc(missionId)}/contingencies`, req),

  comparePreventiveSupport: (
    missionId: string,
    req: PreventiveSupportRequest,
  ): Promise<PreventiveSupportResponse> =>
    USE_MOCK
      ? mocked(() => mockApi.preventiveSupport(req))
      : post(`/missions/${enc(missionId)}/preventive-support-options`, req),

  getMissionPackage: (missionId: string): Promise<MissionPackage> =>
    USE_MOCK ? mocked(mockApi.package) : request(`/missions/${enc(missionId)}/package`),
};
