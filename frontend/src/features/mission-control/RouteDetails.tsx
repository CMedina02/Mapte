import type { Hazard, Mission } from '../../shared/types/contracts';
import { fmt, notices, ROUTE_STATUS } from '../../shared/format';
import { exclusionsCrossed, missionRoute, stopLetters } from '../../shared/mission';

// Panel derecho: estado, métricas y avisos.
export default function RouteDetails({ mission, hazards = [] }: { mission: Mission; hazards?: Hazard[] }) {
  const route = missionRoute(mission);
  const items = notices(route.warnings, mission.alerts);
  // Tramos que cruzan una zona de exclusión: la ruta no se presenta como viable aunque el backend lo diga
  const letters = stopLetters(mission);
  const crossings = mission.legs.flatMap((leg) =>
    exclusionsCrossed(leg.path, hazards).map((z) => `${letters[leg.start_label]}→${letters[leg.end_label]} cruza ${z}`),
  );
  // Un estado no reconocido se trata como desconocido, nunca como seguro
  const s = crossings.length ? ROUTE_STATUS.not_viable : (ROUTE_STATUS[route.status] ?? ROUTE_STATUS.unknown);
  return (
    <section className="space-y-3 text-sm">
      <h2 className="eyebrow">Ruta</h2>
      <p className={`rounded border px-2 py-1 text-xs font-bold ${s.cls}`}>{s.label}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-space-400">Distancia</dt>
        <dd>{fmt(route.distance_m, 'm')}</dd>
        <dt className="text-space-400">Duración</dt>
        <dd>{fmt(route.duration_min, 'min')}</dd>
        <dt className="text-space-400">Ascenso</dt>
        <dd>{fmt(route.ascent_m, 'm')}</dd>
        <dt className="text-space-400">Pendiente máx.</dt>
        <dd>{fmt(route.max_slope_deg, '°')}</dd>
      </dl>
      {(crossings.length > 0 || items.length > 0 || route.unknown_segments > 0) && (
        <ul className="space-y-1.5">
          {crossings.map((t) => (
            <li key={t} className="rounded bg-alert-950 p-2 text-xs text-alert-300">
              ⛔ {t}
            </li>
          ))}
          {route.unknown_segments > 0 && (
            <li className="rounded bg-amber-950 p-2 text-xs text-amber-300">
              {route.unknown_segments} tramo(s) sin datos de terreno.
            </li>
          )}
          {items.map((t) => (
            <li key={t} className="rounded bg-amber-950 p-2 text-xs text-amber-300">
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
