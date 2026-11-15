import type { Hazard, Mission } from '../../shared/types/contracts';
import { fmt, fmtDistance, fmtDuration, notices, ROUTE_STATUS } from '../../shared/format';
import { exclusionsCrossed, missionRoute, stopLetters } from '../../shared/mission';
import Icon from '../../shared/ui/Icon';

export default function RouteDetails({ mission, hazards = [] }: { mission: Mission; hazards?: Hazard[] }) {
  const route = missionRoute(mission);
  const items = notices(route.warnings, mission.alerts);
  // Un cruce de exclusión prevalece sobre el estado informado de la ruta.
  const letters = stopLetters(mission);
  const crossings = mission.legs.flatMap((leg) =>
    exclusionsCrossed(leg.path, hazards).map((z) => `${letters[leg.start_label]} a ${letters[leg.end_label]} cruza ${z}`),
  );
  const s = crossings.length ? ROUTE_STATUS.not_viable : (ROUTE_STATUS[route.status] ?? ROUTE_STATUS.unknown);
  if (mission.objective_ids.length === 0) {
    return (
      <section className="card space-y-1">
        <p className="font-medium text-space-50">Ningún objetivo entra en el plan</p>
        <p className="text-sm text-space-400">Con estos ajustes no es seguro llegar a los objetivos elegidos y volver.</p>
      </section>
    );
  }
  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[28px] leading-tight font-medium text-space-50">{fmtDuration(route.duration_min)}</p>
          <p className="text-sm text-space-400">{fmtDistance(route.distance_m)} de caminata</p>
        </div>
        <span className={`chip mt-1 ${s.cls}`}>{s.label}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-space-800 pt-3 text-sm">
        <div>
          <dt className="text-xs text-space-400">Ascenso</dt>
          <dd className="font-medium text-space-50">{fmt(route.ascent_m, 'm')}</dd>
        </div>
        <div>
          <dt className="text-xs text-space-400">Pendiente máxima</dt>
          <dd className="font-medium text-space-50">{fmt(route.max_slope_deg, '°')}</dd>
        </div>
      </dl>
      {(crossings.length > 0 || items.length > 0 || route.unknown_segments > 0) && (
        <ul className="space-y-2 text-sm">
          {crossings.map((t) => (
            <li key={t} className="flex gap-2 rounded-xl bg-alert-950 px-3 py-2 text-alert-300">
              <Icon name="block" size={18} className="mt-px" />
              {t}
            </li>
          ))}
          {route.unknown_segments > 0 && (
            <li className="flex gap-2 rounded-xl bg-amber-950 px-3 py-2 text-amber-300">
              <Icon name="warning" size={18} className="mt-px" />
              {route.unknown_segments === 1 ? 'Un tramo pasa' : `${route.unknown_segments} tramos pasan`} por terreno sin datos.
            </li>
          )}
          {items.map((t) => (
            <li key={t} className="flex gap-2 rounded-xl bg-amber-950 px-3 py-2 text-amber-300">
              <Icon name="warning" size={18} className="mt-px" />
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
