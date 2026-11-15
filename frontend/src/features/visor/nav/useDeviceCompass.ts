import { useEffect, useState } from 'react';
import { norm360 } from './geo';

// Rumbo del dispositivo (brújula + giroscopio) para orientar la vista 3D hacia donde mira el astronauta.
// ponytail: en Marte no hay campo magnético global; el casco real usaría IMU + seguidor estelar.
// Aquí la brújula del teléfono/tableta simula ese sensor para el prototipo.
type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };

export const compassAvailable = () =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && window.matchMedia('(pointer: coarse)').matches;

export function useDeviceCompass() {
  const [enabled, setEnabled] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onOrient = (e: OrientationEvt) => {
      let deg: number | null = null;
      if (typeof e.webkitCompassHeading === 'number') deg = e.webkitCompassHeading; // iOS: rumbo ya calculado
      else if (e.absolute && e.alpha !== null) deg = 360 - e.alpha; // Android: alpha crece en sentido antihorario
      if (deg === null) return;
      // Rumbo del borde superior de la pantalla, aunque el dispositivo esté en horizontal
      setHeading(Math.round(norm360(deg + (screen.orientation?.angle ?? 0))));
    };
    // Chrome Android solo da rumbo absoluto en 'deviceorientationabsolute'
    const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, onOrient as EventListener);
    return () => window.removeEventListener(type, onOrient as EventListener);
  }, [enabled]);

  // iOS exige pedir permiso desde un toque del usuario
  async function enable() {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (D.requestPermission && (await D.requestPermission()) !== 'granted') return false;
    setEnabled(true);
    return true;
  }
  function disable() {
    setEnabled(false);
    setHeading(null);
  }

  return { enabled, heading, enable, disable };
}
