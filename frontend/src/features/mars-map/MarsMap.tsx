import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Overlay from 'ol/Overlay';
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
import { isImageLayer, LEG_COLORS, manifestExtent, marsProjection, type LayerState } from './mapUtils';

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
  // Posición actual del astronauta: se dibuja siempre que se conozca, haya ruta o no
  here?: Position | null;
  // Base nueva elegida con una misión ya planificada: círculo punteado hasta recalcular
  pendingBase?: Position | null;
  // Tramos de una multirruta (A→B, B→C, C→A): cada uno con su color. Si se dan, sustituyen a `route`.
  legs?: { path: Position[]; status: RouteStatus }[];
  // Caminos que no se pueden recorrer con los parámetros actuales: se dibujan en rojo como referencia
  failedPaths?: Position[][];
  // Letra de cada parada ('base' u objective_id) para identificar los tramos
  stopLetters?: Record<string, string>;
  // Globo de información anclado a un punto del mapa
  pin?: { position: Position; content: ReactNode } | null;
}

const FAILED_COLOR = '#d93025';
const failedStyle = new Style({ stroke: new Stroke({ color: FAILED_COLOR, width: 3, lineDash: [10, 6] }) });
// Un tramo no viable se dibuja en rojo, sea cual sea su color de tramo
const legStyle = (color: string, status: RouteStatus) =>
  new Style({
    stroke: new Stroke({
      color: status === 'not_viable' ? FAILED_COLOR : color,
      width: 3,
      lineDash: status === 'viable' ? undefined : status === 'not_viable' ? [2, 6] : [8, 6],
    }),
  });
// Etiquetas del mapa: Google Sans, texto claro con halo oscuro (legible sobre la ortofoto)
const LABEL_FONT = "500 12px 'Google Sans Flex', 'Google Sans', Roboto, sans-serif";
const HALO = new Stroke({ color: 'rgba(0,0,0,0.75)', width: 3 });

const pendingBaseStyle = new Style({
  image: new Circle({ radius: 10, fill: new Fill({ color: 'rgba(255,255,255,0.15)' }), stroke: new Stroke({ color: '#fff', width: 2, lineDash: [4, 3] }) }),
  text: new Text({
    text: 'Nueva base',
    offsetY: -18,
    font: LABEL_FONT,
    fill: new Fill({ color: '#fff' }),
    stroke: HALO,
  }),
});
const hereStyle = new Style({
  zIndex: 10, // siempre encima de base y objetivos (OL pinta en orden de creación)
  image: new Circle({ radius: 9, fill: new Fill({ color: '#1a73e8' }), stroke: new Stroke({ color: '#fff', width: 3 }) }),
  text: new Text({
    text: 'Tú',
    offsetY: 20, // debajo del punto: arriba van las etiquetas de base y objetivos
    font: LABEL_FONT,
    fill: new Fill({ color: '#fff' }),
    stroke: HALO,
  }),
});

const boundsStyle = new Style({
  stroke: new Stroke({ color: 'rgba(255,255,255,0.55)', width: 1, lineDash: [6, 6] }),
});

// exclusión = rojo (no se cruza); precaución = ámbar punteado. Texto además de color.
const hazardStyle = (kind: Hazard['kind'], label: string) => {
  const color = kind === 'exclusion' ? '217,48,37' : '249,171,0';
  return new Style({
    fill: new Fill({ color: `rgba(${color},0.22)` }),
    stroke: new Stroke({ color: `rgb(${color})`, width: 2, lineDash: kind === 'exclusion' ? undefined : [6, 4] }),
    text: new Text({
      text: label,
      font: LABEL_FONT,
      fill: new Fill({ color: '#fff' }),
      stroke: new Stroke({ color: `rgba(${color},0.95)`, width: 4 }),
      overflow: true,
    }),
  });
};

// Calidad 'unknown' del DEM: gris, nunca verde ni sin marcar (desconocido no es seguro)
const unknownZoneStyle = new Style({
  fill: new Fill({ color: 'rgba(148,163,184,0.18)' }),
  stroke: new Stroke({ color: '#94a3b8', width: 1.5, lineDash: [2, 6] }),
  text: new Text({
    text: 'Terreno sin datos',
    font: LABEL_FONT,
    fill: new Fill({ color: '#fff' }),
    stroke: HALO,
    overflow: true,
  }),
});

const ROUTE_COLOR: Record<RouteStatus, string> = {
  viable: '#1e8e3e',
  not_viable: '#d93025',
  unknown: '#f9ab00',
};

