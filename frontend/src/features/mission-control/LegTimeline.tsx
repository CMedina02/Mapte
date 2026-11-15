import type { Hazard, Mission, MissionPlanRequest, Objective, Position } from '../../shared/types/contracts';
import ExclusionHint from './ExclusionHint';
import { fmtDuration, ROUTE_STATUS } from '../../shared/format';
import { decisionPoints, excludedObjectives, exclusionsCrossed, shortReason, stopLetters } from '../../shared/mission';
import { LEG_COLORS } from '../mars-map/mapUtils';
import Icon from '../../shared/ui/Icon';

const verdict = (ok: boolean | null, label: string) =>
  ok === null ? (
    <span className="text-space-500">—</span>
  ) : (
    <span className={ok ? 'text-green-400' : 'text-alert-400'} aria-label={`${label}: ${ok ? 'sí' : 'no'}`}>
      <Icon name={ok ? 'check' : 'close'} size={18} />
    </span>
  );

export default function LegTimeline({
  mission,
  objectives,
  request,
  hazards = [],
  onFailedPaths = () => {},
}: {
  mission: Mission;
  objectives: Objective[];
  hazards?: Hazard[];
  onFailedPaths?: (paths: Position[][]) => void;
  request?: MissionPlanRequest | null;
}) {
  const letters = stopLetters(mission);
  // En los tramos la base es destino ('Base'); en los puntos de decisión es el inicio ('Salida')
  const name = (id: string, start = false) =>
    id === 'base' ? (start ? 'Salida' : 'Base') : (objectives.find((o) => o.objective_id === id)?.title.split(' — ')[0] ?? id);
  const points = decisionPoints(mission);
  const excluded = excludedObjectives(mission);
  // Si hubo exclusiones, el límite es la última parada aceptada.
  const limit = points.find((p) => p.can_continue === false);

  return (
    <section className="space-y-5 text-sm">
      {mission.objective_ids.length > 0 && (
        <div className="space-y-2">
          <h2 className="eyebrow">Recorrido</h2>
        <ol className="card space-y-0 p-0">
          {mission.legs.map((leg, i) => {
            const crossed = exclusionsCrossed(leg.path, hazards).length > 0;
            const status = crossed ? 'not_viable' : leg.status;
            const s = ROUTE_STATUS[status] ?? ROUTE_STATUS.unknown;
            return (
              <li key={leg.leg_id} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-space-800' : ''}`}>
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-space-50">{name(leg.end_label)}</span>
                  <span className="block text-xs text-space-400">
                    {letters[leg.start_label]} a {letters[leg.end_label]}
                  </span>
                </span>
                {status !== 'viable' && <span className={`chip ${s.cls}`}>{s.label}</span>}
                <span className="text-space-300 tabular-nums">{fmtDuration(leg.metrics.duration_min)}</span>
              </li>
            );
          })}
        </ol>
        </div>
      )}

      {excluded.length > 0 && (
        <ul className="space-y-2">
          {excluded.map((x) => (
            <li key={x.objective_id} className="rounded-2xl bg-alert-950 px-4 py-3 text-alert-300">
              <p className="flex items-start gap-2">
                <Icon name="block" size={18} className="mt-px" />
                <span>
                  <span className="font-medium">{name(x.objective_id)}</span> no entra en el plan: {shortReason(x.reason)}.
                </span>
              </p>
              {/* Solo el primero: los siguientes se excluyen porque dependen de él */}
              {request && x === excluded[0] && (
                <ExclusionHint
                  mission={mission}
                  excluded={x}
                  objective={objectives.find((o) => o.objective_id === x.objective_id)}
                  request={request}
                  onPaths={onFailedPaths}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {points.length > 1 && (
        <div className="space-y-2">
          <h2 className="eyebrow">Puntos de decisión</h2>
          <div className="card p-0">
            <table className="w-full table-fixed">
              <thead className="text-xs text-space-400">
                <tr>
                  <th className="w-[44%] px-4 pt-3 pb-1 text-left font-normal">Parada</th>
                  <th className="pt-3 pb-1 text-right font-normal">Oxígeno</th>
                  <th className="pt-3 pb-1 text-center font-normal">Seguir</th>
                  <th className="pt-3 pb-1 pr-3 text-center font-normal">Volver</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.stop} className={`border-t border-space-800 ${p === limit ? 'bg-alert-950' : ''}`}>
                    <td className="truncate px-4 py-2.5">
                      <span className="mr-2 font-medium text-space-50">{letters[p.stop]}</span>
                      {name(p.stop, true)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{fmtDuration(p.oxygen_left_min)}</td>
                    <td className="py-2.5">
                      <span className="flex justify-center">{verdict(p.can_continue, 'Seguir')}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex justify-center">{verdict(p.can_return, 'Volver')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {limit && (
            <p className="px-1 text-xs text-space-400">Desde la parada {letters[limit.stop]} solo es seguro volver a la base.</p>
          )}
        </div>
      )}
    </section>
  );
}
