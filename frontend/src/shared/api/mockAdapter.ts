import type {
  Constraints, ContingencyRequest, Health, Mission, MissionPackage, MissionPlanRequest, ObservationRequest,
  Position, RegionManifest, RouteRequest, Terrain,
} from '../types/contracts';
import { MarsApiError } from './errors';
import {
  BOUNDS, EVIDENCE, FRAME, FRAME_ID, HAZARDS, LAYERS, OBJECTIVES, PHOTOS, REAL_TERRAIN, REGIONS, REGION_ID,
  elevationAt, setElevationSampler,
} from './mocks/monteSharp';
import { simulateRoute } from './mocks/simulateRoute';

// ---------- Terreno real (DEM USGS reducido a 20 m) ----------

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

// Se descarga una sola vez antes de la primera llamada al mock; si falla, el mock usa el terreno sintético
let terrainReady: Promise<void> | null = null;
function ready(): Promise<void> {
  terrainReady ??= fetch(RT.heightmap_url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const data = new Float32Array(buf);
      if (data.length !== RT.width_px * RT.height_px) throw new Error('tamaño inesperado');
      setElevationSampler(makeSampler(data));
      manifestCache = null;
    })
    .catch((e) => console.warn('Mock: no se pudo cargar el DEM real; se usa terreno sintético.', e));
  return terrainReady;
}

// ---------- Capa mineral sintética (se dibuja en el navegador) ----------

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

// Contacto mineral SINTÉTICO: la curva de nivel que pasa por el objetivo de arcillas–sulfatos.
// Debajo arcillas (azul, lago antiguo), encima sulfatos (amarillo, clima árido), contacto en blanco.
function spectralColor(contactZ: number) {
  return (x: number, y: number): Rgba => {
    const dz = elevationAt(x, y) - contactZ;
    if (Math.abs(dz) < 3) return [255, 255, 255, 230];
    return dz < 0 ? [60, 140, 210, 150] : [235, 200, 60, 150];
  };
}

// Bloque terrain del contrato apuntando al DEM real reducido
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
    normal_map_url: RT.normal_map_url,
    grid: { ...RT.grid, row_order: 'north_to_south' },
  };
}

