// Vista 3D inclinada del terreno (FE-09). Solo dibuja lo que entrega el backend:
// heightmap .f32, textura de una capa, ruta con z_m, base, objetivos y zonas de riesgo.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Hazard, Objective, Position, RegionManifest, RouteResult, RouteStatus, Terrain } from '../../shared/types/contracts';

// Reutiliza imágenes ya descargadas (textura) al recolocar la cámara para otro destino
THREE.Cache.enabled = true;

// Exageración vertical (declarada en pantalla): solo en terrenos casi planos; con relieve real fuerte, 1×
const exaggerationFor = (terrain: Terrain, spanM: number) =>
  (terrain.elevation_max_m - terrain.elevation_min_m) / spanM > 0.05 ? 1 : 1.5;
const LIFT_M = 6; // separa líneas y marcadores del suelo para que no se hundan
const SPACE = '#050a1a';
const MARS_TINT = '#f6bf96'; // tinte sobre la ortofoto en gris; no es el color real medido
const ROUTE_COLOR: Record<RouteStatus, string> = { viable: '#22c55e', not_viable: '#fc3d21', unknown: '#f59e0b' };

interface Props {
  manifest: RegionManifest;
  terrain: Terrain;
  route: RouteResult | null;
  base: Position;
  objectives: Objective[];
  targetId: string | null;
  here: Position; // posición actual del astronauta
  destination: Position | null;
  onHeading: (deg: number) => void; // hacia dónde mira (0° = norte), según la cámara
  onError: (message: string) => void;
}

type Vec3 = [number, number, number];

// Marco de la escena: X = este, Y = arriba, Z = sur (el norte queda hacia el fondo)
function makeFrame(terrain: Terrain, heights: Float32Array) {
  const g = terrain.grid;
  const w = terrain.width_px, h = terrain.height_px;
  const spanX = (w - 1) * g.pixel_size_x_m;
  const spanY = (h - 1) * g.pixel_size_y_m;
  const cx = g.origin_center_x_m + spanX / 2;
  const cy = g.origin_center_y_m - spanY / 2; // el origen es la celda noroeste
  const exag = exaggerationFor(terrain, Math.max(spanX, spanY));

  // Elevación por interpolación bilineal; null fuera del heightmap o sin dato (NaN)
  const heightAt = (x: number, y: number): number | null => {
    const fx = (x - g.origin_center_x_m) / g.pixel_size_x_m;
    const fy = (g.origin_center_y_m - y) / g.pixel_size_y_m;
    if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return null;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const tx = fx - x0, ty = fy - y0;
    const v = (r: number, c: number) => heights[r * w + c];
    const z =
      v(y0, x0) * (1 - tx) * (1 - ty) + v(y0, x1) * tx * (1 - ty) + v(y1, x0) * (1 - tx) * ty + v(y1, x1) * tx * ty;
    return Number.isNaN(z) ? null : z;
  };

  const toScene = (x: number, y: number, z: number): Vec3 => [
    x - cx,
    (z - terrain.elevation_min_m) * exag,
    -(y - cy),
  ];

  // Punto del contrato a la escena: usa z_m del backend; si falta, la altura del heightmap (solo para dibujar)
  const placePoint = (p: Position): Vec3 => {
    const z = p.z_m ?? heightAt(p.x_m, p.y_m) ?? terrain.elevation_min_m;
    const [sx, sy, sz] = toScene(p.x_m, p.y_m, z);
    return [sx, sy + LIFT_M, sz];
  };

  return { w, h, spanX, spanY, cx, cy, exag, heightAt, toScene, placePoint };
}

type Frame = ReturnType<typeof makeFrame>;

