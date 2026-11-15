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
// Zonas del DEM con calidad 'unknown' publicadas por el backend: cruzarlas deja la viabilidad en desconocida
const UNKNOWN_ZONES = (REAL_TERRAIN.quality_zones ?? []).filter((z) => z.quality === 'unknown').map((z) => z.extent_m);
const inUnknownZone = (x: number, y: number) =>
  usingRealTerrain() && UNKNOWN_ZONES.some((e) => x >= e.x_min_m && x <= e.x_max_m && y >= e.y_min_m && y <= e.y_max_m);

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
      if (!inBounds(x, y) || inUnknownZone(x, y)) legUnknown = true;
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
  if (unknownLegs > 0) warnings.push('Tramos fuera del área con datos o sobre DEM de calidad desconocida: viabilidad desconocida.');
  warnings.push(
    usingRealTerrain()
      ? 'Simulación del modelo sobre el DEM real reducido a 20 m: no usar para navegación real.'
      : 'Simulación con terreno sintético: no usar para navegación real.',
  );

  return {
    route_id: `route-sim-${Date.now()}`,
    region_id: REGION_ID,
    frame_id: FRAME_ID,
    terrain_version: REAL_TERRAIN.source_terrain_version,
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

// Une tramos que ya calculó el A* del backend (modo híbrido: VITE_REAL_API=routes) en la ruta del plan.
// Hace de servidor de misiones mientras /missions/plan no exista: suma métricas del backend (no las recalcula)
// y evalúa el O₂ con el mismo modelo simple del mock.
export function stitchLegs(legs: RouteResult[], res?: Resources): RouteResult {
  const sum = (k: 'distance_m' | 'duration_min' | 'ascent_m') =>
    legs.every((l) => l[k] !== null) ? r1(legs.reduce((a, l) => a + (l[k] ?? 0), 0)) : null;
  const uniq = (xs: string[]) => [...new Set(xs)];
  const duration = sum('duration_min');
  const slopes = legs.map((l) => l.max_slope_deg);
  const warnings = uniq(legs.flatMap((l) => l.warnings));
  let status: RouteResult['status'] = legs.some((l) => l.status === 'not_viable')
    ? 'not_viable'
    : legs.some((l) => l.status === 'unknown')
      ? 'unknown'
      : 'viable';
  if (res && duration !== null && duration + res.return_reserve_min > res.oxygen_available_min) {
    status = 'not_viable';
    warnings.push(
      `O₂ insuficiente: se requieren ${(duration + res.return_reserve_min).toFixed(0)} min (caminata + reserva) y hay ${res.oxygen_available_min} min.`,
    );
  }
  const path = legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1)));
  return {
    route_id: `plan-${legs.map((l) => l.route_id.slice(0, 8)).join('-')}`,
    region_id: legs[0].region_id,
    frame_id: legs[0].frame_id,
    terrain_version: legs[0].terrain_version,
    path,
    return_start_index: legs.length > 1 ? path.length - legs[legs.length - 1].path.length : undefined, // último tramo = regreso
    distance_m: sum('distance_m'),
    duration_min: duration,
    ascent_m: sum('ascent_m'),
    max_slope_deg: slopes.every((s) => s !== null) ? Math.max(...(slopes as number[])) : null,
    status,
    unknown_segments: legs.reduce((a, l) => a + l.unknown_segments, 0),
    warnings,
    evidence_ids: uniq(legs.flatMap((l) => l.evidence_ids)),
    assumptions: uniq([...legs.flatMap((l) => l.assumptions), 'Tramos: A* del backend · O₂ del plan: simulado en el cliente (mock)']),
    sample_only: true,
  };
}
