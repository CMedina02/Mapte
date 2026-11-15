import type { Position } from '../../shared/types/contracts';
import { bearingDeg, cardinal } from './nav/geo';

export interface Destination {
  id: string;
  title: string;
  position: Position;
  recommended: boolean; // el plan lo marca como siguiente
  reach?: 'ok' | 'no'; // ok: el plan garantiza regreso seguro; no: el backend lo dejó fuera
  note?: string; // motivo cuando no se puede llegar
}

interface Props {
  destinations: Destination[];
  selectedId: string;
  here: Position;
  onSelect: (id: string) => void;
}

// El astronauta elige a dónde ir; el destino del plan viene marcado y preseleccionado
export default function DestinationPicker({ destinations, selectedId, here, onSelect }: Props) {
  return (
    <div role="radiogroup" aria-label="Destino" className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
      {destinations.map((d) => {
        const b = bearingDeg(here, d.position);
        const selected = d.id === selectedId;
        const blocked = d.reach === 'no';
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={blocked}
            onClick={() => onSelect(d.id)}
            className={`min-h-14 min-w-40 shrink-0 snap-start rounded-lg border px-3 py-2 text-left transition-colors ${
              blocked
                ? 'border-alert-800 bg-alert-950/40 opacity-70'
                : selected
                  ? 'border-green-500 bg-green-950/60'
                  : 'border-space-700 bg-space-900/70 hover:border-primary-400'
            }`}
          >
            <span className="block text-sm font-bold">{d.title}</span>
            <span className="block text-[11px] text-space-300">
              Rumbo {Math.round(b)}° {cardinal(b)}
              {d.recommended && <span className="text-green-400"> · plan</span>}
              {d.reach === 'ok' && <span className="text-green-400"> · con regreso seguro</span>}
              {blocked && <span className="block text-alert-300">{d.note}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
