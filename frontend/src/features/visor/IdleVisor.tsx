import { lazy, Suspense, useEffect, useState } from 'react';
import type { Objective, Position, RegionManifest } from '../../shared/types/contracts';
import { marsApi } from '../../shared/api/client';
import MarsMap from '../mars-map/MarsMap';
import { initialLayerState, type LayerState } from '../mars-map/mapUtils';
import { loadLastPosition, saveLastPosition, useOnline } from '../offline-sync/offline';
import PositionCard from './PositionCard';
import ErrorBoundary from '../../shared/ui/ErrorBoundary';

const Terrain3D = lazy(() => import('../terrain-3d/Terrain3D'));

// Visor sin misión asignada: el astronauta igual ve el mapa y dónde está. Cuando el panel
// planifica, el paquete llega solo (evento storage) y el visor pasa al HUD de navegación.
export default function IdleVisor() {
  const online = useOnline();
  const [region, setRegion] = useState<{ manifest: RegionManifest; objectives: Objective[]; layers: Record<string, LayerState> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [here, setHere] = useState(loadLastPosition);
  const [use3d, setUse3d] = useState(true); // 3D desde el inicio; el 2D solo si el 3D falla

  useEffect(() => {
    marsApi
      .getRegions()
      .then((rs) => {
        const id = rs.find((r) => r.available)?.region_id;
        if (!id) throw new Error('sin región disponible');
        return Promise.all([marsApi.getManifest(id), marsApi.getObjectives(id)] as const);
      })
      .then(([manifest, objectives]) => setRegion({ manifest, objectives, layers: initialLayerState(manifest.layers) }))
      .catch(() => setFailed(true));
  }, []);

  if (!region) {
    return (
      <div className="flex h-dvh items-center justify-center bg-space-950 p-6 text-center text-sm text-space-200">
        {failed ? 'Sin misión y sin enlace con el panel de control.' : 'Cargando mapa…'}
      </div>
    );
  }

  // ponytail: sin localización del traje, la posición se fija tocando el mapa (simulación para la demo)
  const place = (p: Position) => {
    setHere(p);
    saveLastPosition(p);
  };

  const { manifest } = region;
  const b = manifest.bounds_local_m;
  // Sin posición conocida, la cámara 3D mira el centro de la zona (no se guarda como posición)
  const view = here ?? { x_m: (b.min_x + b.max_x) / 2, y_m: (b.min_y + b.max_y) / 2, frame_id: manifest.frame.frame_id };
  const map2d = (
        <MarsMap
          manifest={region.manifest}
          objectives={region.objectives}
          selectedObjectiveIds={[]}
          basePosition={null}
          layerState={region.layers}
          route={null}
          here={here}
          focus={here ? [here] : undefined}
          onMapClick={place}
        />
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-space-950 text-space-50">
      <div className="absolute inset-0">
        {use3d && manifest.terrain ? (
          <ErrorBoundary fallback={map2d}>
            <Suspense fallback={<p className="flex h-full items-center justify-center text-sm">Cargando terreno 3D…</p>}>
              <Terrain3D
                manifest={manifest}
                terrain={manifest.terrain}
                route={null}
                base={null}
                objectives={region.objectives}
                targetId={null}
                here={view}
                destination={null}
                onHeading={() => {}}
                onError={() => setUse3d(false)}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          map2d
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-wrap items-start gap-2 sm:inset-x-3 sm:top-3">
        {here && <PositionCard frame={region.manifest.frame} here={here} label="Sin misión" online={online} />}
        <p className="hud mx-auto px-3 py-1.5 text-xs">
          {here || use3d ? 'Esperando misión del panel de control' : 'Toca el mapa para fijar tu posición'}
        </p>
      </div>
    </div>
  );
}
