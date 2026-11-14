import type { RouteStatus } from './types/contracts';

// Nunca sustituir null por 0: el dato faltante se dice explícitamente.
export const fmt = (v: number | null | undefined, unit: string) =>
  v == null ? 'Desconocido' : `${v} ${unit}`;

export const ROUTE_STATUS: Record<RouteStatus, { label: string; cls: string }> = {
  viable: { label: 'VIABLE', cls: 'border-green-600 bg-green-950 text-green-300' },
  not_viable: { label: 'NO VIABLE', cls: 'border-red-600 bg-red-950 text-red-300' },
  unknown: { label: 'DESCONOCIDA · datos insuficientes', cls: 'border-amber-600 bg-amber-950 text-amber-300' },
};