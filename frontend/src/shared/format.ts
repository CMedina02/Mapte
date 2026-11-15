import type { MissionLifecycleStatus, RouteStatus } from './types/contracts';

// Nunca sustituir null por 0: el dato faltante se dice explícitamente.
// Presentación: 1 decimal como máximo (el backend envía floats completos; el dato no se altera, solo se muestra).
export const fmt = (v: number | null | undefined, unit: string) =>
  v == null ? 'Sin dato' : `${Math.round(v * 10) / 10} ${unit}`;

// Lectura humana de tiempo y distancia (estilo Google Maps): "1 h 20 min", "4.2 km", "907 m"
export const fmtDuration = (min: number | null | undefined) => {
  if (min == null) return 'Sin dato';
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
export const fmtDistance = (m: number | null | undefined) =>
  m == null ? 'Sin dato' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export const ROUTE_STATUS: Record<RouteStatus, { label: string; cls: string }> = {
  viable: { label: 'Viable', cls: 'bg-green-950 text-green-300' },
  not_viable: { label: 'No viable', cls: 'bg-alert-950 text-alert-300' },
  unknown: { label: 'Por confirmar', cls: 'bg-amber-950 text-amber-300' },
};
// Códigos de aviso del backend (routing/resources) → texto para la interfaz. Un código desconocido se muestra tal cual.
const WARNING_TEXT: Record<string, string> = {
  STATIC_HAZARDS_NOT_AVAILABLE: 'Las zonas de riesgo del catálogo aún no se usan en el cálculo de esta ruta.',
  ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS: 'Inicio y destino ajustados al centro de la celda del terreno (≤ 2 m).',
  NO_ROUTE_WITHIN_CONSTRAINTS: 'Sin ruta dentro de las restricciones.',
  ROUTE_SEARCH_LIMIT_REACHED: 'Búsqueda sin terminar: ruta sin confirmar.',
  ROUTE_CROSSES_UNKNOWN_TERRAIN: 'Cruza terreno sin datos.',
  SEGMENT_NOT_VIABLE: 'Un tramo no es viable.',
  SEGMENT_STATUS_UNKNOWN: 'Tramos sin confirmar.',
  DURATION_UNKNOWN: 'Duración desconocida.',
  INSUFFICIENT_RETURN_RESERVE: 'O₂ insuficiente para la reserva.',
  RESOURCE_READING_REQUIRED_AFTER_OBSERVATION: 'Actualiza la lectura de O₂.',
  OXYGEN_REDUCED: 'O₂ reducido: regreso recalculado.',
  ROUTE_REVALIDATION_REQUIRED: 'Ruta por revalidar.',
  MISSION_NOT_VIABLE: 'Plan no viable: revisa las advertencias de la ruta.',
  MISSION_UNKNOWN: 'Viabilidad del plan desconocida.',
};
export const warningText = (w: string) => WARNING_TEXT[w] ?? w;

// Códigos que no se listan como aviso: ya los dice el estado de la ruta o los supuestos del modelo.
const IMPLIED = new Set([
  'MISSION_NOT_VIABLE', 'MISSION_UNKNOWN', 'SEGMENT_NOT_VIABLE', 'SEGMENT_STATUS_UNKNOWN',
  'ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS', 'STATIC_HAZARDS_NOT_AVAILABLE',
  'ROUTE_CROSSES_UNKNOWN_TERRAIN', // ya lo dice la línea de tramos sin datos
]);
// Avisos de la ruta + alertas de la misión, sin repetidos ni redundantes, ya traducidos
export const notices = (warnings: string[], alerts: string[] = []) =>
  [...new Set([...warnings, ...alerts].filter((c) => !IMPLIED.has(c) && !c.startsWith('OBJECTIVE_EXCLUDED:')).map(warningText))];
// (los objetivos excluidos se muestran con su motivo en la sección Tramos)

export const MISSION_STATUS: Record<MissionLifecycleStatus, string> = {
  draft: 'Planificada',
  active: 'En curso',
  completed: 'Completada',
  aborted: 'Abortada',
};

const EVENT_TEXT: Record<string, string> = {
  plan_created: 'Plan creado',
  mission_active: 'Misión iniciada',
  progress_updated: 'Avance',
  observation_recorded: 'Hallazgo',
  objective_excluded: 'Objetivo excluido',
  hazard_reported: 'Riesgo reportado',
  contingency_evaluated: 'Contingencia',
  mission_completed: 'Misión completada',
  mission_aborted: 'Misión abortada',
};
export const eventText = (e: string) => EVENT_TEXT[e] ?? e.replaceAll('_', ' ');
