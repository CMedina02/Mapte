// Simulador del modelo de rutas del backend, SOLO para el mock.
// La app nunca calcula rutas: este archivo hace el papel del servidor mientras no exista.
import type { Constraints, Position, Resources, RouteResult } from '../../types/contracts';
import { BOUNDS, FRAME_ID, HAZARDS, REAL_TERRAIN, REGION_ID, elevationAt, usingRealTerrain } from './monteSharp.ts';

const STEP_M = 20;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function pointInPolygon(x: number, y: number, poly: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x_m, yi = poly[i].y_m, xj = poly[j].x_m, yj = poly[j].y_m;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inBounds = (x: number, y: number) =>
  x >= BOUNDS.min_x && x <= BOUNDS.max_x && y >= BOUNDS.min_y && y <= BOUNDS.max_y;

// ponytail: tramos rectos entre paradas muestreados cada 20 m; el backend real usa A* y esquiva obstáculos.
// Sin `res` (vista previa) no se evalúa el O₂.
export function simulateRoute(stops: Position[], c: Constraints, res?: Resources): RouteResult {
  const path: Position[] = [];
  const hits = new Set<string>();
  let distance = 0, ascent = 0, maxSlope = 0, unknownLegs = 0;
  let px = 0, py = 0, pz = 0;

  for (let s = 0; s < stops.length - 1; s++) {
    const a = stops[s], b = stops[s + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m) / STEP_M));
    let legUnknown = false;
    for (let i = s === 0 ? 0 : 1; i <= n; i++) {
      const x = a.x_m + ((b.x_m - a.x_m) * i) / n;
      const y = a.y_m + ((b.y_m - a.y_m) * i) / n;
      const z = elevationAt(x, y);
      if (!inBounds(x, y)) legUnknown = true;
      for (const hz of HAZARDS) if (pointInPolygon(x, y, hz.polygon)) hits.add(hz.hazard_id);
      if (path.length > 0) {
        const h = Math.hypot(x - px, y - py);
        const dz = z - pz;
        distance += Math.hypot(h, dz);
        if (dz > 0) ascent += dz;
        if (h > 0) maxSlope = Math.max(maxSlope, (Math.atan2(Math.abs(dz), h) * 180) / Math.PI);
      }
      path.push({ x_m: r1(x), y_m: r1(y), z_m: r1(z), frame_id: FRAME_ID });
      px = x; py = y; pz = z;
    }
    if (legUnknown) unknownLegs++;
  }

  const warnings: string[] = [];
  let blocked = false;

  if (maxSlope > c.max_slope_deg) {
    blocked = true;
    warnings.push(`Pendiente de ${maxSlope.toFixed(0)}° supera el máximo de ${c.max_slope_deg}°: ruta bloqueada.`);
  }
  for (const hz of HAZARDS) {
    if (!hits.has(hz.hazard_id)) continue;
    if (hz.kind === 'exclusion') {
      blocked = true;
      warnings.push(`Cruza área de exclusión (${hz.risk_factor}): ${hz.mitigation}`);
    } else {
      warnings.push(`${hz.risk_factor}: ${hz.mitigation}`);
    }
  }

  const duration = distance / c.speed_m_per_min;
  if (res) {
    const need = duration + res.return_reserve_min;
    if (need > res.oxygen_available_min) {
      blocked = true;
      warnings.push(
        `O₂ insuficiente: se requieren ${need.toFixed(0)} min (caminata + reserva) y hay ${res.oxygen_available_min} min.`,
      );
    }
  }
  if (unknownLegs > 0) warnings.push('Tramos fuera del área con datos: viabilidad desconocida.');
  warnings.push(
    usingRealTerrain()
      ? 'Simulación del modelo sobre el DEM real reducido a 20 m: no usar para navegación real.'
      : 'Simulación con terreno sintético: no usar para navegación real.',
  );

  return {
    route_id: `route-sim-${Date.now()}`,
    region_id: REGION_ID,
    path,
    distance_m: Math.round(distance),
    duration_min: r1(duration),
    ascent_m: Math.round(ascent),
    max_slope_deg: r1(maxSlope),
    status: blocked ? 'not_viable' : unknownLegs > 0 ? 'unknown' : 'viable',
    unknown_segments: unknownLegs,
    warnings,
    evidence_ids: usingRealTerrain() ? [REAL_TERRAIN.evidence_ids[0]] : [],
    assumptions: [
      `Velocidad constante de ${c.speed_m_per_min} m/min`,
      'Consumo simulado: 1 min de O₂ por minuto de caminata',
      usingRealTerrain()
        ? 'Elevación: DEM USGS MSL Gale (1 m) promediado a 20 m'
        : 'Terreno sintético inspirado en el flanco norte de Monte Sharp (no es el DEM HiRISE)',
      'Tramos rectos entre paradas (el backend real calcula la ruta con A*)',
    ],
    sample_only: true,
  };
}
