import type { Mission } from '../../shared/types/contracts';
import { fmt, notices, ROUTE_STATUS } from '../../shared/format';

// Panel derecho: estado y métricas, luego avisos; supuestos y evidencia plegados para consulta.
export default function RouteDetails({ mission }: { mission: Mission }) {
  const { route } = mission;
  const items = notices(route.warnings, mission.alerts);
  // Un estado no reconocido se trata como desconocido, nunca como seguro
  const s = ROUTE_STATUS[route.status] ?? ROUTE_STATUS.unknown;
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
      {(items.length > 0 || route.unknown_segments > 0) && (
        <ul className="space-y-1.5">
          {route.unknown_segments > 0 && (
            <li className="rounded bg-amber-950 p-2 text-xs text-amber-300">
              {route.unknown_segments} segmento(s) sin datos de terreno.
            </li>
          )}
          {items.map((t) => (
            <li key={t} className="rounded bg-amber-950 p-2 text-xs text-amber-300">
              {t}
            </li>
          ))}
        </ul>
      )}
      {mission.sample_only && (
        <p className="text-xs text-amber-400">Datos de muestra: no usar para navegación real.</p>
      )}
      {route.assumptions.length > 0 && (
        <details className="text-xs text-space-300">
          <summary className="eyebrow cursor-pointer">Supuestos del modelo</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {route.assumptions.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      {route.evidence_ids.length > 0 && (
        <details className="text-xs text-space-400">
          <summary className="eyebrow cursor-pointer">Evidencia ({route.evidence_ids.length})</summary>
          <ul className="mt-1 space-y-0.5 break-all">
            {route.evidence_ids.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
