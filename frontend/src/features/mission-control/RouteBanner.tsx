import type { RouteResult, RouteStatus } from '../../shared/types/contracts';
import { fmt } from '../../shared/format';

const STATUS: Record<RouteStatus, { label: string; cls: string }> = {
  viable: { label: 'VIABLE', cls: 'border-green-600 bg-green-950 text-green-300' },
  not_viable: { label: 'NO VIABLE', cls: 'border-red-600 bg-red-950 text-red-300' },
  unknown: { label: 'DESCONOCIDA · datos insuficientes', cls: 'border-amber-600 bg-amber-950 text-amber-300' },
};

function List({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div>
      <p className="uppercase tracking-widest text-neutral-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-neutral-500">Ninguno declarado</p>
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

  const s = STATUS[route.status] ?? STATUS.unknown;

  return (
    <div className="absolute bottom-4 left-4 z-10 max-h-[calc(100%-2rem)] w-96 space-y-2 overflow-y-auto rounded border border-neutral-700 bg-neutral-950/90 p-3 text-xs">
      <p className={`rounded border px-2 py-1 font-bold ${s.cls}`}>RUTA {s.label}</p>

      <dl className="grid grid-cols-2 gap-x-2">
        <dt className="text-neutral-500">Distancia</dt>
        <dd>{fmt(route.distance_m, 'm')}</dd>
        <dt className="text-neutral-500">Duración</dt>
        <dd>{fmt(route.duration_min, 'min')}</dd>
        <dt className="text-neutral-500">Ascenso</dt>
        <dd>{fmt(route.ascent_m, 'm')}</dd>
        <dt className="text-neutral-500">Pendiente máx.</dt>
        <dd>{fmt(route.max_slope_deg, '°')}</dd>
      </dl>

      {route.unknown_segments > 0 && (
        <p className="text-amber-400">{route.unknown_segments} segmento(s) sin datos de terreno.</p>
      )}

      <List title="Advertencias" items={route.warnings} cls="text-amber-300" />
      <List title="Supuestos del modelo" items={route.assumptions} cls="text-neutral-300" />

      {route.evidence_ids.length > 0 && (
        <p className="text-neutral-500">Evidencia: {route.evidence_ids.join(', ')}</p>
      )}
    </div>
  );
}