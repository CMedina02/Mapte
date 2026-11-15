import { useState } from 'react';
import type { LocationQuality, Photo } from '../../shared/types/contracts';

const QUALITY: Record<LocationQuality, { label: string; cls: string }> = {
  verified: { label: 'Ubicación verificada', cls: 'bg-green-900 text-green-300' },
  approximate: { label: 'Ubicación aproximada', cls: 'bg-amber-900 text-amber-300' },
  unknown: { label: 'Ubicación desconocida', cls: 'bg-alert-950 text-alert-300' },
};

export default function PhotoViewer({ photos }: { photos: Photo[] }) {
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (photos.length === 0) {
    return (
      <section className="card text-sm text-space-400">
        Sin fotografías para este objetivo.
      </section>
    );
  }

  const n = photos.length;
  const idx = Math.min(i, n - 1);
  const p = photos[idx];
  const q = QUALITY[p.location_quality] ?? QUALITY.unknown;

  return (
    <section className="card text-sm">
      <p className="eyebrow">
        Vista POV · {idx + 1}/{n}
      </p>

      {broken[p.photo_id] ? (
        <div className="flex aspect-video items-center justify-center rounded bg-space-900 text-space-400">
          Imagen no disponible
        </div>
      ) : (
        <img
          src={p.image_url}
          alt={`Cámara ${p.camera}, sol ${p.sol ?? 'desconocido'}`}
          className="aspect-video w-full rounded bg-space-900 object-cover"
          onError={() => setBroken((b) => ({ ...b, [p.photo_id]: true }))}
        />
      )}

      <span className={`inline-block rounded px-2 py-1 text-xs font-bold ${q.cls}`}>{q.label}</span>
      <p>
        Cámara {p.camera} · Sol {p.sol ?? 'desconocido'} · {p.captured_at ?? 'fecha desconocida'}
      </p>
      <p className="text-xs text-space-300">
        Crédito:{' '}
        <a href={p.source_url} target="_blank" rel="noreferrer" className="underline">
          {p.credit}
        </a>
      </p>
      {p.limitations.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-amber-300">
          {p.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {n > 1 && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={() => setI((idx - 1 + n) % n)}>
            ◀ Anterior
          </button>
          <button type="button" className="btn-ghost flex-1" onClick={() => setI((idx + 1) % n)}>
            Siguiente ▶
          </button>
        </div>
      )}
    </section>
  );
}