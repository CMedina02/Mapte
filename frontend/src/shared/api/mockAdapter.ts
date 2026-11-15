import type {
  Constraints, ContingencyRequest, Health, Mission, MissionPackage, MissionPlanRequest, ObservationRequest,
  MissionLeg, Position, PreventiveSupportRequest, PreventiveSupportResponse, RegionManifest, RouteRequest,
  RouteResult, RouteStatus, Terrain,
} from '../types/contracts';
import { MarsApiError } from './errors';
import {
  BOUNDS, EVIDENCE, FRAME, FRAME_ID, HAZARDS, LAYERS, OBJECTIVES, PHOTOS, REAL_TERRAIN, REGIONS, REGION_ID,
  elevationAt, setElevationSampler,
} from './mocks/monteSharp';
import { simulateRoute } from './mocks/simulateRoute';


const RT = REAL_TERRAIN;

// Interpolación bilineal sobre la cuadrícula del heightmap; null fuera de ella o sin dato
function makeSampler(data: Float32Array) {
  const { width_px: w, height_px: h, grid: g } = RT;
  return (x: number, y: number): number | null => {
    const fx = (x - g.origin_center_x_m) / g.pixel_size_x_m;
    const fy = (g.origin_center_y_m - y) / g.pixel_size_y_m;
    if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return null;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const tx = fx - x0, ty = fy - y0;
    const v = (r: number, c: number) => data[r * w + c];
    const z = v(y0, x0) * (1 - tx) * (1 - ty) + v(y0, x1) * tx * (1 - ty) + v(y1, x0) * (1 - tx) * ty + v(y1, x1) * tx * ty;
    return Number.isNaN(z) ? null : z;
  };
}

// Si falla la descarga del DEM, se usa el terreno sintético.
let terrainReady: Promise<void> | null = null;
function ready(): Promise<void> {
  terrainReady ??= fetch(RT.heightmap_url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const data = new Float32Array(buf);
      if (data.length !== RT.width_px * RT.height_px) throw new Error('unexpected size');
      setElevationSampler(makeSampler(data));
      manifestCache = null;
    })
    .catch((e) => console.warn('Mock: could not load the real DEM; using synthetic terrain.', e));
  return terrainReady;
}


type Rgba = [number, number, number, number];

function renderLayer(color: (x: number, y: number) => Rgba): string {
  const N = 512; // 10 km / 512 ≈ 19.5 m por píxel
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(N, N);
  const w = BOUNDS.max_x - BOUNDS.min_x, h = BOUNDS.max_y - BOUNDS.min_y;
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      // fila 0 = norte (max_y), igual que ImageStatic
      const [r, g, b, a] = color(BOUNDS.min_x + ((col + 0.5) * w) / N, BOUNDS.max_y - ((row + 0.5) * h) / N);
      img.data.set([r, g, b, a], (row * N + col) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function spectralColor(contactZ: number) {
  return (x: number, y: number): Rgba => {
    const dz = elevationAt(x, y) - contactZ;
    if (Math.abs(dz) < 3) return [255, 255, 255, 230];
    return dz < 0 ? [60, 140, 210, 150] : [235, 200, 60, 150];
  };
}

function terrain(): Terrain {
  return {
    heightmap_url: RT.heightmap_url,
    width_px: RT.width_px,
    height_px: RT.height_px,
    elevation_min_m: RT.elevation_min_m,
    elevation_max_m: RT.elevation_max_m,
    texture_layer_id: 'imagery',
    evidence_ids: RT.evidence_ids,
    frame_id: FRAME_ID,
    terrain_version: `${RT.source_terrain_version}-20m`,
    vertical_datum: RT.vertical_datum,
    units: 'm',
    format: 'f32',
    dtype: 'float32_little_endian',
    header_bytes: 0,
    memory_order: 'row_major',
    nodata_policy: 'f32_nan',
    texture_aligned: true, // ortofoto y DEM cubren la misma zona de 10 km
    quality_zones: RT.quality_zones as Terrain['quality_zones'],
    normal_map_url: RT.normal_map_url,
    grid: { ...RT.grid, row_order: 'north_to_south' },
  };
}

let manifestCache: RegionManifest | null = null;
function manifest(): RegionManifest {
  if (!manifestCache) {
    const clay = (OBJECTIVES.find((o) => o.objective_id === 'obj-glen-torridon-aberlady') ?? OBJECTIVES[0]).position;
    const contactZ = elevationAt(clay.x_m, clay.y_m);
    manifestCache = {
      region_id: REGION_ID,
      frame: FRAME,
      bounds_local_m: BOUNDS,
      layers: LAYERS.map((l) => (l.kind === 'spectral' ? { ...l, asset_url: renderLayer(spectralColor(contactZ)) } : l)),
      evidence: EVIDENCE,
      hazards: HAZARDS,
      terrain: terrain(),
      sample_only: true,
    };
  }
  return structuredClone(manifestCache);
}


// localStorage comparte la misión simulada entre panel y visor.
const STORE_KEY = 'mars.mock.state.v5'; // v5: contrato versionado de misión alineado con el backend

interface MockState {
  mission: Mission | null;
  constraints: Constraints;
}

function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
  }
  return { mission: null, constraints: { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true } };
}

