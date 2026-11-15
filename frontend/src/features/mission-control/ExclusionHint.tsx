import { useEffect, useState } from 'react';
import type { Mission, MissionPlanRequest, Objective, RouteResult } from '../../shared/types/contracts';
import { marsApi } from '../../shared/api/client';
import type { ExcludedObjective } from '../../shared/mission';

type Legs = { out: RouteResult; back: RouteResult } | 'error' | null;

// Qué parámetro haría falta para incluir el objetivo excluido. Con recursos insuficientes se piden al backend
// las dos rutas que faltan (última parada → objetivo → base) y se suman a lo ya planificado, como hace el plan.
export default function ExclusionHint({
  mission,
  excluded,
  objective,
  request,
}: {
  mission: Mission;
  excluded: ExcludedObjective;
  objective: Objective | undefined;
  request: MissionPlanRequest;
}) {
  const reason = excluded.reason;
  const needsRoutes = reason.includes('recursos') && !!objective;
  const [legs, setLegs] = useState<Legs>(null);

  const lastStop = mission.objective_ids.at(-1);
  const from = (lastStop && mission.legs.find((l) => l.end_label === lastStop)?.path.at(-1)) || mission.start_position;

  useEffect(() => {
    if (!needsRoutes || !objective) return;
    let alive = true;
    const route = (start: typeof from, end: typeof from) =>
      marsApi.computeRoute({ region_id: mission.region_id, start, end, constraints: request.constraints });
    Promise.all([route(from, objective.position), route(objective.position, mission.return_position)])
      .then(([out, back]) => alive && setLegs({ out, back }))
      .catch(() => alive && setLegs('error'));
    return () => {
      alive = false;
    };
    // una sola consulta por misión y objetivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.mission_id, excluded.objective_id, needsRoutes]);

  const { constraints, resources } = request;
  const box = (children: React.ReactNode) => <div className="mt-1.5 space-y-0.5 border-t border-alert-800 pt-1.5 text-alert-200">{children}</div>;

  if (reason.includes('no es viable')) return box(<p>Sube la pendiente máx. (ahora {constraints.max_slope_deg}°).</p>);
  if (reason.includes('terreno desconocido')) return box(<p>Desactiva «Evitar zonas sin datos».</p>);
  if (reason.includes('confirmar el consumo')) return box(<p>Indica el tiempo de actividad de cada objetivo.</p>);
  if (!needsRoutes) return null;
  if (legs === null) return box(<p className="opacity-80">Calculando…</p>);
  if (legs === 'error') return box(<p className="opacity-80">Sin enlace.</p>);
  if (legs.out.status === 'not_viable' || legs.back.status === 'not_viable') {
    return box(<p>Sin ruta con pendiente ≤ {constraints.max_slope_deg}°.</p>);
  }

  const walked = mission.legs.filter((l) => l.end_label !== 'base').map((l) => l.metrics.duration_min);
  const act = [...mission.objective_ids, excluded.objective_id].map((id) => request.activity_durations_min?.[id] ?? 0);
  const parts = [...walked, legs.out.duration_min, legs.back.duration_min];
  if (parts.some((d) => d === null)) return box(<p className="opacity-80">Duración desconocida.</p>);
  const actTotal = act.reduce((a, x) => a + x, 0);
  const need = (parts as number[]).reduce((a, x) => a + x, 0) + actTotal; // caminata + actividad, sin reserva
  const o2 = resources.oxygen_available_min;
  const reserve = resources.return_reserve_min;
  const deficit = need + reserve - o2;
  const perObj = act.length ? Math.floor((actTotal - deficit) / act.length) : -1;

  return box(
    <>
      <p className="font-bold">Para incluirlo:</p>
      <ul className="list-disc pl-4">
        <li>
          O₂ ≥ <span className="font-mono">{Math.ceil(need + reserve)} min</span> (hay {o2})
        </li>
        {o2 - need > 0 && (
          <li>
            o reserva ≤ <span className="font-mono">{Math.floor(o2 - need)} min</span> (ahora {reserve})
          </li>
        )}
        {perObj >= 0 && (
          <li>
            o actividad ≤ <span className="font-mono">{perObj} min</span>/objetivo
          </li>
        )}
      </ul>
    </>,
  );
}
