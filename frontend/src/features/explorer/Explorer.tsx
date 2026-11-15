import { useEffect, useState, useMemo} from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective, Photo } from '../../shared/types/contracts';
import DecisionLog from '../mission-control/DecisionLog';
import { loadPackage, type PendingObservation } from '../offline-sync/offline';
import ProgressCard from './ProgressCard';
import PhotoViewer from './PhotoViewer';
import ObservationForm from './ObservationForm';
import ContingencyPanel from './ContingencyPanel';

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

  return (
    <div className="mx-auto grid max-w-7xl items-start gap-4 p-3 sm:p-4 lg:h-full lg:grid-cols-2 lg:overflow-y-auto">
      <div className="space-y-4">
        {mission.alerts.length > 0 && (
          <div role="alert" className="space-y-1 rounded-lg border border-alert-600 bg-alert-950 p-3 text-alert-200">
            <p className="font-bold">⚠ {mission.alerts.includes('OXYGEN_REDUCED') ? 'CONTINGENCIA ACTIVA' : 'ALERTAS'}</p>
            {mission.alerts.map((a) => (
              <p key={a} className="text-sm">
                {a}
              </p>
            ))}
          </div>
        )}
        <ProgressCard mission={mission} current={current} />
        {change && (
          <p role="status" className="rounded-lg border border-primary-700 bg-primary-950 p-3 text-sm">
            Plan actualizado · próximo objetivo: {title(change.before)} → {title(change.after)}
          </p>
        )}
        <ObservationForm mission={mission} objectives={objectives} onUpdated={handleUpdated} onQueue={onQueue} />
        <ContingencyPanel mission={mission} onMission={onMission} />
      </div>
      <div className="space-y-4">
        <PhotoViewer photos={photos.filter((p) => p.objective_id === current?.objective_id)} />
        <DecisionLog mission={mission} />
      </div>
    </div>
  );
}
