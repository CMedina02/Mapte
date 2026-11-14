import { useState } from 'react';
import type { Mission } from './shared/types/contracts';
import MissionControl from './features/mission-control/MissionControl';
import Explorer from './features/explorer/Explorer';

type View = 'control' | 'explorer';

export default function App() {
  const [mission, setMission] = useState<Mission | null>(null);
  const [view, setView] = useState<View>('control');

  const tab = (v: View, label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setView(v)}
      className={`rounded px-4 py-2 disabled:opacity-40 ${view === v ? 'bg-orange-600 font-bold' : 'bg-neutral-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col bg-neutral-950 font-mono text-neutral-100">
      <header className="flex items-center gap-2 border-b border-neutral-800 p-2">
        {tab('control', 'Mission Control')}
        {tab('explorer', 'Explorer', !mission)}
        {mission && (
          <span className="ml-auto text-xs text-neutral-400">
            {mission.mission_id} · v{mission.version} · {mission.status}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {view === 'explorer' && mission ? (
          <Explorer mission={mission} onMission={setMission} />
        ) : (
          <MissionControl mission={mission} onMission={setMission} />
        )}
      </div>
    </div>
  );
}