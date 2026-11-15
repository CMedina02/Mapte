import { useEffect, useRef } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon, { fromExtent } from 'ol/geom/Polygon';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import MousePosition from 'ol/control/MousePosition';
import { defaults as defaultControls } from 'ol/control/defaults';
import { createStringXY } from 'ol/coordinate';
import { boundingExtent, buffer, containsCoordinate } from 'ol/extent';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import 'ol/ol.css';
import type { Hazard, Objective, Position, RegionManifest, RouteResult, RouteStatus } from '../../shared/types/contracts';
import { isImageLayer, manifestExtent, marsProjection, type LayerState } from './mapUtils';

interface Props {
  manifest: RegionManifest;
  objectives: Objective[];
  selectedObjectiveIds: string[];
  basePosition: Position | null;
  layerState: Record<string, LayerState>;
  onMapClick?: (p: Position) => void;
  route: RouteResult | null;
  // Puntos a encuadrar al abrir el mapa (p. ej. objetivos o ruta); sin ellos, toda la zona
  focus?: Position[];
}

const boundsStyle = new Style({
  stroke: new Stroke({ color: '#5182d8', width: 1, lineDash: [6, 6] }),
});

// exclusión = rojo (no se cruza); precaución = ámbar punteado. Texto además de color.
const hazardStyle = (kind: Hazard['kind'], label: string) => {
  const color = kind === 'exclusion' ? '252,61,33' : '245,158,11';
  return new Style({
    fill: new Fill({ color: `rgba(${color},0.22)` }),
    stroke: new Stroke({ color: `rgb(${color})`, width: 2, lineDash: kind === 'exclusion' ? undefined : [6, 4] }),
    text: new Text({
      text: kind === 'exclusion' ? `⛔ ${label}` : `⚠ ${label}`,
      font: 'bold 11px monospace',
      fill: new Fill({ color: `rgb(${color})` }),
      stroke: new Stroke({ color: '#000', width: 3 }),
      overflow: true,
    }),
  });
};

// Calidad 'unknown' del DEM: gris, nunca verde ni sin marcar (desconocido no es seguro)
const unknownZoneStyle = new Style({
  fill: new Fill({ color: 'rgba(148,163,184,0.18)' }),
  stroke: new Stroke({ color: '#94a3b8', width: 1.5, lineDash: [2, 6] }),
  text: new Text({
    text: '? Terreno de calidad desconocida',
    font: 'bold 11px monospace',
    fill: new Fill({ color: '#cbd5e1' }),
    stroke: new Stroke({ color: '#000', width: 3 }),
    overflow: true,
  }),
});

const ROUTE_COLOR: Record<RouteStatus, string> = {
  viable: '#22c55e',
  not_viable: '#fc3d21',
  unknown: '#f59e0b',
};

