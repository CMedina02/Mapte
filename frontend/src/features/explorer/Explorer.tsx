import { useEffect, useState } from 'react';
import { marsApi } from '../../shared/api/client';
import type { Mission, Objective, Photo } from '../../shared/types/contracts';
import DecisionLog from '../mission-control/DecisionLog';
import ProgressCard from './ProgressCard';
import PhotoViewer from './PhotoViewer';
import ObservationForm from './ObservationForm';

interface Props {
  mission: Mission;
  onMission: (m: Mission) => void;
}

export default function Explorer({ mission, onMission }: Props) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<{ before: string | null; after: string | null } | null>(null);

  useEffect(() => {
    Promise.all([marsApi.getObjectives(mission.region_id), marsApi.getPhotos(mission.region_id)])
      .then(([objs, ph]) => {
        setObjectives(objs);
        setPhotos(ph);
      })
      .catch((e) => setError(String(e)));
  }, [mission.region_id]);

  const title = (id: string | null) => objectives.find((o) => o.objective_id === id)?.title ?? id ?? '—';
  const current = objectives.find((o) => o.objective_id === mission.next_objective_id) ?? null;

  function handleUpdated(next: Mission) {
    setChange({ before: mission.next_objective_id, after: next.next_objective_id });
    onMission(next);
  }

  if (error) return <p className="p-6 text-red-500">{error}</p>;

  return (
    <div className="grid h-full gap-4 overflow-y-auto p-4 md:grid-cols-2">
      <div className="space-y-4">
        <ProgressCard mission={mission} current={current} />
        {change && (
          <p className="rounded border border-sky-700 bg-sky-950 p-3 text-sm">
            Plan actualizado · próximo objetivo: {title(change.before)} → {title(change.after)}
          </p>
        )}
        <ObservationForm mission={mission} objectives={objectives} onUpdated={handleUpdated} />
      </div>
      <div className="space-y-4">
        <PhotoViewer photos={photos.filter((p) => p.objective_id === current?.objective_id)} />
        <DecisionLog mission={mission} />
      </div>
    </div>
  );
}