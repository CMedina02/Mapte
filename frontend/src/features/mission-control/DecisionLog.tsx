import type { Mission, Objective } from '../../shared/types/contracts';
import { eventText } from '../../shared/format';

// Plan creado y objetivos excluidos ya se ven en Tramos: la bitácora solo muestra lo que pasa en la EVA
const SHOWN_ELSEWHERE = new Set(['plan_created', 'objective_excluded']);

export default function DecisionLog({ mission }: { mission: Mission; objectives?: Objective[] }) {
  const entries = mission.decision_log.filter((d) => !SHOWN_ELSEWHERE.has(d.event_type));
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2 text-sm">
      <h2 className="eyebrow">Bitácora</h2>
      <ol className="space-y-2">
        {entries.map((d, i) => (
          <li key={i} className="border-l-2 border-primary-600 pl-2">
            <span className="text-[11px] text-space-400">{eventText(d.event_type)}</span>
            <p className="text-xs">{d.message}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
