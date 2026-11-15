import type { Resources, RouteResult } from '../../shared/types/contracts';
import { fmt, ROUTE_STATUS } from '../../shared/format';

interface Props {
  route: RouteResult;
  resources: Resources;
  targetTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ResourceCheck({ route: r, resources, targetTitle, onConfirm, onCancel }: Props) {
  const s = ROUTE_STATUS[r.status] ?? ROUTE_STATUS.unknown;
  const blocked = r.status === 'not_viable';

  // ponytail: cuando el backend agregue radiación/energía/agua al contrato, se suman aquí como filas
  const rows: [string, string][] = [
    ['Distancia', fmt(r.distance_m, 'm')],
    ['Tiempo estimado', fmt(r.duration_min, 'min')],
    ['Pendiente máx.', fmt(r.max_slope_deg, '°')],
    ['Ascenso', fmt(r.ascent_m, 'm')],
    ['O₂ disponible', fmt(resources.oxygen_available_min, 'min')],
    ['Reserva de retorno', fmt(resources.return_reserve_min, 'min')],
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-space-950/70 p-2 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rc-title"
        className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border border-primary-500 bg-space-950/95 p-4 sm:p-6"
      >
        <div className="text-center">
          <h2 id="rc-title" className="text-xl font-bold uppercase tracking-widest">
            Verificación de recursos
          </h2>
          <p className="text-sm">
            Destino: <span className="text-primary-300">{targetTitle}</span>
          </p>
        </div>

        <p className={`rounded border px-3 py-2 text-center font-bold ${s.cls}`}>Ruta {s.label}</p>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-primary-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {r.warnings.map((w) => (
          <p key={w} className="text-sm text-amber-300">
            ⚠ {w}
          </p>
        ))}
        {blocked && (
          <p className="text-sm font-bold text-alert-400">Ruta no viable: no se puede confirmar. Contacta al panel de control.</p>
        )}
        {r.status === 'unknown' && (
          <p className="text-sm text-amber-300">Datos insuficientes: la ruta no está confirmada como segura.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={blocked}
            className="btn-go min-h-14"
          >
            Confirmar destino
          </button>
          <button type="button" onClick={onCancel} className="btn min-h-14 border border-primary-500 text-primary-300">
            Cancelar
          </button>
        </div>

        <p className="text-xs text-space-400">
          Valores del modelo del backend{r.sample_only ? ' · datos de muestra' : ''}.
        </p>
      </div>
    </div>
  );
}