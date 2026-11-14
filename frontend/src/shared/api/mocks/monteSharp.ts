// Escenario de SIMULACIÓN: Monte Sharp (Aeolis Mons), Cráter Gale, MC-23.
// Basado en el brief del equipo. Geometría, terreno y capas son SINTÉTICOS (sample_only):
// sirven para ensayar la interfaz hasta que el backend entregue los productos reales.
import type {
  Evidence, Frame, Hazard, Layer, Objective, Photo, Position, Region,
} from '../../types/contracts';

export const REGION_ID = 'mc23-gale-mount-sharp';
export const FRAME_ID = 'MC23_GALE_SHARP_LOCAL_V1';
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
  projection_definition: 'MOCK: equirectangular local en metros, origen (0,0) en la esquina SO (−4.83435°, 137.31535°E); definición final: backend',
  longitude_direction: 'east',
  latitude_type: 'planetocentric',
};

// Terreno SINTÉTICO (no es el DEM HiRISE): ladera que sube hacia el sur, hacia Monte Sharp (~6°),
// un escarpe de 70 m (>15°) al suroeste del sector y ondulaciones suaves. Cubre toda la zona de 10 km.
export function elevationAt(zx: number, zy: number): number {
  const x = zx - SECTOR.min_x;
  const y = zy - SECTOR.min_y;
  const flank = 0.1 * (2000 - y);
  const westOnly = 1 / (1 + Math.exp((x - 850) / 40));
  const scarp = (70 * westOnly) / (1 + Math.exp((y - 650) / 18));
  const bumps = 6 * Math.sin(x / 85) * Math.cos(y / 120);
  return -4450 + flank + scarp + bumps;
}

export const ELEVATION_RANGE = { min: -4860, max: -3770 };
// Contacto mineral sintético: por debajo arcillas (lago antiguo), por encima sulfatos (clima árido)
export const CLAY_SULFATE_CONTACT_Z = -4350;

export const REGIONS: Region[] = [
  {
    region_id: REGION_ID,
    name: 'Monte Sharp (Aeolis Mons) · Cráter Gale',
    body: 'Mars',
    description:
      'Aeolis Quadrangle (MC-23). Zona de 10 × 10 km centrada en −4.75°, 137.40°E; sector de caminata de 2 × 2 km al centro. Terreno sintético.',
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
  {
    evidence_id: 'ev-hirise-dem',
    title: 'HiRISE DEM',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'HiRISE',
    source_url: 'https://www.uahirise.org/dtm/',
    credit: 'NASA/JPL-Caltech/UArizona',
    captured_at: null,
    resolution_m: 0.5,
    caveats: ['Simulación: el relieve es sintético; sustituir por el DEM HiRISE real del sector.'],
  },
  {
    evidence_id: 'ev-mola',
    title: 'MOLA',
    mission: 'Mars Global Surveyor',
    instrument: 'MOLA',
    source_url: 'https://pds-geosciences.wustl.edu/missions/mgs/mola.html',
    credit: 'NASA/GSFC',
    captured_at: null,
    resolution_m: 463,
    caveats: ['Contexto regional; no aplica a escala de caminata.'],
  },
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
];

// asset_url lo genera el mock en el navegador (imagen sintética)
export const LAYERS: Layer[] = [
  {
    layer_id: 'topography',
    kind: 'topographic',
    title: 'Topografía (sintética · sustituye HiRISE DEM)',
    asset_url: '',
    opacity_default: 1,
    resolution_m_per_pixel: 19.5,
    evidence_ids: ['ev-hirise-dem', 'ev-mola'],
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
    evidence_ids: ['ev-hirise-dem'],
  },
  {
    hazard_id: 'hz-scarp',
    kind: 'caution',
    risk_factor: 'Pendientes Críticas',
    description: 'Escarpe con inclinaciones > 15°',
    mitigation: 'Bloqueo de rutas con pendientes superiores a 15 grados (lo decide el terreno).',
    polygon: [P(0, 580), P(820, 580), P(820, 720), P(0, 720)],
    evidence_ids: ['ev-hirise-dem'],
  },
];

export const OBJECTIVES: Objective[] = [
  {
    objective_id: 'obj-clay-sulfate',
    region_id: REGION_ID,
    title: 'Contacto arcillas–sulfatos',
    position: P(900, 1000),
    science_question:
      'Transición estratigráfica de arcillas (lagos antiguos) a sulfatos (clima árido): ¿el contacto es gradual o abrupto?',
    priority_weight: 2,
    activities: ['Fotografía del contacto (Mastcam)', 'Lectura espectral (ChemCam)', 'Muestreo de ambas unidades'],
    possible_findings: ['CLAY_SULFATE_CONTACT', 'GRADUAL_TRANSITION', 'NO_CONTACT_VISIBLE'],
    evidence_ids: ['ev-crism', 'ev-hirise-dem'],
  },
  {
    objective_id: 'obj-boxwork',
    region_id: REGION_ID,
    title: 'Crestas reticulares (Boxwork)',
    position: P(1550, 520),
    science_question:
      'Análisis geoquímico de crestas boxwork: ¿hay vetas minerales por filtración de agua subterránea?',
    priority_weight: 3,
    activities: ['Inspección de vetas desde la base de la cresta', 'Análisis geoquímico (ChemCam)'],
    possible_findings: ['MINERAL_VEINS_OBSERVED', 'NO_VEINS', 'UNSAFE_TO_APPROACH'],
    evidence_ids: ['ev-hirise-dem', 'ev-crism'],
  },
];

// Gale es zona de Curiosity (Mastcam/Navcam); Mastcam-Z es de Perseverance (Jezero).
export const PHOTOS: Photo[] = OBJECTIVES.map((o) => ({
  photo_id: `ph-${o.objective_id}`,
  objective_id: o.objective_id,
  image_url: '',
  camera: 'Mastcam (Curiosity)',
  sol: null,
  captured_at: null,
  credit: 'Pendiente: imagen raw de Curiosity',
  source_url: 'https://mars.nasa.gov/msl/multimedia/raw-images/',
  location: null,
  location_quality: 'unknown',
  limitations: ['Simulación: falta elegir una imagen real con ubicación verificada.'],
}));