const routeStyle = (status: RouteStatus) =>
  new Style({
    stroke: new Stroke({
      color: ROUTE_COLOR[status] ?? ROUTE_COLOR.unknown,
      width: 3,
      lineDash: status === 'viable' ? undefined : [8, 6],
    }),
  });

const pointStyle = (label: string, color: string) =>
  new Style({
    image: new Circle({
      radius: 7,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      text: label,
      offsetY: -16,
      font: LABEL_FONT,
      fill: new Fill({ color: '#fff' }),
      stroke: HALO,
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
  here,
  pendingBase,
  legs,
  failedPaths,
  stopLetters,
  pin,
}: Props) {
  const [pinEl] = useState(() => document.createElement('div'));
  const pinOverlay = useRef<Overlay | null>(null);
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
    // Encuadre inicial cuando el contenedor ya mide algo: si el mapa nace oculto (0×0), se espera al primer tamaño real
    const fitInitial = () => {
      const size = map.getSize();
      if (!size || !size[0] || !size[1]) return;
      map.un('change:size', fitInitial);
      const points = focusRef.current?.map((p) => [p.x_m, p.y_m]) ?? [];
      map.getView().fit(points.length > 0 ? buffer(boundingExtent(points), 400) : extent, {
        padding: [24, 24, 24, 24],
      });
    };
    map.on('change:size', fitInitial);
    fitInitial();

    pinOverlay.current = new Overlay({ element: pinEl, positioning: 'bottom-center', offset: [0, -14], stopEvent: true });
    map.addOverlay(pinOverlay.current);

    map.on('click', (e) => {
      if (!containsCoordinate(extent, e.coordinate)) return;
      clickRef.current?.({
        x_m: Math.round(e.coordinate[0]),
        y_m: Math.round(e.coordinate[1]),
        frame_id: manifest.frame.frame_id,
      });
    });

    return () => map.setTarget(undefined);
  }, [manifest, pinEl]);

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

    const lettered = (id: string, label: string) => (stopLetters?.[id] ? `${stopLetters[id]} · ${label}` : label);
    const me = here && here.frame_id === frameId ? [new Feature(new Point([here.x_m, here.y_m]))] : [];
    me.forEach((f) => f.setStyle(hereStyle));
    const next = pendingBase && pendingBase.frame_id === frameId ? [new Feature(new Point([pendingBase.x_m, pendingBase.y_m]))] : [];
    next.forEach((f) => f.setStyle(pendingBaseStyle));

    markers.current?.clear();
    markers.current?.addFeatures([
      ...(basePosition ? point(basePosition, lettered('base', 'Base'), '#ffffff') : []),
      ...objectives.flatMap((o) =>
        point(o.position, lettered(o.objective_id, o.title.split(' — ')[0]), selectedObjectiveIds.includes(o.objective_id) ? '#1a73e8' : '#9aa0a6'),
      ),
      ...me,
      ...next,
    ]);
  }, [objectives, selectedObjectiveIds, basePosition, manifest, here, pendingBase, stopLetters]);

  useEffect(() => {
    pinOverlay.current?.setPosition(pin ? [pin.position.x_m, pin.position.y_m] : undefined);
  }, [pin]);

  useEffect(() => {
    routeSource.current?.clear();
    for (const path of failedPaths ?? []) {
      if (path.length < 2) continue;
      const f = new Feature(new LineString(path.map((p) => [p.x_m, p.y_m])));
      f.setStyle(failedStyle);
      routeSource.current?.addFeature(f);
    }
    if (!route || route.path.length < 2) return;
    const frameId = manifest.frame.frame_id;
    if (route.path.some((p) => p.frame_id !== frameId)) {
      console.warn(`Ruta en otro frame (se esperaba ${frameId}); no se dibuja.`);
      return;
    }
    if (legs?.length) {
      legs.forEach((leg, i) => {
        if (leg.path.length < 2) return;
        const f = new Feature(new LineString(leg.path.map((p) => [p.x_m, p.y_m])));
        f.setStyle(legStyle(LEG_COLORS[i % LEG_COLORS.length], leg.status));
        routeSource.current?.addFeature(f);
      });
      return;
    }
    const f = new Feature(new LineString(route.path.map((p) => [p.x_m, p.y_m])));
    f.setStyle(routeStyle(route.status));
    routeSource.current?.addFeature(f);
  }, [route, legs, failedPaths, manifest]);
  return (
    <>
      <div ref={targetRef} className="h-full w-full cursor-crosshair" />
      {pin && createPortal(pin.content, pinEl)}
    </>
  );
}