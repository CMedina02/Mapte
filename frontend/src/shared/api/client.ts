import type {
  ApiError, ContingencyRequest, Health, Mission, MissionPackage, MissionPlanRequest,
  Objective, ObjectivesResponse, ObservationRequest, Photo, PhotosResponse, Position, Region,
  PreventiveSupportRequest, PreventiveSupportResponse, RegionManifest, RegionsResponse,
  RouteRequest, RouteResult,
} from '../types/contracts';
import { MarsApiError } from './errors';
import { mockApi } from './mockAdapter';

export { MarsApiError };

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
// Modo híbrido: endpoints que el backend YA publica, usados aunque el resto siga en mock.
// VITE_REAL_API=routes → rutas con el A* real (POST /routes/compute); misiones siguen simuladas.
const REAL_API = new Set(String(import.meta.env.VITE_REAL_API ?? '').split(',').map((s) => s.trim()));
const realRoutes = !USE_MOCK || REAL_API.has('routes');
// VITE_REAL_API=routes,missions → misiones persistidas en el backend (plan, consulta, progreso)
const realMissions = !USE_MOCK || REAL_API.has('missions');
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
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

// ---------- Misiones del backend ----------

const backendMission = (id: string) => request<Mission>(`/missions/${enc(id)}`);

const objectivePosition = (mission: Mission, objectiveId: string): Position | null =>
  mission.legs.find((leg) => leg.end_label === objectiveId)?.path.at(-1) ?? null;

// Registrar un hallazgo: (1) iniciar la misión si sigue en borrador, (2) mover la posición actual al objetivo
// (PATCH /progress; /observations no la mueve), (3) POST /observations valida el código y completa el objetivo.
async function observeInBackend(missionId: string, req: ObservationRequest): Promise<Mission> {
  let b = await backendMission(missionId);
  if (b.mission_version !== req.mission_version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'La misión fue actualizada por otro cliente.');
  }
  const path = `/missions/${enc(missionId)}`;
  if (b.lifecycle_status === 'draft') {
    b = await post<Mission>(`${path}/status`, { expected_version: b.mission_version, action: 'start' });
  }
  const at = objectivePosition(b, req.objective_id);
  if (at) {
    b = await patch<Mission>(`${path}/progress`, {
      expected_version: b.mission_version,
      current_position: at,
      completed_objective_ids: b.completed_objective_ids,
      resources: b.resources,
    });
  }
  return post<Mission>(`${path}/observations`, {
    mission_version: b.mission_version,
    objective_id: req.objective_id,
    finding_code: req.finding_code,
    notes: req.notes ?? null,
  });
}

// Paquete para el visor: misión del backend + catálogo (real si no hay mock, del mock en modo híbrido)
async function packageFromBackend(missionId: string): Promise<MissionPackage> {
  const mission = await backendMission(missionId);
  if (USE_MOCK) return mocked(() => ({ ...mockApi.package(mission), sample_only: false }));
  return request<MissionPackage>(`/missions/${enc(missionId)}/package`);
}

// Contingencia de O₂: el backend recalcula el regreso a base desde la posición dada (solo misiones activas)
async function contingencyInBackend(missionId: string, req: ContingencyRequest): Promise<Mission> {
  let b = await backendMission(missionId);
  if (b.lifecycle_status === 'draft' && b.mission_version === req.mission_version) {
    b = await post<Mission>(`/missions/${enc(missionId)}/status`, { expected_version: b.mission_version, action: 'start' });
  }
  return post<Mission>(`/missions/${enc(missionId)}/contingencies`, { ...req, mission_version: b.mission_version });
}

// Backend apagado o caído (el proxy de Vite responde 5xx): en modo híbrido se vuelve al mock con aviso
const backendDown = (e: unknown) => e instanceof MarsApiError && (e.status === 0 || e.status >= 500) && e.code !== 'OFFLINE';
const BACKEND_DOWN = 'Backend no disponible: ruta simulada en línea recta por el mock.';
function withMockFallback<T extends RouteResult | Mission>(real: Promise<T>, mock: () => Promise<T>, note: (r: T) => T) {
  return real.catch(async (e: unknown) => {
    if (USE_MOCK && backendDown(e)) return note(await mock());
    throw e;
  });
}
const noteRoute = (r: RouteResult): RouteResult => ({ ...r, warnings: [BACKEND_DOWN, ...r.warnings] });

// Plan del mock con tramos del A* real: base → objetivos → base, un POST por tramo (en paralelo)
async function planWithRealRoutes(req: MissionPlanRequest): Promise<Mission> {
  assertOnline();
  await mockApi.ready();
  const stops = mockApi.planStops(req);
  const legs = await Promise.all(
    stops.slice(1).map((end, i) =>
      post<RouteResult>('/routes/compute', { region_id: req.region_id, start: stops[i], end, constraints: req.constraints }),
    ),
  );
  return mockApi.plan(req, legs);
}

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
    realRoutes
      ? withMockFallback(post<RouteResult>('/routes/compute', req), () => mocked(() => mockApi.route(req)), noteRoute)
      : mocked(() => mockApi.route(req)),

  planMission: (req: MissionPlanRequest): Promise<Mission> =>
    realMissions
      ? post<Mission>('/missions/plan', req)
      : realRoutes
        ? withMockFallback(planWithRealRoutes(req), () => mocked(() => mockApi.plan(req)), (m) => ({ ...m, alerts: [BACKEND_DOWN, ...m.alerts] }))
        : mocked(() => mockApi.plan(req)),
  getMission: (missionId: string): Promise<Mission> =>
    realMissions ? backendMission(missionId) : mocked(mockApi.mission),

  submitObservation: (missionId: string, req: ObservationRequest): Promise<Mission> =>
    realMissions ? observeInBackend(missionId, req) : mocked(() => mockApi.observation(req)),

  triggerContingency: (missionId: string, req: ContingencyRequest): Promise<Mission> =>
    realMissions ? contingencyInBackend(missionId, req) : mocked(() => mockApi.contingency(req)),

  // De vuelta en la base con todos los objetivos: cierra la misión (backend: POST /status action=complete)
  completeMission: (missionId: string, version: number, at: Position): Promise<Mission> =>
    realMissions
      ? post<Mission>(`/missions/${enc(missionId)}/status`, {
          expected_version: version,
          action: 'complete',
          current_position: { x_m: at.x_m, y_m: at.y_m, frame_id: at.frame_id },
        })
      : mocked(() => mockApi.complete(version)),

  comparePreventiveSupport: (
    missionId: string,
    req: PreventiveSupportRequest,
  ): Promise<PreventiveSupportResponse> =>
    realMissions
      ? post(`/missions/${enc(missionId)}/preventive-support-options`, req)
      : mocked(() => mockApi.preventiveSupport(req)),

  getMissionPackage: (missionId: string): Promise<MissionPackage> =>
    realMissions ? packageFromBackend(missionId) : mocked(() => mockApi.package()),
};