function TerrainMesh({ manifest, terrain, heights, frame }: { manifest: RegionManifest; terrain: Terrain; heights: Float32Array; frame: Frame }) {
  const invalidate = useThree((s) => s.invalidate);
  const textureUrl = manifest.layers.find((l) => l.layer_id === terrain.texture_layer_id)?.asset_url;

  const texture = useMemo(() => {
    if (!textureUrl) return null;
    const tex = new THREE.TextureLoader().load(textureUrl, () => invalidate());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [textureUrl, invalidate]);

  const { geometry, hasNoData } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(frame.spanX, frame.spanY, frame.w - 1, frame.h - 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3).fill(1);
    const b = manifest.bounds_local_m;
    let noData = false;

    // PlaneGeometry recorre filas de norte a sur y columnas de oeste a este, igual que el .f32
    for (let i = 0; i < pos.count; i++) {
      const v = heights[i];
      if (Number.isNaN(v)) {
        noData = true;
        pos.setZ(i, 0); // sin dato: se pinta distinto, no se presenta como terreno válido
        colors.set([0.55, 0.08, 0.08], i * 3);
      } else {
        pos.setZ(i, (v - terrain.elevation_min_m) * frame.exag);
      }
      if (!terrain.texture_aligned) {
        // La textura cubre toda la zona del manifiesto: se recorta a la extensión del heightmap
        const x = frame.cx + pos.getX(i);
        const y = frame.cy + pos.getY(i);
        uv.setXY(i, (x - b.min_x) / (b.max_x - b.min_x), (y - b.min_y) / (b.max_y - b.min_y));
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return { geometry: geo, hasNoData: noData };
  }, [heights, frame, terrain, manifest.bounds_local_m]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={texture}
        color={texture ? MARS_TINT : '#b5653a'} // la ortofoto es en gris: se tiñe en tono marciano (color aproximado)
        vertexColors={hasNoData}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

function Marker({ position, label, color, emphasis = false }: { position: Vec3; label: string; color: string; emphasis?: boolean }) {
  const [x, y, z] = position;
  const height = emphasis ? 70 : 45;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[2.5, 2.5, height, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[emphasis ? 14 : 10, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={[0, height + 22, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <span
          className="block rounded px-2 py-0.5 text-xs font-bold whitespace-nowrap text-white"
          style={{ background: 'rgba(5,10,26,.85)', border: `1px solid ${color}` }}
        >
          {label}
        </span>
      </Html>
    </group>
  );
}

function HazardOutline({ hazard, frame }: { hazard: Hazard; frame: Frame }) {
  const points = [...hazard.polygon, hazard.polygon[0]].map((p) => frame.placePoint({ ...p, z_m: undefined }));
  const exclusion = hazard.kind === 'exclusion';
  const color = exclusion ? '#fc3d21' : '#f59e0b';
  const c = points.slice(0, -1).reduce<Vec3>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  const n = points.length - 1;
  return (
    <>
      <Line points={points} color={color} lineWidth={2.5} dashed={!exclusion} dashSize={30} gapSize={18} />
      <Html position={[c[0] / n, c[1] / n + 25, c[2] / n]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <span className="text-[11px] font-bold whitespace-nowrap" style={{ color, textShadow: '0 0 4px #000, 0 0 2px #000' }}>
          {exclusion ? '⛔' : '⚠'} {hazard.risk_factor}
        </span>
      </Html>
    </>
  );
}

// Rejilla tipo HUD sobre el relieve (malla reducida a 64 × 64 para no pesar en tabletas)
function GridOverlay({ frame }: { frame: Frame }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(frame.spanX, frame.spanY, 63, 63);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = frame.heightAt(frame.cx + pos.getX(i), frame.cy + pos.getY(i));
      pos.setZ(i, z === null ? 0 : frame.toScene(0, 0, z)[1] + 1.5);
    }
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [frame]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#82a5e5" wireframe transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

// Astronauta: anillo en el suelo + punto GPS. La cámara mira desde detrás de él, así que
// el cono de visión siempre apunta "hacia adelante" en pantalla.
function AstronautMarker({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[16, 22, 48]} />
        <meshBasicMaterial color="#5182d8" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Html center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
        <svg width="56" height="64" viewBox="0 0 56 64" aria-label="Tu posición">
          <defs>
            <linearGradient id="gps-beam" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#82a5e5" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#82a5e5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M28 40 L10 4 Q28 -4 46 4 Z" fill="url(#gps-beam)" />
          <circle cx="28" cy="40" r="13" fill="#2c63c4" fillOpacity="0.35" className="motion-safe:animate-ping" style={{ transformOrigin: '28px 40px' }} />
          <circle cx="28" cy="40" r="8" fill="#2c63c4" stroke="#ffffff" strokeWidth="3" />
          <text x="28" y="62" textAnchor="middle" className="fill-white text-[10px] font-bold">TÚ</text>
        </svg>
      </Html>
    </group>
  );
}

// Rumbo de vista a partir del ángulo azimutal de la cámara (OrbitControls): 0° = norte (−Z), 90° = este (+X)
const headingFromAzimuth = (az: number) => ((((-az * 180) / Math.PI) % 360) + 360) % 360;

function Terrain3D({ manifest, terrain, route, base, objectives, targetId, here, destination, onHeading, onError }: Props) {
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const onErrorRef = useRef(onError);
  const onHeadingRef = useRef(onHeading);
  useEffect(() => {
    onErrorRef.current = onError;
    onHeadingRef.current = onHeading;
  });

  useEffect(() => {
    let alive = true;
    fetch(terrain.heightmap_url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        // Float32 little-endian sin header: coincide con el orden de bytes de los navegadores actuales
        const data = new Float32Array(buf, terrain.header_bytes);
        if (data.length !== terrain.width_px * terrain.height_px) {
          throw new Error(`tamaño inesperado (${data.length} valores)`);
        }
        if (alive) setHeights(data);
      })
      .catch((e) => {
        if (alive) onErrorRef.current(`No se pudo cargar el terreno 3D (${e instanceof Error ? e.message : e}). Mostrando mapa 2D.`);
      });
    return () => {
      alive = false;
    };
  }, [terrain.heightmap_url, terrain.header_bytes, terrain.width_px, terrain.height_px]);

  const frame = useMemo(() => (heights ? makeFrame(terrain, heights) : null), [terrain, heights]);
  const routePoints = useMemo(
    () => (frame && route && route.path.length > 1 ? route.path.map(frame.placePoint) : null),
    [frame, route],
  );

  // Cámara de tercera persona: detrás del astronauta, mirando hacia el destino (o al norte)
  const view = useMemo(() => {
    if (!frame) return null;
    const me = frame.placePoint(here);
    let dx = 0;
    let dz = -1;
    let legM = 800;
    if (destination) {
      const d = frame.placePoint(destination);
      const len = Math.hypot(d[0] - me[0], d[2] - me[2]);
      if (len > 1) [dx, dz, legM] = [(d[0] - me[0]) / len, (d[2] - me[2]) / len, len];
    }
    const span = Math.max(frame.spanX, frame.spanY);
    // Detrás del astronauta, a una distancia proporcional al tramo (más lejos en pantallas verticales)
    const back = Math.min(Math.max(legM * 0.8, 450), span * 0.35) * (window.innerWidth < window.innerHeight ? 1.5 : 1);
    return {
      me,
      target: [me[0], me[1], me[2]] as Vec3,
      camera: [me[0] - dx * back, me[1] + back * 0.6, me[2] - dz * back] as Vec3,
      heading: ((((Math.atan2(dx, -dz) * 180) / Math.PI) % 360) + 360) % 360,
      span,
      back,
    };
  }, [frame, here, destination]);

  // Rumbo inicial (antes de que el usuario gire la cámara)
  useEffect(() => {
    if (view) onHeadingRef.current(Math.round(view.heading));
  }, [view]);

  if (!heights || !frame || !view) {
    return <p className="flex h-full items-center justify-center text-sm text-space-300">Cargando terreno 3D…</p>;
  }

  const target = objectives.find((o) => o.objective_id === targetId);
  const span = view.span;

  return (
    <div className="relative h-full w-full">
      {/* key: al cambiar de destino se recoloca la cámara detrás del astronauta */}
      <Canvas
        key={`${view.camera.join(',')}`}
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 50, near: 1, far: span * 10, position: view.camera }}
      >
        <color attach="background" args={[SPACE]} />
        <fog attach="fog" args={[SPACE, view.back * 3, view.back * 9]} />
        <hemisphereLight args={['#dfe8ff', '#3a1d10', 1.2]} />
        <directionalLight position={[-span, span * 0.8, -span * 0.6]} intensity={1.6} />

        <TerrainMesh manifest={manifest} terrain={terrain} heights={heights} frame={frame} />
        <GridOverlay frame={frame} />

        {manifest.hazards?.map((hz) => <HazardOutline key={hz.hazard_id} hazard={hz} frame={frame} />)}

        {routePoints && (
          <Line
            points={routePoints}
            color={ROUTE_COLOR[route!.status] ?? ROUTE_COLOR.unknown}
            lineWidth={4}
            dashed
            dashSize={18}
            gapSize={12}
          />
        )}

        <Marker position={frame.placePoint(base)} label="BASE" color="#ffffff" />
        {objectives.map((o) => (
          <Marker
            key={o.objective_id}
            position={frame.placePoint(o.position)}
            label={o.title}
            color={o.objective_id === target?.objective_id ? '#22c55e' : '#9aabcb'}
            emphasis={o.objective_id === target?.objective_id}
          />
        ))}
        <AstronautMarker position={view.me} />

        <OrbitControls
          makeDefault
          target={view.target}
          enableDamping={false}
          maxPolarAngle={Math.PI / 2.15}
          minDistance={120}
          maxDistance={span * 2.5}
          onChange={(e) => {
            const az = e?.target.getAzimuthalAngle();
            if (az !== undefined) onHeadingRef.current(Math.round(headingFromAzimuth(az)));
          }}
        />
      </Canvas>

      <p className="pointer-events-none absolute right-2 bottom-2 hidden max-w-[45%] rounded bg-space-950/80 px-2 py-1 text-right text-[11px] text-space-300 sm:block">
        3D · {frame.exag === 1 ? 'escala vertical real' : `exageración vertical ×${frame.exag}`} · ortofoto en gris con tinte marciano · arrastra para mirar alrededor
      </p>
    </div>
  );
}

export default memo(Terrain3D);
