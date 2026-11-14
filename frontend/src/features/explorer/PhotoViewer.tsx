import { useState } from 'react';
import type { LocationQuality, Photo } from '../../shared/types/contracts';

const QUALITY: Record<LocationQuality, { label: string; cls: string }> = {
  verified: { label: 'Ubicación verificada', cls: 'bg-green-900 text-green-300' },
  approximate: { label: 'Ubicación aproximada', cls: 'bg-amber-900 text-amber-300' },
  unknown: { label: 'Ubicación desconocida', cls: 'bg-red-950 text-red-300' },
};

export default function PhotoViewer({ photos }: { photos: Photo[] }) {
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (photos.length === 0) {
    return (
      <section className="rounded border border-neutral-700 p-4 text-sm text-neutral-500">
        Sin fotografías para este objetivo.
      </section>
    );
  }

  const n = photos.length;
  const idx = Math.min(i, n - 1);
  const p = photos[idx];
  const q = QUALITY[p.location_quality] ?? QUALITY.unknown;

  return (
    <section className="space-y-2 rounded border border-neutral-700 p-4 text-sm">
      <p className="text-xs uppercase tracking-widest text-neutral-400">
        Vista POV · {idx + 1}/{n}
      </p>

      {broken[p.photo_id] ? (
        <div className="flex aspect-video items-center justify-center rounded bg-neutral-900 text-neutral-500">
          Imagen no disponible
        </div>
      ) : (
        <img
          src={p.image_url}
          alt={`Cámara ${p.camera}, sol ${p.sol ?? 'desconocido'}`}
          className="aspect-video w-full rounded bg-neutral-900 object-cover"
          onError={() => setBroken((b) => ({ ...b, [p.photo_id]: true }))}
        />
      )}

      <span className={`inline-block rounded px-2 py-1 text-xs font-bold ${q.cls}`}>{q.label}</span>
      <p>
        Cámara {p.camera} · Sol {p.sol ?? 'desconocido'} · {p.captured_at ?? 'fecha desconocida'}
      </p>
      <p className="text-xs text-neutral-400">
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
          <button type="button" className="flex-1 rounded bg-neutral-800 p-3" onClick={() => setI((idx - 1 + n) % n)}>
            ◀ Anterior
          </button>
          <button type="button" className="flex-1 rounded bg-neutral-800 p-3" onClick={() => setI((idx + 1) % n)}>
            Siguiente ▶
          </button>
        </div>
      )}
    </section>
  );
}