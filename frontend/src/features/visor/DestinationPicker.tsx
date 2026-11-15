import type { Position } from '../../shared/types/contracts';
import Icon from '../../shared/ui/Icon';
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
  letters?: Record<string, string>; // letra de cada parada del plan (A = base)
  onSelect: (id: string) => void;
}

// Lista de destinos con el mismo diseño que el panel de control: letra de parada, nombre y estado
export default function DestinationPicker({ destinations, selectedId, here, letters = {}, onSelect }: Props) {
  return (
    <ul role="radiogroup" aria-label="Destination" className="overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-space-900/70">
      {destinations.map((d, i) => {
        const b = bearingDeg(here, d.position);
        const selected = d.id === selectedId;
        const blocked = d.reach === 'no';
        const letter = letters[d.id === 'custom' ? '' : d.id];
        const [name, detail] = d.title.split(' — ');
        return (
          <li key={d.id} className={i ? 'border-t border-white/10' : undefined}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={blocked}
              onClick={() => onSelect(d.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
                selected ? 'bg-primary-600/20' : 'enabled:hover:bg-white/5'
              } ${blocked ? 'opacity-60' : ''}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  blocked ? 'bg-alert-950 text-alert-300' : selected ? 'bg-primary-600 text-white' : 'bg-space-800 text-space-200'
                }`}
              >
                {blocked ? <Icon name="block" size={16} /> : d.id === 'custom' ? <Icon name="flag" size={16} /> : (letter ?? '')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug font-medium text-space-50">{name}</span>
                {detail && <span className="block truncate text-xs text-space-400">{detail}</span>}
                <span className={`block text-xs ${blocked ? 'text-alert-300' : 'text-space-300'}`}>
                  {blocked
                    ? d.note
                    : `${Math.round(b)}° ${cardinal(b)}${d.recommended ? ' · next in plan' : ''}${d.reach === 'ok' ? ' · safe return' : ''}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
