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

// Zona del DEM con calidad no nominal (p. ej. artefactos): 'unknown' nunca se presenta como segura
export interface QualityZone {
  zone_id: string;
  quality: 'nominal' | 'unknown';
  extent_m: { x_min_m: number; x_max_m: number; y_min_m: number; y_max_m: number };
  reason: string;
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
  // Opcionales que ya publica el backend (schemas.py → TerrainManifestSchema)
  texture_url?: string | null;
  blocked_mask_url?: string | null;
  dataset_checksum_sha256?: string | null;
  sector_id?: string;
  quality_zones?: QualityZone[];
}

export interface Objective {
  objective_id: string;
  region_id: string;
  title: string;
  description?: string; // contexto del sitio (el backend lo envía; puede venir vacío)
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
  frame_id: string;
  terrain_version: string;
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
  // Minutos de actividad en cada objetivo: sin ellos el backend no puede asegurar el O₂ (viabilidad 'unknown')
  activity_durations_min?: Record<string, number>;
}

export interface Decision {
  event_type: string;
  message: string;
  evidence_ids: string[];
  simulated: boolean;
}

export type MissionLifecycleStatus = 'draft' | 'active' | 'completed' | 'aborted';

export interface MissionRouteMetrics {
  distance_m: number | null;
  duration_min: number | null;
  ascent_m: number | null;
  max_slope_deg: number | null;
  unknown_segments: number;
}

export interface MissionLeg {
  leg_id: string;
  route_id: string;
  start_label: string;
  end_label: string;
  status: RouteStatus;
  path: Position[];
  metrics: MissionRouteMetrics;
  warnings: string[];
  assumptions: string[];
}

export interface ResourceEvaluation {
  status: RouteStatus;
  known_consumption_min: number;
  projected_consumption_min: number | null;
  oxygen_remaining_min: number | null;
  reserve_margin_min: number | null;
  reason_codes: string[];
  warnings: string[];
  assumptions: string[];
}

export interface HazardReport {
  report_id: string;
  mission_version: number;
  position: Position;
  hazard_code: string;
  effect: 'blocked' | 'unknown' | 'high_cost';
  affected_radius_m: number;
  cost_multiplier: number;
}

export interface Mission {
  mission_id: string;
  mission_version: number;
  region_id: string;
  frame_id: string;
  terrain_version: string;
  lifecycle_status: MissionLifecycleStatus;
  viability_status: RouteStatus;
  start_position: Position;
  current_position: Position | null;
  return_position: Position;
  objective_ids: string[];
  completed_objective_ids: string[];
  next_objective_id: string | null;
  legs: MissionLeg[];
  routing_constraints: Constraints | null;
  resources: Resources;
  resource_evaluation: ResourceEvaluation;
  alerts: string[];
  decision_log: Decision[];
  evidence_ids: string[];
  hazard_reports: HazardReport[];
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

export interface PreventiveSupportRequest {
  mission_version: number;
  crew_position: Position;
  support_vehicle_position: Position;
  oxygen_available_min: number;
  vehicle_speed_m_per_min: number;
  max_candidates?: number;
}

export interface PreventiveSupportOption {
  option_id: string;
  kind: 'direct_return' | 'rendezvous';
  support_position: Position;
  crew_route: RouteResult;
  vehicle_route: RouteResult | null;
  intervention_time_min: number | null;
  total_distance_m: number | null;
  resource_evaluation: ResourceEvaluation;
}

export interface PreventiveSupportResponse {
  mission_id: string;
  mission_version: number;
  terrain_version: string;
  options: PreventiveSupportOption[];
  recommended_option_id: string | null;
  warnings: string[];
  assumptions: string[];
  generated_at: string;
}

export interface MissionPackage {
  package_version: '1.0';
  mission: Mission;
  region_manifest: RegionManifest;
  objectives: Objective[];
  photos: Photo[];
  offline_assets: string[];
  missing_assets: string[];
  package_status: 'ready_to_sync' | 'incomplete';
  sync: {
    mission_version: number;
    requires_network: boolean;
    remote_asset_count: number;
    missing_asset_count: number;
  };
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