function save(state: MockState): Mission {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // sin almacenamiento: solo memoria de esta pestaña
  }
  return structuredClone(state.mission!);
}

<<<<<<< HEAD
const notFound = () => new MarsApiError(404, 'MISSION_NOT_FOUND', 'No mission planned.');
// Como el backend: z_m de cada objetivo muestreado del DEM (null si cae sin dato)
=======
const notFound = () => new MarsApiError(404, 'MISSION_NOT_FOUND', 'No hay misión planificada.');
// Muestrea la altura de cada objetivo en el DEM.
>>>>>>> aa7575928a95d914c6953b8baa9765203b624df1
const withZ = (p: Position): Position => ({ ...p, z_m: Math.round(elevationAt(p.x_m, p.y_m) * 10) / 10 });
const objectivesWithZ = () => OBJECTIVES.map((o) => ({ ...structuredClone(o), position: withZ(o.position) }));
const positionOf = (id: string): Position | undefined => OBJECTIVES.find((o) => o.objective_id === id)?.position;
const titleOf = (id: string) => OBJECTIVES.find((o) => o.objective_id === id)?.title ?? id;

function missionLegs(points: Position[], labels: string[], constraints: Constraints, resources: Mission['resources']): MissionLeg[] {
  return points.slice(0, -1).map((start, index) => {
    const route = simulateRoute([start, points[index + 1]], constraints, resources);
    return {
      leg_id: `leg-${index + 1}`,
      route_id: route.route_id,
      start_label: labels[index],
      end_label: labels[index + 1],
      status: route.status,
      path: route.path,
      metrics: {
        distance_m: route.distance_m,
        duration_min: route.duration_min,
        ascent_m: route.ascent_m,
        max_slope_deg: route.max_slope_deg,
        unknown_segments: route.unknown_segments,
      },
      warnings: route.warnings,
      assumptions: route.assumptions,
    };
  });
}

function evaluateLegs(legs: MissionLeg[], resources: Mission['resources'], activityMin = 0): Mission['resource_evaluation'] {
  const status: RouteStatus = legs.some((leg) => leg.status === 'not_viable')
    ? 'not_viable'
    : legs.some((leg) => leg.status === 'unknown')
      ? 'unknown'
      : 'viable';
  const durations = legs.map((leg) => leg.metrics.duration_min);
  const projected = durations.some((value) => value === null)
    ? null
    : durations.reduce<number>((total, value) => total + (value ?? 0), activityMin);
  const remaining = projected === null ? null : resources.oxygen_available_min - projected;
  const margin = remaining === null ? null : remaining - resources.return_reserve_min;
  const finalStatus: RouteStatus = projected === null ? 'unknown' : margin !== null && margin < 0 ? 'not_viable' : status;
  return {
    status: finalStatus,
    known_consumption_min: durations.reduce<number>((total, value) => total + (value ?? 0), activityMin),
    projected_consumption_min: projected,
    oxygen_remaining_min: remaining,
    reserve_margin_min: margin,
    reason_codes: finalStatus === 'not_viable' ? ['INSUFFICIENT_RETURN_RESERVE'] : finalStatus === 'unknown' ? ['DURATION_UNKNOWN'] : [],
    warnings: [...new Set(legs.flatMap((leg) => leg.warnings))],
    assumptions: [...new Set(legs.flatMap((leg) => leg.assumptions))],
  };
}

