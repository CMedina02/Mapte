import type { Frame, Position } from '../../shared/types/contracts';
import { approxLatLon } from './nav/geo';

// Tarjeta de posición del astronauta (esquina superior izquierda, como en el visor de referencia)
export default function PositionCard({ frame, here, label }: { frame: Frame; here: Position; label: string }) {
  const { lat, lon } = approxLatLon(frame, here);
  return (
    <div className="hud px-3 py-2 text-[11px] leading-relaxed">
      <p className="eyebrow">Posición · {label}</p>
      <p className="font-mono">
        {lat.toFixed(4)}°, {lon.toFixed(4)}°E <span className="font-sans text-space-400">aprox.</span>
      </p>
      <p className="font-mono text-space-300">
        X {Math.round(here.x_m)} m · Y {Math.round(here.y_m)} m
      </p>
      <p>
        Elevación <span className="font-mono">{here.z_m == null ? 'desconocida' : `${Math.round(here.z_m)} m`}</span>
      </p>
    </div>
  );
}
