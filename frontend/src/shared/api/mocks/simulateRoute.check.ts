// Check rápido del simulador del mock. Ejecutar desde frontend/:
//   node src/shared/api/mocks/simulateRoute.check.ts
import { pointInPolygon, simulateRoute } from './simulateRoute.ts';
import { ELEVATION_RANGE, FRAME_ID, SECTOR, elevationAt } from './monteSharp.ts';

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALLA: ${msg}`);
  console.log(`ok - ${msg}`);
}

// Coordenadas relativas al sector de caminata (como en el escenario)
const P = (x: number, y: number) => ({ x_m: x + SECTOR.min_x, y_m: y + SECTOR.min_y, frame_id: FRAME_ID });
const c = { max_slope_deg: 15, speed_m_per_min: 20, avoid_unknown: true };
const plenty = { oxygen_available_min: 480, return_reserve_min: 60 };

const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
check(pointInPolygon(SECTOR.min_x + 5, SECTOR.min_y + 5, square) && !pointInPolygon(SECTOR.min_x + 15, SECTOR.min_y + 5, square), 'point in polygon');

const north = simulateRoute([P(300, 1800), P(300, 1700)], c, plenty);
check(north.status === 'viable', `north slope viable (${north.max_slope_deg}°)`);
check(north.path.every((p) => typeof p.z_m === 'number'), 'every point has z_m');

const dunes = simulateRoute([P(1000, 1300), P(1800, 1300)], c, plenty);
check(dunes.status === 'not_viable' && dunes.warnings.some((w) => w.includes('Dunas')), 'cruzar dunas bloquea');

const scarp = simulateRoute([P(300, 900), P(300, 400)], c, plenty);
check(scarp.status === 'not_viable' && (scarp.max_slope_deg ?? 0) > 15, `escarpe bloquea (${scarp.max_slope_deg}°)`);

const boxwork = simulateRoute([P(1550, 1000), P(1550, 520)], c, plenty);
check(boxwork.status === 'viable' && boxwork.warnings.some((w) => w.includes('Boxwork')), 'boxwork warns without blocking');

const lowO2 = simulateRoute([P(300, 1800), P(300, 1000)], c, { oxygen_available_min: 50, return_reserve_min: 30 });
check(lowO2.status === 'not_viable' && lowO2.warnings.some((w) => w.includes('O₂')), 'O₂ insuficiente bloquea');

const more = simulateRoute([P(300, 1800), P(300, 1000)], c, { oxygen_available_min: 30, return_reserve_min: 10 });
check(more.status === 'not_viable', 'less O₂ never makes the same route viable');

let lo = Infinity, hi = -Infinity;
for (let x = 0; x <= 10000; x += 50)
  for (let y = 0; y <= 10000; y += 50) {
    const z = elevationAt(x, y);
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
check(lo >= ELEVATION_RANGE.min && hi <= ELEVATION_RANGE.max, `elevation in range (${lo.toFixed(0)} to ${hi.toFixed(0)} m)`);