function supportEvaluation(routes: RouteResult[], interventionMin: number | null, resources: Mission['resources']): Mission['resource_evaluation'] {
  const routeStatus: RouteStatus = routes.some((route) => route.status === 'not_viable')
    ? 'not_viable'
    : routes.some((route) => route.status === 'unknown')
      ? 'unknown'
      : 'viable';
  const remaining = interventionMin === null ? null : resources.oxygen_available_min - interventionMin;
  const margin = remaining === null ? null : remaining - resources.return_reserve_min;
  const status: RouteStatus = routeStatus === 'not_viable' || (margin !== null && margin < 0)
    ? 'not_viable'
    : interventionMin === null || routeStatus === 'unknown'
      ? 'unknown'
      : 'viable';
  return {
    status,
    known_consumption_min: interventionMin ?? 0,
    projected_consumption_min: interventionMin,
    oxygen_remaining_min: remaining,
    reserve_margin_min: margin,
    reason_codes: status === 'not_viable' ? ['INSUFFICIENT_RETURN_RESERVE'] : status === 'unknown' ? ['DURATION_UNKNOWN'] : [],
    warnings: [],
    assumptions: ['Consumption until intervention uses the longest arrival time.'],
  };
}

// VITE_MOCK_FAIL=409 o 503 fuerza un fallo en la primera mutación.
let pendingFail = import.meta.env.VITE_MOCK_FAIL as string | undefined;

function advance(update: (m: Mission, c: Constraints) => Mission, clientVersion: number): Mission {
  const state = loadState();
  if (!state.mission) throw notFound();
  if (pendingFail === '503') {
    pendingFail = undefined;
    throw new MarsApiError(503, 'SERVICE_UNAVAILABLE', 'Servicio no disponible (simulado).');
  }
  if (pendingFail === '409') {
    pendingFail = undefined;
    state.mission.mission_version += 1;
    save(state);
  }
  if (clientVersion !== state.mission.mission_version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'The mission changed on the server; reload the state.');
  }
  const next = update(structuredClone(state.mission), state.constraints);
  return save({ ...state, mission: { ...next, mission_version: state.mission.mission_version + 1 } });
}

