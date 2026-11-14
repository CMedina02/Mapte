import type {
  Region,
  RegionManifest,
  ScienceObjective,
  PhotoReference,
  RouteResult,
  Mission,
} from '../../types/contracts';

export const MOCK_REGIONS: Region[] = [
  {
    region_id: 'mc09-tharsis-sector-a',
    name: 'Cuadrante MC-09: Tharsis (Sector Ceraunius / Flujos Basálticos)',
    body: 'Mars',
    description:
      'Planicie volcánica con presencia de tubos de lava colapsados, fallas tectónicas (grabens) y pendientes críticas.',
    available: true,
  },
];

export const MOCK_MANIFEST: RegionManifest = {
  region_id: 'mc09-tharsis-sector-a',
  frame: {
    frame_id: 'MARS_MC09_LOCAL_V1',
    units: 'm',
    origin: { x_m: 0, y_m: 0, frame_id: 'MARS_MC09_LOCAL_V1' },
    projection_definition: '+proj=eqc +lat_ts=15 +lon_0=250 +R=3396190 +units=m +no_defs',
    longitude_direction: 'Positive East (0-360)',
    latitude_type: 'Planetocentric',
  },
  bounds_local_m: {
    min_x: 0,
    min_y: 0,
    max_x: 2000,
    max_y: 2000,
  },
  layers: [
    {
      layer_id: 'layer-optical-ctx',
      kind: 'optical',
      title: 'Mosaico Óptico MRO CTX (MC-09)',
      asset_url: '/assets/mars/mc09_optical_placeholder.png',
      opacity_default: 1.0,
      resolution_m_per_pixel: 5.0,
      evidence_ids: ['ev-mro-ctx-01'],
      nodata_policy: 'mask_transparent',
    },
    {
      layer_id: 'layer-slope-hirise',
      kind: 'slope',
      title: 'Mapa de Pendientes (Derivado DEM)',
      asset_url: '/assets/mars/mc09_slope_placeholder.png',
      opacity_default: 0.55,
      resolution_m_per_pixel: 2.0,
      evidence_ids: ['ev-mola-hrsc-02'],
      nodata_policy: 'unknown_zone_warning',
    },
    {
      layer_id: 'layer-thermal-themis',
      kind: 'thermal',
      title: 'Inercia Térmica Nocturna (THEMIS)',
      asset_url: '/assets/mars/mc09_thermal_placeholder.png',
      opacity_default: 0.45,
      resolution_m_per_pixel: 100.0,
      evidence_ids: ['ev-ody-themis-03'],
      nodata_policy: 'unknown_zone_warning',
    },
  ],
  evidence: [
    {
      evidence_id: 'ev-mro-ctx-01',
      title: 'MRO Context Camera Global Mosaic — MC-09 Tharsis',
      mission: 'Mars Reconnaissance Orbiter (MRO)',
      instrument: 'CTX',
      source_url: 'https://trek.nasa.gov/mars/',
      credit: 'NASA/JPL-Caltech/MSSS',
      captured_at: '2021-06-14T10:20:00Z',
      resolution_m: 5.0,
      caveats: 'Iluminación solar oblicua; sombras en paredes de grabens pueden ocultar rocas.',
    },
    {
      evidence_id: 'ev-mola-hrsc-02',
      title: 'HRSC-MOLA Blended Digital Elevation Model',
      mission: 'Mars Global Surveyor / Mars Express',
      instrument: 'MOLA + HRSC',
      source_url: 'https://astrogeology.usgs.gov/',
      credit: 'USGS Astrogeology / NASA / ESA',
      captured_at: '2018-03-01T00:00:00Z',
      resolution_m: 200.0,
      caveats: 'Pendientes locales menores a 50m pueden estar suavizadas en el modelo.',
    },
    {
      evidence_id: 'ev-ody-themis-03',
      title: 'THEMIS Nighttime IR Thermal Inertia',
      mission: '2001 Mars Odyssey',
      instrument: 'THEMIS',
      source_url: 'https://trek.nasa.gov/mars/',
      credit: 'NASA/JPL-Caltech/ASU',
      captured_at: '2019-11-08T03:15:00Z',
      resolution_m: 100.0,
      caveats: 'Baja inercia térmica indica acumulación de polvo fino; riesgo de atasco.',
    },
  ],
};

