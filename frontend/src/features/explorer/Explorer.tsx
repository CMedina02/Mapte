import { useEffect, useState, useMemo} from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective, Photo } from '../../shared/types/contracts';
import DecisionLog from '../mission-control/DecisionLog';
import { loadPackage, type PendingObservation } from '../offline-sync/offline';
import ProgressCard from './ProgressCard';
import PhotoViewer from './PhotoViewer';
import ObservationForm from './ObservationForm';
import { notices } from '../../shared/format';
import Icon from '../../shared/ui/Icon';

interface Props {
  mission: Mission;
  onMission: (m: Mission) => void;
  onQueue: (o: PendingObservation) => void;
}

export default function Explorer({ mission, onMission, onQueue }: Props) {
    const [remote, setRemote] = useState<{ objectives: Objective[]; photos: Photo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<{ before: string | null; after: string | null } | null>(null);

  const local = useMemo(() => {
    const pkg = loadPackage();
    return pkg?.mission.mission_id === mission.mission_id ? pkg : null;
  }, [mission.mission_id]);

  useEffect(() => {
    if (local) return;
    Promise.all([marsApi.getObjectives(mission.region_id), marsApi.getPhotos(mission.region_id)])
      .then(([objectives, photos]) => setRemote({ objectives, photos }))
      .catch((e) => setError(String(e)));
  }, [local, mission.region_id]);

  const objectives = local?.objectives ?? remote?.objectives ?? [];
  const photos = local?.photos ?? remote?.photos ?? [];

  const title = (id: string | null) => objectives.find((o) => o.objective_id === id)?.title ?? id ?? '—';
  const current = objectives.find((o) => o.objective_id === mission.next_objective_id) ?? null;

  function handleUpdated(next: Mission) {
    setChange({ before: mission.next_objective_id, after: next.next_objective_id });
    onMission(next);
  }

  if (error) return <p className="p-6 text-alert-500">{error}</p>;
  // Mismo filtro que el panel: sin códigos internos ni avisos que ya dice el estado de la ruta
  const alerts = notices([], mission.alerts);

  return (
    <div className="mx-auto grid max-w-7xl items-start gap-4 p-3 sm:p-4 lg:h-full lg:grid-cols-2 lg:overflow-y-auto">
      <div className="space-y-4">
        {alerts.length > 0 && (
          <div role="alert" className="space-y-1 rounded-[var(--radius-card)] bg-alert-950 p-4 text-alert-200">
            <p className="flex items-center gap-2 font-medium">
              <Icon name="warning" size={18} />
              {mission.alerts.includes('OXYGEN_REDUCED') ? 'Oxígeno reducido' : 'Avisos'}
            </p>
            {alerts.map((a) => (
              <p key={a} className="text-sm">
                {a}
              </p>
            ))}
          </div>
        )}
        <ProgressCard mission={mission} current={current} />
        {change && (
          <p role="status" className="rounded-[var(--radius-card)] bg-primary-950 p-4 text-sm text-primary-100">
            Plan actualizado: el siguiente objetivo pasa de {title(change.before)} a {title(change.after)}.
          </p>
        )}
        <ObservationForm mission={mission} objectives={objectives} onUpdated={handleUpdated} onQueue={onQueue} />
      </div>
      <div className="space-y-4">
        <PhotoViewer photos={photos.filter((p) => p.objective_id === current?.objective_id)} />
        <DecisionLog mission={mission} objectives={objectives} />
      </div>
    </div>
  );
}
