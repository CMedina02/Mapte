import type { Resources, RouteResult } from '../../shared/types/contracts';
import { fmt, ROUTE_STATUS, warningText } from '../../shared/format';
import Icon from '../../shared/ui/Icon';

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

  const rows: [string, string][] = [
    ['Distancia', fmt(r.distance_m, 'm')],
    ['Tiempo', fmt(r.duration_min, 'min')],
    ['Pendiente máx.', fmt(r.max_slope_deg, '°')],
    ['Ascenso', fmt(r.ascent_m, 'm')],
    ['O₂ disponible', fmt(resources.oxygen_available_min, 'min')],
    ['Reserva', fmt(resources.return_reserve_min, 'min')],
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-space-950/70 p-2 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rc-title"
        className="max-h-full w-full max-w-lg space-y-5 overflow-y-auto rounded-3xl bg-space-900 p-6 shadow-2xl"
      >
        <div className="space-y-1">
          <h2 id="rc-title" className="text-2xl font-normal text-space-50">
            Antes de salir
          </h2>
          <p className="text-sm text-space-300">Rumbo a {targetTitle.split(' — ')[0]}</p>
        </div>

        <span className={`chip ${s.cls}`}>Ruta {s.label.toLowerCase()}</span>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-space-400">{k}</dt>
              <dd className="font-medium text-space-50">{v}</dd>
            </div>
          ))}
        </dl>

        {r.warnings.map((w) => (
          <p key={w} className="flex gap-2 text-sm text-amber-300">
            <Icon name="warning" size={18} />
            {warningText(w)}
          </p>
        ))}
        {blocked && (
          <p className="text-sm font-medium text-alert-400">No es seguro salir por esta ruta.</p>
        )}
        {r.status === 'unknown' && (
          <p className="text-sm text-amber-300">La ruta aún no está confirmada como segura.</p>
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