export const mockApi = {
  ready,
  health: (): Health => ({ status: 'ok', api_version: 'mock' }),
  regions: () => structuredClone(REGIONS),
  manifest,
  objectives: () => objectivesWithZ(),
  photos: (objectiveId?: string) =>
    structuredClone(objectiveId ? PHOTOS.filter((p) => p.objective_id === objectiveId) : PHOTOS),

  route: (req: RouteRequest) => simulateRoute([req.start, req.end], req.constraints),

  // Paradas del plan: base → objetivos → base (el cliente híbrido pide cada tramo al A* real)
  planStops: (req: MissionPlanRequest) => [
    req.base_position,
    ...req.objective_ids.flatMap((id) => positionOf(id) ?? []),
    req.base_position,
  ],

  // Si no recibe tramos del backend, simula recorridos rectos.
  plan: (req: MissionPlanRequest, computedRoutes?: RouteResult[]) => {
    const stops = req.objective_ids.flatMap((id) => positionOf(id) ?? []);
    const points = [req.base_position, ...stops, req.base_position];
    const labels = ['base', ...req.objective_ids, 'base'];
    const legs = computedRoutes?.length
      ? computedRoutes.map((route, index): MissionLeg => ({
          leg_id: `leg-${index + 1}`,
          route_id: route.route_id,
          start_label: labels[index],
          end_label: labels[index + 1],
          status: route.status,
          path: route.path,
          metrics: {
            distance_m: route.distance_m,
            duration_min: route.duration_min,
            ascent_m: route.ascent_m,
            max_slope_deg: route.max_slope_deg,
            unknown_segments: route.unknown_segments,
          },
          warnings: route.warnings,
          assumptions: route.assumptions,
        }))
      : missionLegs(points, labels, req.constraints, req.resources);
    const activityMin = Object.values(req.activity_durations_min ?? {}).reduce((total, value) => total + value, 0);
    const resourceEvaluation = evaluateLegs(legs, req.resources, activityMin);
    return save({
      constraints: req.constraints,
      mission: {
        mission_id: `mission-sharp-${Date.now().toString(36)}`,
        mission_version: 1,
        region_id: req.region_id,
        frame_id: req.base_position.frame_id,
        terrain_version: RT.source_terrain_version,
        lifecycle_status: 'draft',
        viability_status: resourceEvaluation.status,
        start_position: req.base_position,
        current_position: null,
        return_position: req.base_position,
        objective_ids: req.objective_ids,
        completed_objective_ids: [],
        next_objective_id: req.objective_ids[0] ?? null,
        legs,
        routing_constraints: req.constraints,
        resources: req.resources,
        resource_evaluation: resourceEvaluation,
        alerts: resourceEvaluation.status === 'not_viable' ? ['MISSION_NOT_VIABLE'] : [],
        decision_log: [
          {
            event_type: 'plan_created',
            message: `Simulation: base → ${req.objective_ids.map(titleOf).join(' → ')} → base. Route ${resourceEvaluation.status}.`,
            evidence_ids: ['ev-trek'],
            simulated: true,
          },
        ],
        evidence_ids: ['ev-trek'],
        hazard_reports: [],
      },
    });
  },

  complete: (version: number) =>
    advance((m) => ({ ...m, lifecycle_status: 'completed', current_position: m.return_position, next_objective_id: null }), version),

  mission: () => {
    const { mission } = loadState();
    if (!mission) throw notFound();
    return mission;
  },

  observation: (req: ObservationRequest) =>
    advance((m, c) => {
      const completed = [...new Set([...m.completed_objective_ids, req.objective_id])];
      const remaining = m.objective_ids.filter((id) => !completed.includes(id));
      const here = positionOf(req.objective_id) ?? m.return_position;
      const points = [here, ...remaining.flatMap((id) => positionOf(id) ?? []), m.return_position];
      const legs = missionLegs(points, [req.objective_id, ...remaining, 'base'], c, m.resources);
      const resourceEvaluation = evaluateLegs(legs, m.resources);
      return {
        ...m,
        lifecycle_status: 'active',
        viability_status: 'unknown',
        current_position: here,
        completed_objective_ids: completed,
        next_objective_id: remaining[0] ?? null,
        legs,
        resource_evaluation: resourceEvaluation,
        alerts: ['ROUTE_REVALIDATION_REQUIRED'],
        decision_log: [
          ...m.decision_log,
          {
            event_type: 'observation',
            message: `Simulation: ${req.finding_code} at ${titleOf(req.objective_id)}. Next: ${
              remaining[0] ? titleOf(remaining[0]) : 'return to base'
            } (se conserva el orden del plan).`,
            evidence_ids: [],
            simulated: true,
          },
        ],
      };
    }, req.mission_version),

  contingency: (req: ContingencyRequest) =>
    advance((m, c) => {
      if (req.contingency_type === 'rover_unavailable') {
        throw new MarsApiError(400, 'UNMODELED_CONTINGENCY', 'The rover_unavailable scenario does not have a valid operational model yet.');
      }
      const resources = { ...m.resources, oxygen_available_min: req.oxygen_available_min };
      const legs = missionLegs([req.position, m.return_position], ['current_position', 'base'], c, resources);
      const resourceEvaluation = evaluateLegs(legs, resources);
      const ok = resourceEvaluation.status === 'viable';
      return {
        ...m,
        viability_status: resourceEvaluation.status,
        current_position: req.position,
        resources,
        resource_evaluation: resourceEvaluation,
        legs,
        next_objective_id: null,
        alerts: [
          'OXYGEN_REDUCED',
          ok
            ? `Contingency ${req.contingency_type}: return to base viable (${legs[0].metrics.duration_min} min, simulated).`
            : `Contingency ${req.contingency_type}: return to base NOT viable with the available resources (simulated).`,
        ],
        decision_log: [
          ...m.decision_log,
          {
            event_type: 'contingency',
            message: `Simulation: ${req.contingency_type} with ${req.oxygen_available_min} min of O₂. Return ${resourceEvaluation.status}.`,
            evidence_ids: m.evidence_ids,
            simulated: true,
          },
        ],
      };
    }, req.mission_version),

  preventiveSupport: (req: PreventiveSupportRequest): PreventiveSupportResponse => {
    const { mission } = loadState();
    if (!mission) throw notFound();
    if (req.mission_version !== mission.mission_version) {
      throw new MarsApiError(409, 'VERSION_CONFLICT', 'The mission changed on the server; reload the state.');
    }
    const resources = { ...mission.resources, oxygen_available_min: req.oxygen_available_min };
    const constraints = mission.routing_constraints ?? { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true };
    const direct = simulateRoute([req.crew_position, mission.return_position], constraints, resources);
    const vehicle = simulateRoute(
      [req.support_vehicle_position, req.crew_position],
      { ...constraints, speed_m_per_min: req.vehicle_speed_m_per_min },
    );
    const directTime = direct.duration_min;
    const rendezvousTime = vehicle.duration_min;
    const options: PreventiveSupportResponse['options'] = [
      {
        option_id: 'direct-return', kind: 'direct_return', support_position: mission.return_position,
        crew_route: direct, vehicle_route: null, intervention_time_min: directTime,
        total_distance_m: direct.distance_m, resource_evaluation: supportEvaluation([direct], directTime, resources),
      },
      {
        option_id: 'rendezvous-1', kind: 'rendezvous', support_position: req.crew_position,
        crew_route: simulateRoute([req.crew_position, req.crew_position], constraints), vehicle_route: vehicle,
        intervention_time_min: rendezvousTime, total_distance_m: vehicle.distance_m,
        resource_evaluation: supportEvaluation([vehicle], rendezvousTime, resources),
      },
    ];
    const viable = options.filter((option) => option.resource_evaluation.status !== 'not_viable');
    viable.sort((a, b) => (a.intervention_time_min ?? Infinity) - (b.intervention_time_min ?? Infinity));
    return {
      mission_id: mission.mission_id,
      mission_version: mission.mission_version,
      terrain_version: mission.terrain_version,
      options,
      recommended_option_id: viable[0]?.option_id ?? null,
      warnings: viable.length ? ['SIMULATED_DECISION_SUPPORT_ONLY'] : ['SIMULATED_DECISION_SUPPORT_ONLY', 'NO_OPTION_PRESERVES_MODELED_RESERVE'],
      assumptions: ['Reduced mock; the real backend samples points along the current route.'],
      generated_at: new Date().toISOString(),
    };
  },

  package: (override?: Mission): MissionPackage => {
    const mission = override ?? loadState().mission;
    if (!mission) throw notFound();
    return {
      package_version: '1.0',
      mission,
      region_manifest: manifest(),
      objectives: objectivesWithZ(),
      photos: structuredClone(PHOTOS),
      offline_assets: [RT.heightmap_url, RT.texture_url, RT.normal_map_url],
      missing_assets: [],
      package_status: 'ready_to_sync',
      sync: {
        mission_version: mission.mission_version,
        requires_network: false,
        remote_asset_count: 0,
        missing_asset_count: 0,
      },
      generated_at: new Date().toISOString(),
      sample_only: true,
    };
  },
};
