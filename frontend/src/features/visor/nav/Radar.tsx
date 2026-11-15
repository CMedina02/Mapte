// Radar del visor: norte arriba, centrado en la posición actual (inicio de la ruta restante).
// Solo dibuja geometría del backend: ruta, base, destino y zonas de riesgo.
import type { Hazard, Position } from '../../../shared/types/contracts';

interface Props {
  center: Position;
  target: Position | null;
  base: Position;
  path: Position[];
  hazards: Hazard[];
  heading: number | null; // hacia dónde mira el astronauta (null = desconocido)
}

const R = 92; // radio útil en unidades del viewBox (200 × 200)
const RANGES = [250, 500, 1000, 2000, 3000, 5000, 10000];

export default function Radar({ center, target, base, path, hazards, heading }: Props) {
  // Alcance: el menor anillo "redondo" que contiene el siguiente destino con margen (o toda la ruta si no hay destino).
  // Lo que queda fuera del alcance se recorta en el borde del radar.
  const dist = (p: Position) => Math.hypot(p.x_m - center.x_m, p.y_m - center.y_m);
  const far = target ? dist(target) * 1.4 : Math.max(1, ...path.map(dist));
  const range = RANGES.find((r) => r >= far) ?? RANGES[RANGES.length - 1];

  const sx = (p: Position) => 100 + ((p.x_m - center.x_m) / range) * R;
  const sy = (p: Position) => 100 - ((p.y_m - center.y_m) / range) * R; // norte arriba
  const pts = (ps: Position[]) => ps.map((p) => `${sx(p).toFixed(1)},${sy(p).toFixed(1)}`).join(' ');

  return (
    <svg viewBox="0 0 200 200" className="h-auto w-full drop-shadow" role="img" aria-label={`Radar, alcance ${range} m, norte arriba`}>
      <defs>
        <clipPath id="radar-clip">
          <circle cx="100" cy="100" r={R} />
        </clipPath>
        <radialGradient id="radar-bg">
          <stop offset="0%" stopColor="#0b3d91" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#070d1f" stopOpacity="0.85" />
        </radialGradient>
        <radialGradient id="radar-cone" cx="100" cy="100" r={R} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#82a5e5" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#82a5e5" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="100" r={R} fill="url(#radar-bg)" stroke="#5182d8" strokeOpacity="0.7" />

      <g clipPath="url(#radar-clip)">
        {/* Anillos a 1/3 y 2/3 del alcance y ejes */}
        {[1 / 3, 2 / 3].map((f) => (
          <circle key={f} cx="100" cy="100" r={R * f} fill="none" stroke="#5182d8" strokeOpacity="0.35" />
        ))}
        <line x1="100" y1="8" x2="100" y2="192" stroke="#5182d8" strokeOpacity="0.25" />
        <line x1="8" y1="100" x2="192" y2="100" stroke="#5182d8" strokeOpacity="0.25" />

        {hazards.map((hz) => (
          <polygon
            key={hz.hazard_id}
            points={pts(hz.polygon)}
            fill={hz.kind === 'exclusion' ? '#fc3d21' : '#f59e0b'}
            fillOpacity="0.25"
            stroke={hz.kind === 'exclusion' ? '#fc3d21' : '#f59e0b'}
            strokeDasharray={hz.kind === 'exclusion' ? undefined : '4 3'}
          />
        ))}

        {path.length > 1 && (
          <polyline points={pts(path)} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" />
        )}

        <circle cx={sx(base)} cy={sy(base)} r="4.5" fill="#ffffff" />
        {target && (
          <g>
            <circle cx={sx(target)} cy={sy(target)} r="9" fill="none" stroke="#22c55e" strokeWidth="1.5" />
            <circle cx={sx(target)} cy={sy(target)} r="4.5" fill="#22c55e" />
          </g>
        )}

        {/* Cono de visión estilo GPS: hacia dónde mira el astronauta (45° de apertura) */}
        {heading !== null && (
          <path
            d={`M100 100 L${100 + R * Math.sin(-Math.PI / 8)} ${100 - R * Math.cos(Math.PI / 8)} A${R} ${R} 0 0 1 ${100 + R * Math.sin(Math.PI / 8)} ${100 - R * Math.cos(Math.PI / 8)} Z`}
            fill="url(#radar-cone)"
            transform={`rotate(${heading} 100 100)`}
          />
        )}
      </g>

      {/* Posición actual: punto GPS con pulso (el pulso se detiene con "reducir movimiento") */}
      <circle cx="100" cy="100" r="9" fill="#2c63c4" fillOpacity="0.35" className="motion-safe:animate-ping" style={{ transformOrigin: '100px 100px' }} />
      <circle cx="100" cy="100" r="6" fill="#2c63c4" stroke="#ffffff" strokeWidth="2.5" />
      {heading !== null && (
        <path d="M100 84 L105 93 L95 93 Z" fill="#ffffff" transform={`rotate(${heading} 100 100)`} />
      )}

      <text x="100" y="20" textAnchor="middle" className="fill-alert-400 text-[13px] font-bold">N</text>
      <text x="100" y="196" textAnchor="middle" className="fill-primary-200 text-[10px]">{range >= 1000 ? `${range / 1000} km` : `${range} m`}</text>
    </svg>
  );
}
