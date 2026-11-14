import { useEffect, useRef } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromExtent } from 'ol/geom/Polygon';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import MousePosition from 'ol/control/MousePosition';
import { defaults as defaultControls } from 'ol/control/defaults';
import { createStringXY } from 'ol/coordinate';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import 'ol/ol.css';
import type { Objective, Position, RegionManifest } from '../../shared/types/contracts';
import { isImageLayer, manifestExtent, marsProjection, type LayerState } from './mapUtils';

interface Props {
  manifest: RegionManifest;
  objectives: Objective[];
  basePosition: Position | null;
  layerState: Record<string, LayerState>;
}

const boundsStyle = new Style({
  stroke: new Stroke({ color: '#f97316', width: 1, lineDash: [6, 6] }),
});

const pointStyle = (label: string, color: string) =>
  new Style({
    image: new Circle({
      radius: 7,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#000', width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -16,
      font: '12px monospace',
      fill: new Fill({ color: '#fff' }),
      stroke: new Stroke({ color: '#000', width: 3 }),
    }),
  });

export default function MarsMap({ manifest, objectives, basePosition, layerState }: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const imageLayers = useRef<Record<string, ImageLayer<ImageStatic>>>({});
  const markers = useRef<VectorSource | null>(null);

  // 1. Mapa + proyección local. Se recrea solo si cambia la región.
  useEffect(() => {
    const projection = marsProjection(manifest);
    const extent = manifestExtent(manifest);

    imageLayers.current = {};
    const rasters = manifest.layers.filter(isImageLayer).map((l) => {
      const layer = new ImageLayer({
        // ponytail: asume que cada imagen cubre exactamente bounds_local_m
        source: new ImageStatic({ url: l.asset_url, imageExtent: extent, projection }),
      });
      imageLayers.current[l.layer_id] = layer;
      return layer;
    });

    markers.current = new VectorSource();
    const bounds = new VectorLayer({
      source: new VectorSource({ features: [new Feature(fromExtent(extent))] }),
      style: boundsStyle,
    });

    const map = new OlMap({
      target: targetRef.current!,
      layers: [...rasters, bounds, new VectorLayer({ source: markers.current })],
      view: new View({ projection, extent, constrainOnlyCenter: true }),
      controls: defaultControls().extend([
        new MousePosition({ coordinateFormat: createStringXY(0), projection }),
      ]),
    });
    map.getView().fit(extent, { padding: [24, 24, 24, 24] });

    return () => map.setTarget(undefined);
  }, [manifest]);

  // 2. Visibilidad y opacidad de capas
  useEffect(() => {
    for (const [id, layer] of Object.entries(imageLayers.current)) {
      const s = layerState[id];
      layer.setVisible(s?.visible ?? false);
      layer.setOpacity(s?.opacity ?? 1);
    }
  }, [layerState, manifest]);

  // 3. Marcadores de base y objetivos
  useEffect(() => {
    const frameId = manifest.frame.frame_id;
    const point = (p: Position, label: string, color: string) => {
      if (p.frame_id !== frameId) {
        console.warn(`Posición en frame ${p.frame_id}, se esperaba ${frameId}; no se dibuja.`);
        return [];
      }
      const f = new Feature(new Point([p.x_m, p.y_m]));
      f.setStyle(pointStyle(label, color));
      return [f];
    };

    markers.current?.clear();
    markers.current?.addFeatures([
      ...(basePosition ? point(basePosition, 'BASE', '#38bdf8') : []),
      ...objectives.flatMap((o) => point(o.position, o.title, '#f97316')),
    ]);
  }, [objectives, basePosition, manifest]);

  return <div ref={targetRef} className="h-full w-full" />;
}