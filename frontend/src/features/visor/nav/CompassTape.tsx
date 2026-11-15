// Cinta de rumbo estilo visor, centrada en hacia dónde mira el astronauta (la cámara de la vista 3D).
// El triángulo verde marca el rumbo al destino; si queda fuera de la cinta, una flecha indica hacia dónde girar.
// Sin rumbo de vista (vista 2D) la cinta se centra en el destino.
import { cardinal, norm360, turnDeg } from './geo';

const PX_PER_DEG = 2;
const HALF_SPAN = 60; // grados visibles a cada lado
const tickLabel = (d: number) => (d % 90 === 0 ? cardinal(d) : String(d));
const pad = (d: number) => String(Math.round(norm360(d))).padStart(3, '0');

export default function CompassTape({ heading, bearing }: { heading: number | null; bearing: number | null }) {
  const center = Math.round(norm360(heading ?? bearing ?? 0));
  const ticks: number[] = [];
  for (let d = Math.ceil((center - HALF_SPAN) / 5) * 5; d <= center + HALF_SPAN; d += 5) ticks.push(d);

  const turn = heading !== null && bearing !== null ? turnDeg(heading, bearing) : 0;
  const markerX = 120 + Math.max(-HALF_SPAN, Math.min(HALF_SPAN, turn)) * PX_PER_DEG;
  const offTape = Math.abs(turn) > HALF_SPAN;

  return (
    <div className="mx-auto w-full max-w-lg">
      <svg viewBox="0 0 240 36" className="h-auto w-full" role="img" aria-label={`Vista ${pad(center)} grados ${cardinal(center)}`}>
        <defs>
          <linearGradient id="tape-fade" x1="0" x2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="18%" stopColor="#fff" stopOpacity="1" />
            <stop offset="82%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="tape-mask">
            <rect width="240" height="36" fill="url(#tape-fade)" />
          </mask>
        </defs>
        <g mask="url(#tape-mask)">
          <rect x="0" y="0" width="240" height="24" fill="#070d1f" fillOpacity="0.7" />
          <line x1="0" y1="24" x2="240" y2="24" stroke="#5182d8" strokeOpacity="0.8" />
          {ticks.map((d) => {
            const x = 120 + (d - center) * PX_PER_DEG;
            const major = norm360(d) % 30 === 0;
            return (
              <g key={d}>
                <line x1={x} y1={major ? 14 : 18} x2={x} y2="24" stroke="#b3c8f0" strokeOpacity={major ? 1 : 0.5} />
                {major && (
                  <text x={x} y="11" textAnchor="middle" className={`text-[9px] font-bold ${norm360(d) === 0 ? 'fill-alert-400' : 'fill-primary-100'}`}>
                    {tickLabel(norm360(d))}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Hacia dónde mira el astronauta */}
        <line x1="120" y1="2" x2="120" y2="24" stroke="#ffffff" strokeWidth="1.5" />

        {/* Destino */}
        {bearing !== null &&
          (offTape ? (
            <path d={turn > 0 ? 'M232 18 L222 12 L222 24 Z' : 'M8 18 L18 12 L18 24 Z'} fill="#22c55e" />
          ) : (
            <path d={`M${markerX} 25 L${markerX - 5} 34 L${markerX + 5} 34 Z`} fill="#22c55e" />
          ))}
      </svg>
      <p className="text-center">
        <span className="rounded bg-space-950/75 px-2 py-0.5 text-[11px] font-semibold tracking-widest text-primary-100 uppercase">
          {heading !== null ? `Vista ${pad(heading)}° ${cardinal(heading)}` : 'Norte arriba'}
          {bearing !== null && ` · Destino ${pad(bearing)}° ${cardinal(bearing)}`}
          {heading !== null && bearing !== null && Math.abs(turn) >= 5 && (
            <span className="text-green-400"> · gira {Math.abs(Math.round(turn))}° {turn > 0 ? '→' : '←'}</span>
          )}
        </span>
      </p>
    </div>
  );
}
