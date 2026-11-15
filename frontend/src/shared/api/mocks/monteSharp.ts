// Escenario de Monte Sharp con DEM, ortofoto y catálogo de Curiosity. Los riesgos y la capa mineral son sintéticos.
import type {
  Evidence, Frame, Hazard, Layer, Objective, Photo, Position, Region,
} from '../../types/contracts';
import realTerrain from './realTerrain.json' with { type: 'json' };
import realCatalog from './realCatalog.json' with { type: 'json' };

export const REAL_TERRAIN = realTerrain;

export const REGION_ID = 'mc23-gale-mount-sharp';
export const FRAME_ID = realTerrain.frame_id;
// Origen (0,0) en la esquina suroeste; X hacia el este, Y hacia el norte.
// Conversión aproximada de grados a metros, exclusiva del simulador.
export const BOUNDS = { min_x: 0, min_y: 0, max_x: 10000, max_y: 10000 };

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

// Si no se cargó el DEM, usa una ladera y un escarpe sintéticos.
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
    name: 'Mount Sharp (Aeolis Mons) · Gale Crater',
    body: 'Mars',
    description:
      'Aeolis Quadrangle (MC-23). 10 × 10 km zone centered at −4.75°, 137.40°E; 2 × 2 km walking sector in the center. USGS DEM and orthophoto; objectives at real Curiosity sites; simulated hazards.',
    available: true,
  },
];

export const EVIDENCE: Evidence[] = [
  {
    evidence_id: 'ev-trek',
    title: 'NASA Mars Trek',
    mission: 'Various',
    instrument: 'Map portal',
    source_url: 'https://trek.nasa.gov/mars/',
    credit: 'NASA/JPL-Caltech',
    captured_at: null,
    resolution_m: null,
    caveats: ["Team reference source; this scenario's layers are synthetic."],
  },
  ...realTerrain.sources.map((src) => ({
    evidence_id: src.evidence_id,
    title: src.title,
    mission: 'Mars Science Laboratory (HiRISE, MRO)',
    instrument: src.evidence_id.includes('ortho') ? 'HiRISE (orthophoto)' : 'HiRISE (DEM)',
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
    caveats: ['Simulation: synthetic mineral map (clays below, sulfates above).'],
  },
  ...(realCatalog.evidence as Evidence[]),
];

export const LAYERS: Layer[] = [
  {
    layer_id: 'imagery',
    kind: 'optical',
    title: 'HiRISE orthophoto (USGS MSL Gale 25 cm v3)',
    asset_url: realTerrain.texture_url,
    opacity_default: 1,
    resolution_m_per_pixel: 10000 / 2048,
    evidence_ids: [realTerrain.evidence_ids[1]],
    nodata_policy: 'unknown',
  },
  {
    layer_id: 'spectroscopy',
    kind: 'spectral',
    title: 'Mineralogy (synthetic · stands in for CRISM)',
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
    risk_factor: 'Aeolian Dune Fields',
    description: 'Loose, active sand',
    mitigation: 'Exclusion area: avoid sinking or loss of traction.',
    polygon: [P(1100, 1150), P(1650, 1100), P(1750, 1450), P(1400, 1600), P(1080, 1450)],
    evidence_ids: ['ev-trek'],
  },
  {
    hazard_id: 'hz-boxwork',
    kind: 'caution',
    risk_factor: 'Boxwork Ridges',
    description: 'Narrow, fractured crests',
    mitigation: 'Stability alert: risk of tripping or falling in a rigid pressurized suit.',
    polygon: [P(1300, 350), P(1750, 330), P(1780, 700), P(1320, 720)],
    evidence_ids: [realTerrain.evidence_ids[0]],
  },
];

// El simulador toma del DEM la altura ausente de los objetivos.
// Se actualizan con: python scripts/import_backend_terrain.py
export const OBJECTIVES = realCatalog.objectives as Objective[];
export const PHOTOS = realCatalog.photos as Photo[];