export const MOCK_OBJECTIVES: ScienceObjective[] = [
  {
    objective_id: 'obj-tharsis-01',
    region_id: 'mc09-tharsis-sector-a',
    title: 'Tragaluz de Tubo de Lava (Skylight Alpha)',
    position: { x_m: 680, y_m: 920, frame_id: 'MARS_MC09_LOCAL_V1' },
    science_question: '¿Presenta el subsuelo volcánico protección radiológica y minerales hidratados?',
    priority_weight: 0.9,
    activities: [
      'Medición de radiación en borde de cavidad',
      'Escaneo espectral de paredes basálticas',
    ],
    possible_findings: [
      { finding_code: 'INTACT_LAVA_TUBE', label: 'Cavidad estructuralmente estable' },
      { finding_code: 'UNSTABLE_RIM', label: 'Borde inestable / Riesgo de derrumbe' },
      { finding_code: 'HYDRATED_SILICA', label: 'Presencia de sílice hidratada' },
    ],
  },
  {
    objective_id: 'obj-tharsis-02',
    region_id: 'mc09-tharsis-sector-a',
    title: 'Escarpe de Falla Tectónica (Graben Norte)',
    position: { x_m: 1350, y_m: 1480, frame_id: 'MARS_MC09_LOCAL_V1' },
    science_question: '¿Qué estratigrafía volcánica quedó expuesta tras la deformación de Tharsis?',
    priority_weight: 0.75,
    activities: [
      'Toma de muestra de basalto columnar',
      'Fotogrametría estéreo de estratos',
    ],
    possible_findings: [
      { finding_code: 'LAYERING_OBSERVED', label: 'Estratificación volcánica clara' },
      { finding_code: 'DUST_COVERED', label: 'Afloramiento cubierto por regolito fino' },
    ],
  },
];

export const MOCK_PHOTOS: PhotoReference[] = [
  {
    photo_id: 'photo-tharsis-ref-01',
    objective_id: 'obj-tharsis-01',
    image_url: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00168/ids/edr/browse/zcam/ZL0_0168_0681863426_496EBY_N0060000ZCAM03165_1100LMJ01.JPG',
    camera: 'MASTCAM-Z (Referencia Analógica)',
    sol: 168,
    captured_at: '2021-08-10T14:12:00Z',
    credit: 'NASA/JPL-Caltech/ASU',
    source_url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/',
    location: null,
    location_quality: 'approximate',
    limitations:
      'Referencia analógica de afloramiento basáltico fracturado. Ningún rover ha operado aún en MC-09 Tharsis.',
  },
];

export const MOCK_ROUTE: RouteResult = {
  route_id: 'route-mc09-001',
  region_id: 'mc09-tharsis-sector-a',
  path: [
    { x_m: 250, y_m: 300, frame_id: 'MARS_MC09_LOCAL_V1' },
    { x_m: 410, y_m: 520, frame_id: 'MARS_MC09_LOCAL_V1' },
    { x_m: 580, y_m: 790, frame_id: 'MARS_MC09_LOCAL_V1' },
    { x_m: 680, y_m: 920, frame_id: 'MARS_MC09_LOCAL_V1' },
    { x_m: 990, y_m: 1150, frame_id: 'MARS_MC09_LOCAL_V1' },
    { x_m: 1350, y_m: 1480, frame_id: 'MARS_MC09_LOCAL_V1' },
  ],
  distance_m: 1640,
  duration_min: 82,
  ascent_m: 48,
  max_slope_deg: 13.4,
  status: 'viable',
  unknown_segments: [[4, 5]],
  warnings: [
    'Segmento 4→5 cruza zona de baja resolución DEM (200m/px); verificar pendiente visualmente.',
    'Posible acumulación de polvo fino detectada por inercia térmica THEMIS cerca de x=990m.',
  ],
  evidence_ids: ['ev-mro-ctx-01', 'ev-mola-hrsc-02', 'ev-ody-themis-03'],
  assumptions: [
    'Velocidad nominal de caminata EVA: 20 m/min en terreno firme.',
    'Pendiente máxima permitida en traje presurizado: 15.0 deg.',
    'Consumo de O2 modelado linealmente; no incluye esfuerzo extra por arena blanda.',
  ],
};

export const MOCK_MISSION: Mission = {
  mission_id: 'msn-tharsis-01',
  region_id: 'mc09-tharsis-sector-a',
  version: 1,
  status: 'planned',
  base_position: { x_m: 250, y_m: 300, frame_id: 'MARS_MC09_LOCAL_V1' },
  objective_ids: ['obj-tharsis-01', 'obj-tharsis-02'],
  route: MOCK_ROUTE,
  resources: {
    oxygen_available_min: 240,
    return_reserve_min: 60,
  },
  completed_objective_ids: [],
  next_objective_id: 'obj-tharsis-01',
  alerts: [
    {
      alert_id: 'al-01',
      severity: 'warning',
      code: 'THERMAL_DUST_ZONE',
      message: 'Baja inercia térmica en tramo medio. Mantener rumbo sobre afloramiento rocoso.',
    },
  ],
  decision_log: [
    {
      timestamp: '2026-11-14T10:30:00Z',
      step: 'PLAN_INITIALIZED',
      reason: 'Ruta calculada con A* priorizando Skylight Alpha (peso 0.9) y evitando pendientes > 15 deg.',
      evidence_ids: ['ev-mola-hrsc-02'],
    },
  ],
  evidence_ids: ['ev-mro-ctx-01', 'ev-mola-hrsc-02', 'ev-ody-themis-03'],
};