// Escenario de SIMULACIÓN: Monte Sharp (Aeolis Mons), Cráter Gale, MC-23.
// Terreno y ortofoto REALES del backend (USGS MSL Gale, reducidos para el navegador con
// scripts/import_backend_terrain.py). Objetivos, zonas de riesgo y capa mineral siguen siendo
// SINTÉTICOS (sample_only) hasta que el backend los entregue.
import type {
  Evidence, Frame, Hazard, Layer, Objective, Photo, Position, Region,
} from '../../types/contracts';
import realTerrain from './realTerrain.json' with { type: 'json' };
import realCatalog from './realCatalog.json' with { type: 'json' };

export const REAL_TERRAIN = realTerrain;

export const REGION_ID = 'mc23-gale-mount-sharp';
export const FRAME_ID = realTerrain.frame_id; // marco del backend (MARS_GALE_MS_LOCAL_V1)
// Zona real que descarga el backend: 10 × 10 km, esquinas −4.66564°/−4.83435° N-S y 137.31535°/137.48465° E.
// Origen (0,0) en la esquina suroeste; X hacia el este, Y hacia el norte.
// ponytail: conversión grados→metros solo para el mock (1° lat ≈ 59,275 m); el marco oficial lo define el pipeline.
export const BOUNDS = { min_x: 0, min_y: 0, max_x: 10000, max_y: 10000 };

// Sector de caminata (EVA) de 2 × 2 km en el centro de la zona (≈ −4.75°, 137.40°E)
export const SECTOR = { min_x: 4000, min_y: 4000, max_x: 6000, max_y: 6000 };

// Las posiciones del escenario se escriben relativas al sector y se trasladan al marco de la zona
const P = (x: number, y: number): Position => ({ x_m: x + SECTOR.min_x, y_m: y + SECTOR.min_y, frame_id: FRAME_ID });

export const FRAME: Frame = {
  frame_id: FRAME_ID,
  units: 'm',
  origin_east_lon_deg: 137.31535,
  origin_planetocentric_lat_deg: -4.83435,
  projection_definition: realTerrain.sector.local_crs_proj,
  longitude_direction: 'east',
  latitude_type: 'planetocentric',
};

// Elevación: si el mock ya cargó el DEM real, se usa ese; si no (p. ej. el check en Node),
// un terreno SINTÉTICO: ladera hacia el sur (~6°), un escarpe de 70 m (>15°) y ondulaciones.
let sampler: ((x: number, y: number) => number | null) | null = null;
export function setElevationSampler(fn: (x: number, y: number) => number | null) {
  sampler = fn;
}
export const usingRealTerrain = () => sampler !== null;

export function elevationAt(zx: number, zy: number): number {
  const real = sampler?.(zx, zy);
  if (real != null) return real;
  const x = zx - SECTOR.min_x;
  const y = zy - SECTOR.min_y;
  const flank = 0.1 * (2000 - y);
  const westOnly = 1 / (1 + Math.exp((x - 850) / 40));
  const scarp = (70 * westOnly) / (1 + Math.exp((y - 650) / 18));
  const bumps = 6 * Math.sin(x / 85) * Math.cos(y / 120);
  return -4450 + flank + scarp + bumps;
}

export const ELEVATION_RANGE = { min: -4860, max: -3770 }; // del terreno sintético

export const REGIONS: Region[] = [
  {
    region_id: REGION_ID,
    name: 'Monte Sharp (Aeolis Mons) · Cráter Gale',
    body: 'Mars',
    description:
      'Aeolis Quadrangle (MC-23). Zona de 10 × 10 km centrada en −4.75°, 137.40°E; sector de caminata de 2 × 2 km al centro. DEM y ortofoto USGS; objetivos en sitios reales de Curiosity; riesgos simulados.',
    available: true,
  },
];

export const EVIDENCE: Evidence[] = [
  {
    evidence_id: 'ev-trek',
    title: 'NASA Mars Trek',
    mission: 'Varias',
    instrument: 'Portal cartográfico',
    source_url: 'https://trek.nasa.gov/mars/',
    credit: 'NASA/JPL-Caltech',
    captured_at: null,
    resolution_m: null,
    caveats: ['Fuente de referencia del equipo; las capas de este escenario son sintéticas.'],
  },
  ...realTerrain.sources.map((src) => ({
    evidence_id: src.evidence_id,
    title: src.title,
    mission: 'Mars Science Laboratory (HiRISE, MRO)',
    instrument: src.evidence_id.includes('ortho') ? 'HiRISE (ortofoto)' : 'HiRISE (DEM)',
    source_url: src.download_url,
    credit: src.provider,
    captured_at: null,
    resolution_m: src.resolution_m,
    caveats: realTerrain.limitations,
  })),
  {
    evidence_id: 'ev-crism',
    title: 'CRISM',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'CRISM',
    source_url: 'https://pds-geosciences.wustl.edu/missions/mro/crism.htm',
    credit: 'NASA/JPL-Caltech/JHUAPL',
    captured_at: null,
    resolution_m: 18,
    caveats: ['Simulación: mapa mineral sintético (arcillas abajo, sulfatos arriba).'],
  },
  ...(realCatalog.evidence as Evidence[]),
];

// La ortofoto es real (reducida a 2048 px); la capa mineral la dibuja el mock en el navegador
export const LAYERS: Layer[] = [
  {
    layer_id: 'imagery',
    kind: 'optical',
    title: 'Ortofoto HiRISE (USGS MSL Gale 25 cm v3)',
    asset_url: realTerrain.texture_url,
    opacity_default: 1,
    resolution_m_per_pixel: 10000 / 2048,
    evidence_ids: [realTerrain.evidence_ids[1]],
    nodata_policy: 'unknown',
  },
  {
    layer_id: 'spectroscopy',
    kind: 'spectral',
    title: 'Mineralogía (sintética · sustituye CRISM)',
    asset_url: '',
    opacity_default: 0.6,
    resolution_m_per_pixel: 19.5,
    evidence_ids: ['ev-crism'],
    nodata_policy: 'unknown',
  },
];

export const HAZARDS: Hazard[] = [
  {
    hazard_id: 'hz-dunes',
    kind: 'exclusion',
    risk_factor: 'Campos de Dunas Eólicas',
    description: 'Arena suelta y activa',
    mitigation: 'Área de exclusión: evitar hundimiento o pérdida de tracción.',
    polygon: [P(1100, 1150), P(1650, 1100), P(1750, 1450), P(1400, 1600), P(1080, 1450)],
    evidence_ids: ['ev-trek'],
  },
  {
    hazard_id: 'hz-boxwork',
    kind: 'caution',
    risk_factor: 'Crestas de Boxwork',
    description: 'Cimas estrechas y agrietadas',
    mitigation: 'Alerta de estabilidad: riesgo de tropiezo o caída con traje presurizado rígido.',
    polygon: [P(1300, 350), P(1750, 330), P(1780, 700), P(1320, 720)],
    evidence_ids: [realTerrain.evidence_ids[0]],
  },
];

// Objetivos y fotos REALES del catálogo del backend: sitios de perforación de Curiosity (waypoints
// localizados de NASA/JPL) e imágenes raw de esos soles. z_m llega vacío: el mock lo toma del DEM.
// Se actualizan con: python scripts/import_backend_terrain.py
export const OBJECTIVES = realCatalog.objectives as Objective[];
export const PHOTOS = realCatalog.photos as Photo[];
