export interface Position {
  x_m: number;
  y_m: number;
  z_m?: number | null;
  frame_id: string;
}

export interface Constraints {
  max_slope_deg: number;
  speed_m_per_min: number;
  avoid_unknown: boolean;
}

export interface Resources {
  oxygen_available_min: number;
  return_reserve_min: number;
}

export interface Health {
  status: 'ok' | 'degraded';
  api_version: string;
}

export interface Region {
  region_id: string;
  name: string;
  body: 'Mars';
  description: string;
  available: boolean;
}

export interface RegionsResponse {
  regions: Region[];
}

export interface Frame {
  frame_id: string;
  units: 'm';
  origin_east_lon_deg: number;
  origin_planetocentric_lat_deg: number;
  projection_definition: string;
  longitude_direction: 'east' | 'west';
  latitude_type: 'planetocentric' | 'planetographic';
}

export interface Bounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface Evidence {
  evidence_id: string;
  title: string;
  mission: string;
  instrument: string;
  source_url: string;
  credit: string;
  captured_at: string | null;
  resolution_m: number | null;
  caveats: string[];
}

export type LayerKind = 'optical' | 'topographic' | 'geologic' | 'thermal' | 'spectral' | 'other';

export interface Layer {
  layer_id: string;
  kind: LayerKind;
  title: string;
  asset_url: string;
  opacity_default: number;
  resolution_m_per_pixel: number;
  evidence_ids: string[];
  nodata_policy: 'unknown';
}

// PROPUESTA (pendiente de contrato): zonas de riesgo del sector.
// exclusion = la ruta no puede cruzarla; caution = se cruza con alerta.
export interface Hazard {
  hazard_id: string;
  kind: 'exclusion' | 'caution';
  risk_factor: string;
  description: string;
  mitigation: string;
  polygon: Position[];
  evidence_ids: string[];
}

export interface RegionManifest {
  region_id: string;
  frame: Frame;
  bounds_local_m: Bounds;
  layers: Layer[];
  evidence: Evidence[];
  sample_only?: boolean;
  terrain?: Terrain;
  hazards?: Hazard[]; // PROPUESTA: pendiente de acordar con backend (hoy solo la usa el mock)
}

export interface TerrainGrid {
  origin_center_x_m: number;
  origin_center_y_m: number;
  pixel_size_x_m: number;
  pixel_size_y_m: number;
  row_order: 'north_to_south';
}

export interface Terrain {
  heightmap_url: string; 
  width_px: number;
  height_px: number;
  elevation_min_m: number;
  elevation_max_m: number;
  texture_layer_id: string;
  evidence_ids: string[];
  frame_id: string;
  terrain_version: string;
  vertical_datum: string;
  units: 'm';
  format: 'f32';
  dtype: 'float32_little_endian';
  header_bytes: 0;
  memory_order: 'row_major';
  nodata_policy: 'f32_nan';
  texture_aligned: boolean;
  // PROPUESTA (pendiente con backend): normal map RGB en espacio tangente (R=este, G=norte, B=arriba)
  // con el relieve fino que el heightmap no representa; cubre la misma extensión que el heightmap.
  normal_map_url?: string | null;
  grid: TerrainGrid;
}

export interface Objective {
  objective_id: string;
  region_id: string;
  title: string;
  position: Position;
  science_question: string;
  priority_weight: number;
  activities: string[];
  possible_findings: string[];
  evidence_ids: string[];
}

export interface ObjectivesResponse {
  objectives: Objective[];
}

export type LocationQuality = 'verified' | 'approximate' | 'unknown';

export interface Photo {
  photo_id: string;
  objective_id: string;
  image_url: string;
  camera: string;
  sol: number | null;
  captured_at: string | null;
  credit: string;
  source_url: string;
  location: Position | null;
  location_quality: LocationQuality;
  limitations: string[];
}

export interface PhotosResponse {
  photos: Photo[];
  sample_only?: boolean;
}

export interface RouteRequest {
  region_id: string;
  start: Position;
  end: Position;
  constraints: Constraints;
}

export type RouteStatus = 'viable' | 'not_viable' | 'unknown';

export interface RouteResult {
  route_id: string;
  region_id: string;
  path: Position[];
  distance_m: number | null;
  duration_min: number | null;
  ascent_m: number | null;
  max_slope_deg: number | null;
  status: RouteStatus;
  unknown_segments: number;
  warnings: string[];
  evidence_ids: string[];
  assumptions: string[];
  sample_only?: boolean;
}


export interface MissionPlanRequest {
  region_id: string;
  base_position: Position;
  objective_ids: string[];
  constraints: Constraints;
  resources: Resources;
}

export interface Decision {
  event_type: string;
  message: string;
  evidence_ids: string[];
  simulated: boolean;
}

export type MissionStatus = 'planned' | 'in_progress' | 'contingency' | 'completed' | 'cancelled';

export interface Mission {
  mission_id: string;
  region_id: string;
  version: number;
  status: MissionStatus;
  base_position: Position;
  objective_ids: string[];
  route: RouteResult;
  resources: Resources;
  completed_objective_ids: string[];
  next_objective_id: string | null;
  alerts: string[];
  decision_log: Decision[];
  evidence_ids: string[];
  sample_only?: boolean;
}

export interface ObservationRequest {
  mission_version: number;
  objective_id: string;
  finding_code: string;
  notes?: string;
}

export type ContingencyType = 'oxygen_reduced' | 'rover_unavailable';

export interface ContingencyRequest {
  mission_version: number;
  contingency_type: ContingencyType;
  position: Position;
  oxygen_available_min: number;
}

export interface MissionPackage {
  package_version: string;
  mission: Mission;
  region_manifest: RegionManifest;
  objectives: Objective[];
  photos: Photo[];
  offline_assets: string[];
  package_status: string;
  generated_at: string;
  sample_only?: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
  };
}