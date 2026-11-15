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
    ['Distance', fmt(r.distance_m, 'm')],
    ['Time', fmt(r.duration_min, 'min')],
    ['Max slope', fmt(r.max_slope_deg, '°')],
    ['Ascent', fmt(r.ascent_m, 'm')],
    ['Available O₂', fmt(resources.oxygen_available_min, 'min')],
    ['Reserve', fmt(resources.return_reserve_min, 'min')],
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
            Before you leave
          </h2>
          <p className="text-sm text-space-300">Heading to {targetTitle.split(' — ')[0]}</p>
        </div>

        <span className={`chip ${s.cls}`}>Route {s.label.toLowerCase()}</span>

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
          <p className="text-sm font-medium text-alert-400">It is not safe to leave on this route.</p>
        )}
        {r.status === 'unknown' && (
          <p className="text-sm text-amber-300">The route is not yet confirmed as safe.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={blocked}
            className="btn-go min-h-14"
          >
            Confirm destination
          </button>
          <button type="button" onClick={onCancel} className="btn min-h-14 border border-primary-500 text-primary-300">
            Cancel
          </button>
        </div>

        <p className="text-xs text-space-400">
          Backend model values{r.sample_only ? ' · sample data' : ''}.
        </p>
      </div>
    </div>
  );
}