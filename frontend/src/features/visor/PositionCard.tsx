import type { Frame, Position } from '../../shared/types/contracts';
import { approxLatLon } from './nav/geo';

// Posición del astronauta en una línea: lugar · lat/lon aprox. · elevación (X/Y locales en el tooltip)
export default function PositionCard({ frame, here, label, online }: { frame: Frame; here: Position; label: string; online: boolean }) {
  const { lat, lon } = approxLatLon(frame, here);
  return (
    <p
      className="hud pointer-events-auto flex min-h-10 w-fit items-center gap-2.5 px-4 py-1.5 text-xs whitespace-nowrap"
      title={`Coordenadas locales: X ${Math.round(here.x_m)} m, Y ${Math.round(here.y_m)} m · ${online ? 'Conectado' : 'Sin conexión'}`}
    >
      {/* Conexión con el centro de control: verde conectado, ámbar sin conexión */}
      <span
        className={`size-2 rounded-full ${online ? 'bg-green-400' : 'bg-amber-300'}`}
        role="img"
        aria-label={online ? 'Conectado' : 'Sin conexión'}
      />
      <span className="font-medium text-space-50">{label}</span>
      <span className="font-mono text-space-300">
        {lat.toFixed(4)}°, {lon.toFixed(4)}° E
      </span>
      {here.z_m != null && <span className="font-mono text-space-400">{Math.round(here.z_m)} m</span>}
    </p>
  );
}
