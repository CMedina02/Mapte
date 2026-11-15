// Cinta de rumbo estilo visor. Marte no tiene campo magnético global útil para una brújula
// y no hay orientación del traje: la cinta se centra en el RUMBO AL DESTINO, no en hacia dónde mira el astronauta.
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const PX_PER_DEG = 2;
const HALF_SPAN = 60; // grados visibles a cada lado

const norm = (d: number) => ((d % 360) + 360) % 360;
const tickLabel = (d: number) => (d % 90 === 0 ? CARDINALS[d / 45] : String(d));

export default function CompassTape({ bearing }: { bearing: number }) {
  const b = Math.round(norm(bearing));
  const ticks: number[] = [];
  for (let d = Math.ceil((b - HALF_SPAN) / 5) * 5; d <= b + HALF_SPAN; d += 5) ticks.push(d);

  return (
    <div className="mx-auto w-full max-w-md">
      <svg viewBox="0 0 240 34" className="h-auto w-full" role="img" aria-label={`Rumbo al destino ${b} grados ${CARDINALS[Math.round(b / 45) % 8]}`}>
        <defs>
          <linearGradient id="tape-fade" x1="0" x2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="20%" stopColor="#fff" stopOpacity="1" />
            <stop offset="80%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="tape-mask">
            <rect width="240" height="34" fill="url(#tape-fade)" />
          </mask>
        </defs>
        <rect x="0" y="0" width="240" height="24" rx="4" fill="#070d1f" fillOpacity="0.75" />
        <g mask="url(#tape-mask)">
          {ticks.map((d) => {
            const x = 120 + (d - b) * PX_PER_DEG;
            const major = norm(d) % 30 === 0;
            return (
              <g key={d}>
                <line x1={x} y1={major ? 14 : 18} x2={x} y2="24" stroke="#b3c8f0" strokeOpacity={major ? 1 : 0.5} />
                {major && (
                  <text
                    x={x}
                    y="11"
                    textAnchor="middle"
                    className={`text-[9px] font-bold ${norm(d) === 0 ? 'fill-alert-400' : 'fill-primary-100'}`}
                  >
                    {tickLabel(norm(d))}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Marcador central: rumbo al destino */}
        <path d="M120 24 L115 32 L125 32 Z" fill="#22c55e" />
      </svg>
      <p className="text-center">
        <span className="rounded bg-space-950/75 px-2 py-0.5 text-[11px] font-semibold tracking-widest text-primary-100 uppercase">
          Rumbo al destino {String(b).padStart(3, '0')}° {CARDINALS[Math.round(b / 45) % 8]}
        </span>
      </p>
    </div>
  );
}
