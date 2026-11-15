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
const REAL_API = new Set(String(import.meta.env.VITE_REAL_API ?? '').split(',').map((s) => s.trim()));
const realRoutes = !USE_MOCK || REAL_API.has('routes');
// VITE_REAL_API activa rutas o misiones del backend dentro del modo simulado.
const realMissions = !USE_MOCK || REAL_API.has('missions');
const BASE_URL = '/api/v1';
const enc = encodeURIComponent;

function assertOnline() {
  if (!navigator.onLine) {
    throw new MarsApiError(0, 'OFFLINE', 'Offline: working from the local package.');
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
    throw new MarsApiError(0, 'NETWORK_ERROR', 'No connection to the server.');
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


const backendMission = (id: string) => request<Mission>(`/missions/${enc(id)}`);

const objectivePosition = (mission: Mission, objectiveId: string): Position | null =>
  mission.legs.find((leg) => leg.end_label === objectiveId)?.path.at(-1) ?? null;

const DEFAULT_ACTIVITY_MIN = 45;

// Registra el hallazgo antes de recalcular los objetivos pendientes.
async function observeInBackend(missionId: string, req: ObservationRequest): Promise<Mission> {
  let b = await backendMission(missionId);
  if (b.mission_version !== req.mission_version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'The mission was updated by another client.');
  }
  const path = `/missions/${enc(missionId)}`;
  if (b.lifecycle_status === 'draft') {
    b = await post<Mission>(`${path}/status`, { expected_version: b.mission_version, action: 'start' });
  }
  const before = b;
  const observed = await post<Mission>(`${path}/observations`, {
    mission_version: b.mission_version,
    objective_id: req.objective_id,
    finding_code: req.finding_code,
    notes: req.notes ?? null,
  });

  // ponytail: lectura de O₂ ESTIMADA (O₂ previo − tramo caminado − trabajo en el objetivo) porque el traje
  // aún no envía telemetría; cuando la haya, se manda la lectura real.
  const arrival = objectivePosition(before, req.objective_id);
  const walked = arrival ? await walkedMinutes(before, arrival) : null;
  const oxygenNow =
    walked == null
      ? before.resources.oxygen_available_min
      : Math.max(0, before.resources.oxygen_available_min - walked - DEFAULT_ACTIVITY_MIN);
  const remaining = observed.objective_ids.filter((id) => !observed.completed_objective_ids.includes(id));
  try {
    return await post<Mission>(`${path}/replan`, {
      expected_version: observed.mission_version,
      current_position: arrival ?? observed.current_position ?? observed.start_position,
      from_label: req.objective_id,
      resources: { oxygen_available_min: oxygenNow, return_reserve_min: before.resources.return_reserve_min },
      activity_durations_min: Object.fromEntries(remaining.map((id) => [id, DEFAULT_ACTIVITY_MIN])),
    });
  } catch {
    return observed; // Conserva el hallazgo si falla el recálculo.
  }
}

// Dónde está el astronauta según la misión: último recálculo o, si aún no hay, la base de salida
const missionHere = (m: Mission): Position => m.current_position ?? m.start_position;
const near = (a: Position, b: Position) => Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m) < 5;

// Minutos caminados hasta `to`. Si el astronauta siguió el tramo del plan se usa su métrica; si eligió
// otro destino desde el radar (fuera de orden o desde un punto libre) se calcula el camino real recorrido.
async function walkedMinutes(m: Mission, to: Position): Promise<number | null> {
  const from = missionHere(m);
  const planned = m.legs.find((leg) => leg.path.length > 1 && near(leg.path[0], from) && near(leg.path.at(-1)!, to));
  if (planned) return planned.metrics.duration_min;
  if (!m.routing_constraints) return null;
  return post<RouteResult>('/routes/compute', { region_id: m.region_id, start: from, end: to, constraints: m.routing_constraints })
    .then((r) => r.duration_min)
    .catch(() => null);
}

// El astronauta llegó a un punto libre marcado en el radar: la misión se recalcula desde ahí
// (POST /replan con esa posición), así la siguiente ruta ya no sale del sitio anterior.
async function moveInBackend(missionId: string, version: number, at: Position): Promise<Mission> {
  let b = await backendMission(missionId);
  if (b.mission_version !== version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'The mission was updated by another client.');
  }
  const path = `/missions/${enc(missionId)}`;
  if (b.lifecycle_status === 'draft') {
    b = await post<Mission>(`${path}/status`, { expected_version: b.mission_version, action: 'start' });
  }
  const walked = await walkedMinutes(b, at);
  const remaining = b.objective_ids.filter((id) => !b.completed_objective_ids.includes(id));
  return post<Mission>(`${path}/replan`, {
    expected_version: b.mission_version,
    current_position: { x_m: at.x_m, y_m: at.y_m, frame_id: at.frame_id },
    from_label: 'current_position',
    resources: {
      oxygen_available_min: Math.max(0, b.resources.oxygen_available_min - (walked ?? 0)),
      return_reserve_min: b.resources.return_reserve_min,
    },
    activity_durations_min: Object.fromEntries(remaining.map((id) => [id, DEFAULT_ACTIVITY_MIN])),
  });
}

// Paquete para el visor: misión del backend + catálogo (real si no hay mock, del mock en modo híbrido)
async function packageFromBackend(missionId: string): Promise<MissionPackage> {
  const mission = await backendMission(missionId);
  if (USE_MOCK) return mocked(() => ({ ...mockApi.package(mission), sample_only: false }));
  return request<MissionPackage>(`/missions/${enc(missionId)}/package`);
}

async function contingencyInBackend(missionId: string, req: ContingencyRequest): Promise<Mission> {
  let b = await backendMission(missionId);
  if (b.lifecycle_status === 'draft' && b.mission_version === req.mission_version) {
    b = await post<Mission>(`/missions/${enc(missionId)}/status`, { expected_version: b.mission_version, action: 'start' });
  }
  return post<Mission>(`/missions/${enc(missionId)}/contingencies`, { ...req, mission_version: b.mission_version });
}

// El modo híbrido puede usar el simulador ante un fallo del backend.
const backendDown = (e: unknown) => e instanceof MarsApiError && (e.status === 0 || e.status >= 500) && e.code !== 'OFFLINE';
const BACKEND_DOWN = 'Backend unavailable: straight-line route simulated by the mock.';
function withMockFallback<T extends RouteResult | Mission>(real: Promise<T>, mock: () => Promise<T>, note: (r: T) => T) {
  return real.catch(async (e: unknown) => {
    if (USE_MOCK && backendDown(e)) return note(await mock());
    throw e;
  });
}
const noteRoute = (r: RouteResult): RouteResult => ({ ...r, warnings: [BACKEND_DOWN, ...r.warnings] });

// El modo híbrido pide cada tramo al backend en paralelo.
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
  await mockApi.ready();
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

  // Llegada a un punto libre (no objetivo): mueve la posición y recalcula los tramos desde ahí
  moveTo: (mission: Mission, at: Position): Promise<Mission> =>
    realMissions
      ? moveInBackend(mission.mission_id, mission.mission_version, at)
      : mocked(() => ({ ...mission, mission_version: mission.mission_version + 1, current_position: at })),

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