let manifestCache: RegionManifest | null = null;
function manifest(): RegionManifest {
  if (!manifestCache) {
    const clay = OBJECTIVES.find((o) => o.objective_id === 'obj-clay-sulfate')!.position;
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

// ---------- "Servidor" mock ----------

// Guarda misión y restricciones en localStorage para que el panel (/) y el visor (/visor),
// en pestañas distintas, vean la misma misión como con el backend real.
const STORE_KEY = 'mars.mock.state.v3'; // v3: marco real del backend (las misiones v2 usaban otro frame_id)

interface MockState {
  mission: Mission | null;
  constraints: Constraints;
}

function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    // sin almacenamiento
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

const notFound = () => new MarsApiError(404, 'MISSION_NOT_FOUND', 'No hay misión planificada.');
const positionOf = (id: string): Position | undefined => OBJECTIVES.find((o) => o.objective_id === id)?.position;
const titleOf = (id: string) => OBJECTIVES.find((o) => o.objective_id === id)?.title ?? id;

// Pruebas FE-06: VITE_MOCK_FAIL=409 o 503 en .env.local hace fallar la PRIMERA mutación (se reinicia al recargar).
let pendingFail = import.meta.env.VITE_MOCK_FAIL as string | undefined;

// Simula el control de concurrencia del backend: versión vieja => 409.
function advance(update: (m: Mission, c: Constraints) => Mission, clientVersion: number): Mission {
  const state = loadState();
  if (!state.mission) throw notFound();
  if (pendingFail === '503') {
    pendingFail = undefined;
    throw new MarsApiError(503, 'SERVICE_UNAVAILABLE', 'Servicio no disponible (simulado).');
  }
  if (pendingFail === '409') {
    pendingFail = undefined;
    state.mission.version += 1; // otro dispositivo modificó la misión
    save(state);
  }
  if (clientVersion !== state.mission.version) {
    throw new MarsApiError(409, 'VERSION_CONFLICT', 'La misión cambió en el servidor; recarga el estado.');
  }
  const next = update(structuredClone(state.mission), state.constraints);
  return save({ ...state, mission: { ...next, version: state.mission.version + 1 } });
}

export const mockApi = {
  ready,
  health: (): Health => ({ status: 'ok', api_version: 'mock' }),
  regions: () => structuredClone(REGIONS),
  manifest,
  objectives: () => structuredClone(OBJECTIVES),
  photos: (objectiveId?: string) =>
    structuredClone(objectiveId ? PHOTOS.filter((p) => p.objective_id === objectiveId) : PHOTOS),

  // Vista previa: sin recursos, no evalúa O₂
  route: (req: RouteRequest) => simulateRoute([req.start, req.end], req.constraints),

  plan: (req: MissionPlanRequest) => {
    const stops = req.objective_ids.flatMap((id) => positionOf(id) ?? []);
    const route = simulateRoute([req.base_position, ...stops, req.base_position], req.constraints, req.resources);
    return save({
      constraints: req.constraints,
      mission: {
        mission_id: 'mission-sharp-001',
        region_id: req.region_id,
        version: 1,
        status: 'planned',
        base_position: req.base_position,
        objective_ids: req.objective_ids,
        route,
        resources: req.resources,
        completed_objective_ids: [],
        next_objective_id: req.objective_ids[0] ?? null,
        alerts: route.status === 'not_viable' ? ['Plan no viable: revisa las advertencias de la ruta.'] : [],
        decision_log: [
          {
            event_type: 'plan_created',
            message: `Simulación: base → ${req.objective_ids.map(titleOf).join(' → ')} → base. Ruta ${route.status}.`,
            evidence_ids: route.evidence_ids,
            simulated: true,
          },
        ],
        evidence_ids: ['ev-trek'],
        sample_only: true,
      },
    });
  },

  mission: () => {
    const { mission } = loadState();
    if (!mission) throw notFound();
    return mission;
  },

  observation: (req: ObservationRequest) =>
    advance((m, c) => {
      const completed = [...new Set([...m.completed_objective_ids, req.objective_id])];
      const remaining = m.objective_ids.filter((id) => !completed.includes(id));
      const here = positionOf(req.objective_id) ?? m.base_position;
      const route = simulateRoute(
        [here, ...remaining.flatMap((id) => positionOf(id) ?? []), m.base_position],
        c,
        m.resources,
      );
      return {
        ...m,
        status: 'in_progress',
        completed_objective_ids: completed,
        next_objective_id: remaining[0] ?? null,
        route,
        alerts: route.status === 'not_viable' ? ['Ruta restante no viable: consulta al panel de control.'] : [],
        decision_log: [
          ...m.decision_log,
          {
            event_type: 'observation',
            message: `Simulación: ${req.finding_code} en ${titleOf(req.objective_id)}. Siguiente: ${
              remaining[0] ? titleOf(remaining[0]) : 'regreso a la base'
            } (se conserva el orden del plan).`,
            evidence_ids: [],
            simulated: true,
          },
        ],
      };
    }, req.mission_version),

  contingency: (req: ContingencyRequest) =>
    advance((m, c) => {
      const resources = { ...m.resources, oxygen_available_min: req.oxygen_available_min };
      const route = simulateRoute([req.position, m.base_position], c, resources);
      const ok = route.status === 'viable';
      return {
        ...m,
        status: 'contingency',
        resources,
        route,
        alerts: [
          ok
            ? `Contingencia ${req.contingency_type}: retorno a la base viable (${route.duration_min} min, simulado).`
            : `Contingencia ${req.contingency_type}: retorno a la base NO viable con los recursos disponibles (simulado).`,
        ],
        decision_log: [
          ...m.decision_log,
          {
            event_type: 'contingency',
            message: `Simulación: ${req.contingency_type} con ${req.oxygen_available_min} min de O₂. Retorno ${route.status}.`,
            evidence_ids: route.evidence_ids,
            simulated: true,
          },
        ],
      };
    }, req.mission_version),

  package: (): MissionPackage => {
    const { mission } = loadState();
    if (!mission) throw notFound();
    return {
      package_version: '1.0',
      mission,
      region_manifest: manifest(),
      objectives: structuredClone(OBJECTIVES),
      photos: structuredClone(PHOTOS),
      offline_assets: [RT.heightmap_url, RT.texture_url, RT.normal_map_url],
      package_status: 'mock_assets_embedded',
      generated_at: new Date().toISOString(),
      sample_only: true,
    };
  },
};
