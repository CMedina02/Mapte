import { useState } from 'react';
import type { LocationQuality, Objective, Photo } from '../../shared/types/contracts';
import Icon from '../../shared/ui/Icon';

const QUALITY: Record<LocationQuality, { label: string; cls: string }> = {
  verified: { label: 'Verified location', cls: 'bg-green-900 text-green-300' },
  approximate: { label: 'Approximate location', cls: 'bg-amber-900 text-amber-300' },
  unknown: { label: 'Unknown location', cls: 'bg-alert-950 text-alert-300' },
};

interface Props {
  objective: Objective;
  photos: Photo[]; // fotos de Curiosity en este sitio (vienen en el paquete: se ven sin red si están en caché)
  onClose: () => void;
}

// «Explorar» en el visor: lo que antes era la pestaña Explorer del panel. El astronauta ve qué buscar en el
// objetivo (pregunta científica y actividades) y las fotos reales del rover como referencia del terreno.
export default function ObjectiveExplorer({ objective, photos, onClose }: Props) {
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [name, detail] = objective.title.split(' — ');
  const n = photos.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  const p = photos[idx];
  const q = p ? (QUALITY[p.location_quality] ?? QUALITY.unknown) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Explore ${name}`} className="absolute inset-0 z-30 flex flex-col bg-space-950 lg:flex-row">
      {/* Foto grande: en la tableta es lo primero que se ve */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        {!p ? (
          <p className="text-sm text-space-400">No photos for this objective.</p>
        ) : broken[p.photo_id] ? (
          <p className="text-sm text-space-400">Image unavailable offline.</p>
        ) : (
          <img
            key={p.photo_id}
            src={p.image_url}
            alt={`Camera ${p.camera}, sol ${p.sol ?? 'unknown'}`}
            className="max-h-full max-w-full object-contain"
            onError={() => setBroken((b) => ({ ...b, [p.photo_id]: true }))}
          />
        )}
        {n > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setI((idx - 1 + n) % n)}
              className="hud absolute left-3 flex size-12 items-center justify-center rounded-full text-space-50 hover:bg-space-800"
            >
              <Icon name="arrow" className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setI((idx + 1) % n)}
              className="hud absolute right-3 flex size-12 items-center justify-center rounded-full text-space-50 hover:bg-space-800"
            >
              <Icon name="arrow" />
            </button>
            <span className="hud absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs text-space-200">
              {idx + 1} of {n}
            </span>
          </>
        )}
      </div>

      <aside className="flex max-h-[50dvh] flex-col border-white/10 bg-space-950 lg:max-h-none lg:w-96 lg:border-l">
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <p className="text-xs text-space-400">Explore</p>
            <p className="text-lg leading-snug font-medium text-space-50">{name}</p>
            {detail && <p className="text-sm text-space-400">{detail}</p>}
          </div>
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-space-200 hover:bg-white/10"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-sm">
          <section className="space-y-1">
            <h2 className="eyebrow">Science question</h2>
            <p className="text-space-100">{objective.science_question}</p>
            {objective.description && <p className="text-xs text-space-400">{objective.description}</p>}
          </section>

          {objective.activities.length > 0 && (
            <section className="space-y-2">
              <h2 className="eyebrow">Activities</h2>
              <ul className="space-y-1.5">
                {objective.activities.map((a) => (
                  <li key={a} className="flex gap-2 text-space-100">
                    <Icon name="check" size={18} className="text-primary-300" />
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {p && q && (
            <section className="space-y-2 rounded-[var(--radius-card)] border border-white/10 bg-space-900/70 p-4">
              <span className={`chip ${q.cls}`}>{q.label}</span>
              <p className="text-space-100">
                Camera {p.camera} · Sol {p.sol ?? 'unknown'} · {p.captured_at ?? 'unknown date'}
              </p>
              <p className="text-xs text-space-400">
                Credit:{' '}
                <a href={p.source_url} target="_blank" rel="noreferrer" className="text-primary-200 underline">
                  {p.credit}
                </a>
              </p>
              {p.limitations.map((l) => (
                <p key={l} className="flex gap-1.5 text-xs text-amber-300">
                  <Icon name="warning" size={16} />
                  {l}
                </p>
              ))}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