// Regreso: el A* penaliza subir, así que de vuelta (cuesta abajo) puede elegir otro camino.
// Se dibuja más delgado y translúcido para que no parezca una segunda ruta.
const routeStyle = (status: RouteStatus, isReturn = false) =>
  new Style({
    stroke: new Stroke({
      color: (ROUTE_COLOR[status] ?? ROUTE_COLOR.unknown) + (isReturn ? '80' : ''),
      width: isReturn ? 2 : 3,
      lineDash: status === 'viable' ? undefined : [8, 6],
    }),
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

export default function MarsMap({
  manifest,
  objectives,
  selectedObjectiveIds,
  basePosition,
  layerState,
  route,
  onMapClick,
  focus,
}: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const imageLayers = useRef<Record<string, ImageLayer<ImageStatic>>>({});
  const markers = useRef<VectorSource | null>(null);
  const routeSource = useRef<VectorSource | null>(null);
  const clickRef = useRef(onMapClick);
  const focusRef = useRef(focus);

  // Mantiene handler y encuadre actualizados sin recrear el mapa
  useEffect(() => {
    clickRef.current = onMapClick;
    focusRef.current = focus;
  });

  useEffect(() => {
    const projection = marsProjection(manifest);
    const extent = manifestExtent(manifest);

    imageLayers.current = {};
    const rasters = manifest.layers.filter(isImageLayer).map((l) => {
      const layer = new ImageLayer({
        source: new ImageStatic({ url: l.asset_url, imageExtent: extent, projection }),
      });
      imageLayers.current[l.layer_id] = layer;
      return layer;
    });

    markers.current = new VectorSource();
    routeSource.current = new VectorSource();
    const bounds = new VectorLayer({
      source: new VectorSource({ features: [new Feature(fromExtent(extent))] }),
      style: boundsStyle,
    });

    // Zonas de riesgo del manifiesto (mismo frame que el mapa)
    const hazards = new VectorLayer({
      source: new VectorSource({
        features: (manifest.hazards ?? [])
          .filter((hz) => hz.polygon.every((p) => p.frame_id === manifest.frame.frame_id))
          .map((hz) => {
            const ring = hz.polygon.map((p) => [p.x_m, p.y_m]);
            const f = new Feature(new Polygon([[...ring, ring[0]]]));
            f.setStyle(hazardStyle(hz.kind, hz.risk_factor));
            return f;
          }),
      }),
    });

    const unknownZones = new VectorLayer({
      source: new VectorSource({
        features: (manifest.terrain?.quality_zones ?? [])
          .filter((z) => z.quality === 'unknown')
          .map((z) => {
            const e = z.extent_m;
            const f = new Feature(fromExtent([e.x_min_m, e.y_min_m, e.x_max_m, e.y_max_m]));
            f.setStyle(unknownZoneStyle);
            f.set('reason', z.reason);
            return f;
          }),
      }),
    });

    const map = new OlMap({
      target: targetRef.current!,
      layers: [
        ...rasters,
        bounds,
        unknownZones,
        hazards,
        new VectorLayer({ source: routeSource.current }),
        new VectorLayer({ source: markers.current }),
      ],
      view: new View({ projection, extent, constrainOnlyCenter: true }),
      controls: defaultControls().extend([
        new MousePosition({ coordinateFormat: createStringXY(0), projection, placeholder: '' }),
      ]),
    });
    const points = focusRef.current?.map((p) => [p.x_m, p.y_m]) ?? [];
    map.getView().fit(points.length > 0 ? buffer(boundingExtent(points), 400) : extent, {
      padding: [24, 24, 24, 24],
    });

    map.on('click', (e) => {
      if (!containsCoordinate(extent, e.coordinate)) return;
      clickRef.current?.({
        x_m: Math.round(e.coordinate[0]),
        y_m: Math.round(e.coordinate[1]),
        frame_id: manifest.frame.frame_id,
      });
    });

    return () => map.setTarget(undefined);
  }, [manifest]);

  useEffect(() => {
    for (const [id, layer] of Object.entries(imageLayers.current)) {
      const s = layerState[id];
      layer.setVisible(s?.visible ?? false);
      layer.setOpacity(s?.opacity ?? 1);
    }
  }, [layerState, manifest]);

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
      ...(basePosition ? point(basePosition, 'BASE', '#ffffff') : []),
      ...objectives.flatMap((o) =>
        point(o.position, o.title, selectedObjectiveIds.includes(o.objective_id) ? '#22c55e' : '#9aabcb'),
      ),
    ]);
  }, [objectives, selectedObjectiveIds, basePosition, manifest]);

  useEffect(() => {
    routeSource.current?.clear();
    if (!route || route.path.length < 2) return;
    const frameId = manifest.frame.frame_id;
    if (route.path.some((p) => p.frame_id !== frameId)) {
      console.warn(`Ruta en otro frame (se esperaba ${frameId}); no se dibuja.`);
      return;
    }
    const coords = route.path.map((p) => [p.x_m, p.y_m]);
    const cut = route.return_start_index ?? coords.length;
    const parts: [number[][], boolean][] = [[coords.slice(cut), true], [coords.slice(0, cut + 1), false]]; // ida encima
    for (const [line, isReturn] of parts) {
      if (line.length < 2) continue;
      const f = new Feature(new LineString(line));
      f.setStyle(routeStyle(route.status, isReturn));
      routeSource.current?.addFeature(f);
    }
  }, [route, manifest]);
  return <div ref={targetRef} className="h-full w-full cursor-crosshair" />;
}