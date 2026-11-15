import type { Hazard, Mission, MissionPlanRequest, Objective } from '../../shared/types/contracts';
import ExclusionHint from './ExclusionHint';
import { fmt, ROUTE_STATUS } from '../../shared/format';
import { decisionPoints, excludedObjectives, exclusionsCrossed, shortReason, stopLetters } from '../../shared/mission';
import { LEG_COLORS } from '../mars-map/mapUtils';

const verdict = (ok: boolean | null) =>
  ok === null ? <span className="text-space-400">—</span> : ok ? <span className="text-green-400">✓</span> : <span className="text-alert-400">✕</span>;

// Tramos de la multirruta con su color del mapa + en qué parada deja de ser viable seguir o regresar
export default function LegTimeline({
  mission,
  objectives,
  request,
  hazards = [],
}: {
  mission: Mission;
  objectives: Objective[];
  hazards?: Hazard[];
  request?: MissionPlanRequest | null; // la solicitud del plan, si se hizo desde este panel
}) {
  const letters = stopLetters(mission);
  // En los tramos la base es destino ('Base'); en los puntos de decisión es el inicio ('Salida')
  const name = (id: string, start = false) => (id === 'base' ? (start ? 'Salida' : 'Base') : (objectives.find((o) => o.objective_id === id)?.title.split(' — ')[0] ?? id));
  const points = decisionPoints(mission);
  const excluded = excludedObjectives(mission);
  // Punto límite (lo decide el backend): última parada aceptada cuando quedaron objetivos fuera del plan
  const limit = points.find((p) => p.can_continue === false);

  return (
    <section className="space-y-3 text-sm">
      <h2 className="eyebrow">Tramos</h2>
      <ol className="space-y-1.5">
        {mission.legs.map((leg, i) => {
          const crossed = exclusionsCrossed(leg.path, hazards).length > 0;
          const status = crossed ? 'not_viable' : leg.status;
          const s = ROUTE_STATUS[status] ?? ROUTE_STATUS.unknown;
          return (
            <li key={leg.leg_id} className="flex items-center gap-2 text-xs">
              <span className="h-1 w-5 shrink-0 rounded" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
              <span className="font-mono font-bold">
                {letters[leg.start_label]}→{letters[leg.end_label]}
              </span>
              <span className="min-w-0 flex-1 truncate text-space-300" title={`${name(leg.start_label)} → ${name(leg.end_label)}`}>
                {name(leg.end_label)}
              </span>
              <span className="font-mono">{fmt(leg.metrics.duration_min, 'min')}</span>
              {status !== 'viable' && <span className={`rounded border px-1 text-[10px] ${s.cls}`}>{s.label.split(' ')[0]}</span>}
            </li>
          );
        })}
      </ol>

      {excluded.length > 0 && (
        <ul className="space-y-1">
          {excluded.map((x) => (
            <li key={x.objective_id} className="rounded bg-alert-950 p-2 text-xs text-alert-300">
              <span className="font-bold">✕ {name(x.objective_id)}</span> · {shortReason(x.reason)}
              {/* Solo el primero: los siguientes se excluyen porque dependen de él */}
              {request && x === excluded[0] && (
                <ExclusionHint
                  mission={mission}
                  excluded={x}
                  objective={objectives.find((o) => o.objective_id === x.objective_id)}
                  request={request}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {points.length > 1 && (
        <>
          <h3 className="eyebrow" title="El backend solo acepta un objetivo si desde él el regreso a base conserva la reserva">
            Puntos de decisión
          </h3>
          <table className="w-full text-xs">
            <thead className="text-space-400">
              <tr>
                <th className="text-left font-normal">En</th>
                <th className="text-right font-normal">O₂ al llegar</th>
                <th className="text-center font-normal">Seguir</th>
                <th className="text-center font-normal">Regresar</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.stop} className={p === limit ? 'bg-alert-950/60' : undefined}>
                  <td className="truncate py-0.5">
                    <span className="font-mono font-bold">{letters[p.stop]}</span> {name(p.stop, true)}
                  </td>
                  <td className="text-right font-mono">{fmt(p.oxygen_left_min, 'min')}</td>
                  <td className="text-center">{verdict(p.can_continue)}</td>
                  <td className="text-center" title={p.can_return === null ? 'Sin confirmar: el plan no es viable' : undefined}>
                    {verdict(p.can_return)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {limit && (
            <p className="rounded bg-alert-950 p-2 text-xs text-alert-300">
              Desde {letters[limit.stop]} solo es seguro regresar.
            </p>
          )}
        </>
      )}
    </section>
  );
}
