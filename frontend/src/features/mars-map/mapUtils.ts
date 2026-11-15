import Projection from 'ol/proj/Projection';
import type { Extent } from 'ol/extent';
import type { Layer, RegionManifest } from '../../shared/types/contracts';

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export function manifestExtent({ bounds_local_m: b }: RegionManifest): Extent {
  return [b.min_x, b.min_y, b.max_x, b.max_y];
}

// Proyección cartesiana local en metros
export function marsProjection(manifest: RegionManifest) {
  return new Projection({
    code: manifest.frame.frame_id,
    units: 'm',
    extent: manifestExtent(manifest),
  });
}

// El mapa admite imágenes estáticas en archivo o data URL.
export const isImageLayer = (l: Layer) => /^data:image\/|\.(png|jpe?g|webp)$/i.test(l.asset_url);

export const initialLayerState = (layers: Layer[]): Record<string, LayerState> =>
  Object.fromEntries(
    layers.map((l) => [
      l.layer_id,
      { visible: isImageLayer(l) && (l.kind === 'optical' || l.kind === 'topographic'), opacity: l.opacity_default },
    ]),
  );
// El color identifica el tramo. El trazo indica su estado.
export const LEG_COLORS = ['#4285f4', '#a142f4', '#f538a0', '#24c1e0', '#e8eaed'];
