import type { Mission, Objective } from '../../shared/types/contracts';
import { eventText } from '../../shared/format';

// Plan creado y objetivos excluidos ya se ven en Tramos: la bitácora solo muestra lo que pasa en la EVA
const SHOWN_ELSEWHERE = new Set(['plan_created', 'objective_excluded']);

export default function DecisionLog({ mission }: { mission: Mission; objectives?: Objective[] }) {
  const entries = mission.decision_log.filter((d) => !SHOWN_ELSEWHERE.has(d.event_type));
  if (entries.length === 0) return null;
  return (
    <section className="space-y-2 text-sm">
      <h2 className="eyebrow">Log</h2>
      <ol className="card space-y-0 p-0">
        {entries.map((d, i) => (
          <li key={i} className={`px-4 py-3 ${i ? 'border-t border-space-800' : ''}`}>
            <span className="text-xs font-medium text-primary-600">{eventText(d.event_type)}</span>
            <p className="text-space-200">{d.message}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
