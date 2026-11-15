import type { MissionLifecycleStatus, RouteStatus } from './types/contracts';

// Conserva la distinción entre un valor ausente y cero.
export const fmt = (v: number | null | undefined, unit: string) =>
  v == null ? 'No data' : `${Math.round(v * 10) / 10} ${unit}`;

export const fmtDuration = (min: number | null | undefined) => {
  if (min == null) return 'No data';
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
export const fmtDistance = (m: number | null | undefined) =>
  m == null ? 'No data' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export const ROUTE_STATUS: Record<RouteStatus, { label: string; cls: string }> = {
  viable: { label: 'Viable', cls: 'bg-green-950 text-green-300' },
  not_viable: { label: 'Not viable', cls: 'bg-alert-950 text-alert-300' },
  unknown: { label: 'Unconfirmed', cls: 'bg-amber-950 text-amber-300' },
};
// Los códigos sin traducción se muestran tal cual.
const WARNING_TEXT: Record<string, string> = {
  STATIC_HAZARDS_NOT_AVAILABLE: 'Catalog hazard zones are not yet used in this route calculation.',
  ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS: 'Start and destination snapped to the terrain cell center (≤ 2 m).',
  NO_ROUTE_WITHIN_CONSTRAINTS: 'No route within constraints.',
  ROUTE_SEARCH_LIMIT_REACHED: 'Search incomplete: route unconfirmed.',
  ROUTE_CROSSES_UNKNOWN_TERRAIN: 'Crosses terrain with no data.',
  SEGMENT_NOT_VIABLE: 'A segment is not viable.',
  SEGMENT_STATUS_UNKNOWN: 'Unconfirmed segments.',
  DURATION_UNKNOWN: 'Unknown duration.',
  INSUFFICIENT_RETURN_RESERVE: 'Insufficient O₂ for the reserve.',
  RESOURCE_READING_REQUIRED_AFTER_OBSERVATION: 'Update the O₂ reading.',
  OXYGEN_REDUCED: 'O₂ reduced: return recalculated.',
  ROUTE_REVALIDATION_REQUIRED: 'Route needs revalidation.',
  MISSION_NOT_VIABLE: 'Plan not viable: check the route warnings.',
  MISSION_UNKNOWN: 'Plan viability unknown.',
};
export const warningText = (w: string) => WARNING_TEXT[w] ?? w;

// Omite avisos ya cubiertos por el estado de la ruta o los supuestos del modelo.
const IMPLIED = new Set([
  'MISSION_NOT_VIABLE', 'MISSION_UNKNOWN', 'SEGMENT_NOT_VIABLE', 'SEGMENT_STATUS_UNKNOWN',
  'ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS', 'STATIC_HAZARDS_NOT_AVAILABLE',
  'ROUTE_CROSSES_UNKNOWN_TERRAIN',
]);
export const notices = (warnings: string[], alerts: string[] = []) =>
  [...new Set([...warnings, ...alerts].filter((c) => !IMPLIED.has(c) && !c.startsWith('OBJECTIVE_EXCLUDED:')).map(warningText))];

export const MISSION_STATUS: Record<MissionLifecycleStatus, string> = {
  draft: 'Planned',
  active: 'In progress',
  completed: 'Completed',
  aborted: 'Aborted',
};

const EVENT_TEXT: Record<string, string> = {
  plan_created: 'Plan created',
  mission_active: 'Mission started',
  progress_updated: 'Progress',
  observation_recorded: 'Finding',
  route_recalculated: 'Route recalculated',
  objective_excluded: 'Objective excluded',
  hazard_reported: 'Hazard reported',
  contingency_evaluated: 'Contingency',
  mission_completed: 'Mission completed',
  mission_aborted: 'Mission aborted',
};
export const eventText = (e: string) => EVENT_TEXT[e] ?? e.replaceAll('_', ' ');

const FINDING_TEXT: Record<string, string> = {
  HEMATITE_DETECTED: 'Hematite',
  COARSE_HEMATITE_ONLY: 'Coarse hematite only',
  DIAGENETIC_ALTERATION_OBSERVED: 'Diagenetic alteration',
  NO_HEMATITE_DETECTED: 'No hematite',
  CLAY_MINERALS_DETECTED: 'Clay minerals',
  FE_CARBONATE_DETECTED: 'Iron carbonate',
  NO_CLAY_ENRICHMENT: 'No clay enrichment',
  ELEMENTAL_SULFUR_DETECTED: 'Elemental sulfur',
  SULFATE_ONLY: 'Sulfates only',
  NO_SULFUR_PHASE: 'No sulfur phase',
  TRIDYMITE_DETECTED: 'Tridymite',
  HIGH_SILICA_AMORPHOUS: 'Amorphous silica',
  NO_TRIDYMITE_DETECTED: 'No tridymite',
};
export const findingText = (code: string) => {
  const text = FINDING_TEXT[code] ?? code.toLowerCase().replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
