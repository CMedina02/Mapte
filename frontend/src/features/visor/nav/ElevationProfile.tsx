// Eje X: índice del punto en la ruta.
import type { Position } from '../../../shared/types/contracts';

export default function ElevationProfile({ path, datum }: { path: Position[]; datum?: string }) {
  const zs = path.map((p) => p.z_m).filter((z): z is number => typeof z === 'number');
  if (zs.length < 2 || zs.length !== path.length) {
    return <p className="text-xs text-space-300">Elevation profile unavailable (the route has no z_m).</p>;
  }

  const min = Math.min(...zs);
  const max = Math.max(...zs);
  const span = Math.max(max - min, 1);
  const W = 300, H = 56;
  const line = zs.map((z, i) => `${((i / (zs.length - 1)) * W).toFixed(1)},${(H - 4 - ((z - min) / span) * (H - 8)).toFixed(1)}`);

  return (
    <figure className="space-y-1">
      <figcaption className="flex justify-between text-[11px] text-space-300">
        <span>Current elevation {Math.round(zs[0])} m</span>
        <span>
          {Math.round(min)} – {Math.round(max)} m{datum ? ` · ${datum}` : ''}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label={`Elevation profile from ${Math.round(min)} to ${Math.round(max)} meters`}>
        <polygon points={`0,${H} ${line.join(' ')} ${W},${H}`} fill="#1a73e8" fillOpacity="0.25" />
        <polyline points={line.join(' ')} fill="none" stroke="#8ab4f8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx="0" cy={line[0].split(',')[1]} r="3.5" fill="#ffffff" />
      </svg>
    </figure>
  );
}
