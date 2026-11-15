import type { Frame, Position } from '../../shared/types/contracts';
import { approxLatLon } from './nav/geo';

// Posición del astronauta en una línea: lugar · lat/lon aprox. · elevación (X/Y locales en el tooltip)
export default function PositionCard({ frame, here, label, online }: { frame: Frame; here: Position; label: string; online: boolean }) {
  const { lat, lon } = approxLatLon(frame, here);
  return (
    <p
      className="hud pointer-events-auto flex min-h-9 w-fit items-center gap-2 px-2.5 py-1 text-[11px] whitespace-nowrap"
      title={`Marco local: X ${Math.round(here.x_m)} m · Y ${Math.round(here.y_m)} m · ${online ? 'Con enlace' : 'Sin enlace'}`}
    >
      {/* Enlace con el centro de control: verde con enlace, ámbar sin él */}
      <span className={online ? 'text-green-400' : 'text-amber-300'} role="img" aria-label={online ? 'Con enlace' : 'Sin enlace'}>
        ●
      </span>
      <span className="font-bold tracking-widest text-primary-300 uppercase">{label}</span>
      <span className="font-mono">
        ≈{lat.toFixed(4)}°, {lon.toFixed(4)}°E
      </span>
      <span className="font-mono text-space-300">
        {here.z_m == null ? 'Elev. desconocida' : `${Math.round(here.z_m)} m`}
      </span>
    </p>
  );
}
