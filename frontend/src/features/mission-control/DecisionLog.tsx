import type { Mission, Objective } from '../../shared/types/contracts';
import { eventText, MISSION_STATUS } from '../../shared/format';

// Bitácora: estado + historial de decisiones. Los avisos viven en la pestaña Ruta (no se repiten aquí).
export default function DecisionLog({ mission, objectives = [] }: { mission: Mission; objectives?: Objective[] }) {
  const next = mission.next_objective_id;
  const nextTitle = next ? (objectives.find((o) => o.objective_id === next)?.title ?? next) : 'Base';
  return (
    <section className="space-y-2 text-sm">
      <h2 className="eyebrow">Bitácora</h2>
      <p className="text-xs text-space-300">
        Misión {mission.mission_id} · v{mission.mission_version} · {MISSION_STATUS[mission.lifecycle_status] ?? mission.lifecycle_status}
        {' · '}Siguiente: {nextTitle} · O₂ {mission.resources.oxygen_available_min} min
      </p>
      <ol className="space-y-2">
        {mission.decision_log.map((d, i) => (
          <li key={i} className="border-l-2 border-primary-600 pl-2">
            <span className="text-[11px] text-space-400">
              {eventText(d.event_type)}
              {d.simulated && ' · simulado'}
            </span>
            <p className="text-xs" title={d.evidence_ids.length ? `Evidencia: ${d.evidence_ids.join(', ')}` : undefined}>
              {d.message}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
