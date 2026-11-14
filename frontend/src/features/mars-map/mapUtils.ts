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

// ponytail: solo imágenes estática, .tif (GeoTIFF) 
export const isImageLayer = (l: Layer) => /\.(png|jpe?g|webp)$/i.test(l.asset_url);

export const initialLayerState = (layers: Layer[]): Record<string, LayerState> =>
  Object.fromEntries(
    layers.map((l) => [l.layer_id, { visible: isImageLayer(l), opacity: l.opacity_default }]),
  );