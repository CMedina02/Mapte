export interface LocalMarsPosition {
  x_m: number;
  y_m: number;
  frame_id: string;
}

export interface Region {
  region_id: string;
  name: string;
  body: 'Mars';
  description: string;
  available: boolean;
}

export interface MapLayerManifest {
  layer_id: string;
  kind: 'optical' | 'elevation' | 'slope' | 'geology' | 'thermal' | string;
  title: string;
  asset_url: string;
  opacity_default: number;
  resolution_m_per_pixel: number;
  evidence_ids: string[];
  nodata_policy: string;
}

export interface EvidenceRecord {
  evidence_id: string;
  title: string;
  mission: string;
  instrument: string;
  source_url: string;
  credit: string;
  captured_at: string;
  resolution_m: number | null;
  caveats: string;
}

export interface RegionManifest {
  region_id: string;
  frame: {
    frame_id: string;
    units: 'm';
    origin: LocalMarsPosition;
    projection_definition: string;
    longitude_direction: string;
    latitude_type: string;
  };
  bounds_local_m: {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
  };
  layers: MapLayerManifest[];
  evidence: EvidenceRecord[];
}

export interface PossibleFinding {
  finding_code: string;
  label: string;
  description?: string;
}

export interface ScienceObjective {
  objective_id: string;
  region_id: string;
  title: string;
  position: LocalMarsPosition;
  science_question: string;
  priority_weight: number;
  activities: string[];
  possible_findings: PossibleFinding[];
}

export type LocationQuality = 'verified' | 'approximate' | 'unknown';

export interface PhotoReference {
  photo_id: string;
  objective_id: string | null;
  image_url: string;
  camera: string;
  sol: number;
  captured_at: string;
  credit: string;
  source_url: string;
  location: LocalMarsPosition | null;
  location_quality: LocationQuality;
  limitations: string;
}

export type RouteStatus = 'viable' | 'not_viable' | 'unknown';

export interface RouteResult {
  route_id: string;
  region_id: string;
  path: LocalMarsPosition[];
  distance_m: number | null;
  duration_min: number | null;
  ascent_m: number | null;
  max_slope_deg: number | null;
  status: RouteStatus;
  unknown_segments: number[][];
  warnings: string[];
  evidence_ids: string[];
  assumptions: string[];
}

export interface MissionAlert {
  alert_id: string;
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}

export interface DecisionLogEntry {
  timestamp: string;
  step: string;
  reason: string;
  evidence_ids?: string[];
}

export interface Mission {
  mission_id: string;
  region_id: string;
  version: number;
  status: 'planned' | 'active' | 'contingency' | 'completed' | 'aborted' | 'unknown';
  base_position: LocalMarsPosition;
  objective_ids: string[];
  route: RouteResult;
  resources: {
    oxygen_available_min: number | null;
    return_reserve_min: number | null;
  };
  completed_objective_ids: string[];
  next_objective_id: string | null;
  alerts: MissionAlert[];
  decision_log: DecisionLogEntry[];
  evidence_ids: string[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}