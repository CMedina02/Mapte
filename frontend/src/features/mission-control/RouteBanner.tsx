
import type { RouteResult } from '../../shared/types/contracts';
import { fmt, ROUTE_STATUS } from '../../shared/format';

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div>
      <p className="uppercase tracking-widest text-space-400">{title}</p>
      {items.length === 0 ? (
        <p className="text-space-400">Ninguno declarado</p>
      ) : (
        <ul className={`list-disc pl-4 ${cls}`}>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RouteBanner({ route }: { route: RouteResult }) {
  // Un estado no reconocido se trata como desconocido, nunca como seguro
  const s = ROUTE_STATUS[route.status] ?? ROUTE_STATUS.unknown;
  return (
    // Plegable para no tapar el mapa; el estado de la ruta siempre queda visible.
    // Abierto de inicio solo en pantallas grandes; en móvil/tableta empieza plegado.
    <details
      open={window.matchMedia('(min-width: 1024px)').matches}
      className="absolute bottom-2 left-2 z-10 max-h-[calc(100%-1rem)] w-[min(24rem,calc(100%-1rem))] space-y-2 overflow-y-auto rounded-lg border border-space-700 bg-space-950/90 p-2 text-xs sm:bottom-4 sm:left-4 sm:max-h-[calc(100%-2rem)] sm:p-3"
    >
      <summary className={`cursor-pointer rounded border px-2 py-1 font-bold ${s.cls}`}>RUTA {s.label}</summary>

      <dl className="grid grid-cols-2 gap-x-2">
        <dt className="text-space-400">Distancia</dt>
        <dd>{fmt(route.distance_m, 'm')}</dd>
        <dt className="text-space-400">Duración</dt>
        <dd>{fmt(route.duration_min, 'min')}</dd>
        <dt className="text-space-400">Ascenso</dt>
        <dd>{fmt(route.ascent_m, 'm')}</dd>
        <dt className="text-space-400">Pendiente máx.</dt>
        <dd>{fmt(route.max_slope_deg, '°')}</dd>
      </dl>

      {route.unknown_segments > 0 && (
        <p className="text-amber-400">{route.unknown_segments} segmento(s) sin datos de terreno.</p>
      )}

      <List title="Advertencias" items={route.warnings} cls="text-amber-300" />
      <List title="Supuestos del modelo" items={route.assumptions} cls="text-space-300" />

      {route.evidence_ids.length > 0 && (
        <p className="text-space-400">Evidencia: {route.evidence_ids.join(', ')}</p>
      )}
    </details>
  );
}