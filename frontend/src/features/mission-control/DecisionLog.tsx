import type { Mission } from '../../shared/types/contracts';

export default function DecisionLog({ mission }: { mission: Mission }) {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="eyebrow">
        Misión {mission.mission_id} · v{mission.version}
      </h2>
      <p className="text-xs">
        Estado: {mission.status} · Próximo objetivo: {mission.next_objective_id ?? '—'}
      </p>
      <p className="text-xs">
        O₂ {mission.resources.oxygen_available_min} min · Reserva {mission.resources.return_reserve_min} min
      </p>
      {mission.sample_only && (
        <p className="text-xs text-amber-400">Datos de muestra (sample_only): no usar para navegación real.</p>
      )}
      {mission.alerts.map((a) => (
        <p key={a} className="rounded bg-alert-950 p-2 text-xs text-alert-300">
          {a}
        </p>
      ))}
      <ol className="space-y-2">
        {mission.decision_log.map((d, i) => (
          <li key={i} className="border-l-2 border-primary-600 pl-2">
            <span className="text-xs uppercase text-space-300">
              {d.event_type}
              {d.simulated && ' · simulado'}
            </span>
            <p>{d.message}</p>
            {d.evidence_ids.length > 0 && (
              <p className="text-xs text-space-400">Evidencia: {d.evidence_ids.join(', ')}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}