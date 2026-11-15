// Geometría de presentación del visor (rumbos y coordenadas aproximadas).
// No calcula métricas de ruta: distancias, tiempos y pendientes siempre vienen del backend.
import type { Frame, Position } from '../../../shared/types/contracts';

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MARS_RADIUS_M = 3_396_190;
const M_PER_DEG = (Math.PI * MARS_RADIUS_M) / 180;

export const norm360 = (d: number) => ((d % 360) + 360) % 360;

// Rumbo de a hacia b: 0° = norte, 90° = este (X este, Y norte en el marco local)
export const bearingDeg = (a: Position, b: Position) =>
  norm360((Math.atan2(b.x_m - a.x_m, b.y_m - a.y_m) * 180) / Math.PI);

export const cardinal = (deg: number) => CARDINALS[Math.round(norm360(deg) / 45) % 8];

// Diferencia con signo más corta (−180..180): positivo = girar a la derecha
export const turnDeg = (from: number, to: number) => ((to - from + 540) % 360) - 180;

// ponytail: latitud/longitud APROXIMADAS (equirectangular desde el origen del marco); el valor oficial lo da el backend
export function approxLatLon(frame: Frame, p: Position) {
  const lat = frame.origin_planetocentric_lat_deg + p.y_m / M_PER_DEG;
  const lon = frame.origin_east_lon_deg + p.x_m / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return { lat, lon };
}

export const samePlace = (a: Position, b: Position, tolM = 5) =>
  Math.abs(a.x_m - b.x_m) <= tolM && Math.abs(a.y_m - b.y_m) <= tolM;
