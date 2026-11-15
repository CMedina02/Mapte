// Vista 3D inclinada del terreno (FE-09). Solo dibuja lo que entrega el backend:
// heightmap .f32, textura de una capa, ruta con z_m, base, objetivos y zonas de riesgo.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Hazard, Objective, Position, RegionManifest, RouteResult, RouteStatus, Terrain } from '../../shared/types/contracts';

// Reutiliza imágenes ya descargadas (textura) al recolocar la cámara para otro destino
THREE.Cache.enabled = true;

// Exageración vertical: solo en terrenos casi planos; con relieve real fuerte, 1×
const exaggerationFor = (terrain: Terrain, spanM: number) =>
  (terrain.elevation_max_m - terrain.elevation_min_m) / spanM > 0.05 ? 1 : 1.5;
const LIFT_M = 6;
const SKY_HORIZON = '#b88a63';
const MARS_TINT = '#f6bf96'; 
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
  lookHeading?: number | null; // rumbo impuesto desde fuera (brújula del dispositivo o ratón); null = libre
  onError: (message: string) => void;
}

type Vec3 = [number, number, number];

// Truco de videojuego para los bordes: fuera de la zona con datos, el terreno continúa reflejado en espejo
// (altura y ortofoto) durante PAD celdas, más oscuro, y la niebla lo cubre. Así no se ve la "losa" flotando
// aunque el astronauta esté en la orilla. No son datos: solo se dibuja, nunca se usa para rutas.
const PAD = 100; // celdas (2 km con el DEM de 20 m)
const mirrorF = (f: number, n: number) => (f < 0 ? -f : f > n ? 2 * n - f : f);
const mirrorI = (i: number, n: number) => Math.min(Math.max(i < 0 ? -i : i > n - 1 ? 2 * (n - 1) - i : i, 0), n - 1);

// El backend publica el DEM completo (2500² a 4 m = 6 M de vértices): demasiado para dibujar en una tableta.
// Para la GEOMETRÍA se promedian bloques k×k (ignorando NaN) hasta ~600 px; las métricas siguen siendo del backend.
const MAX_MESH_PX = 600;
function decimateForMesh(terrain: Terrain, data: Float32Array): { terrain: Terrain; heights: Float32Array } {
  const { width_px: w, height_px: h, grid: g } = terrain;
  const k = Math.ceil(Math.max(w, h) / MAX_MESH_PX);
  if (k <= 1) return { terrain, heights: data };
  const nw = Math.floor(w / k), nh = Math.floor(h / k);
  const out = new Float32Array(nw * nh);
  for (let r = 0; r < nh; r++) {
    for (let c = 0; c < nw; c++) {
      let sum = 0, n = 0;
      for (let dr = 0; dr < k; dr++) {
        const row = (r * k + dr) * w + c * k;
        for (let dc = 0; dc < k; dc++) {
          const v = data[row + dc];
          if (!Number.isNaN(v)) { sum += v; n++; }
        }
      }
      out[r * nw + c] = n ? sum / n : NaN; // bloque sin ningún dato: sigue siendo "sin dato"
    }
  }
  const px = g.pixel_size_x_m * k, py = g.pixel_size_y_m * k;
  return {
    heights: out,
    terrain: {
      ...terrain,
      width_px: nw,
      height_px: nh,
      grid: {
        ...g,
        pixel_size_x_m: px,
        pixel_size_y_m: py,
        // centro de la primera celda gruesa = esquina NO + medio píxel grueso
        origin_center_x_m: g.origin_center_x_m - g.pixel_size_x_m / 2 + px / 2,
        origin_center_y_m: g.origin_center_y_m + g.pixel_size_y_m / 2 - py / 2,
      },
    },
  };
}

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
    const fx = mirrorF((x - g.origin_center_x_m) / g.pixel_size_x_m, w - 1);
    const fy = mirrorF((g.origin_center_y_m - y) / g.pixel_size_y_m, h - 1);
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

// Grano de suelo SIMULADO (no medido): ruido procedural de arena, guijarros y rocas sobre la ortofoto.
// La ortofoto llega a 5 m/px; de cerca daría un borrón liso. Cada escala se apaga con la distancia para no parpadear.
const GRAIN_GLSL = /* glsl */ `
  varying vec3 vGrainPos;
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
  }
  float gFbm(vec2 p) { return gNoise(p) * 0.5 + gNoise(p * 2.03) * 0.3 + gNoise(p * 4.01) * 0.2; }
`;
function addGrain(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGrainPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GRAIN_GLSL}`)
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float dist = length(vGrainPos - cameraPosition);
        vec2 p = vGrainPos.xz;
        float sand = (gFbm(p * 0.5) - 0.5) * 0.25 * (1.0 - smoothstep(150.0, 700.0, dist));             // arena ~2 m
        float pebbles = (gFbm(p * 0.12 + 3.1) - 0.5) * 0.35 * (1.0 - smoothstep(500.0, 2500.0, dist));   // guijarros ~8 m
        float rocks = smoothstep(0.64, 0.78, gFbm(p * 0.035 + 9.7)) * 0.28 * (1.0 - smoothstep(1500.0, 5000.0, dist)); // rocas ~30 m
        diffuseColor.rgb *= 1.0 + sand + pebbles - rocks;
      }`,
    );
}

function TerrainMesh({ manifest, terrain, heights, frame }: { manifest: RegionManifest; terrain: Terrain; heights: Float32Array; frame: Frame }) {
  const invalidate = useThree((s) => s.invalidate);
  const textureUrl = manifest.layers.find((l) => l.layer_id === terrain.texture_layer_id)?.asset_url;

  const texture = useMemo(() => {
    if (!textureUrl) return null;
    const tex = new THREE.TextureLoader().load(textureUrl, () => invalidate());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping; // la franja extendida usa la ortofoto reflejada
    return tex;
  }, [textureUrl, invalidate]);

  // Relieve fino (DEM a 4 m) como normal map: usa las UV originales del heightmap (canal 1)
  const normalUrl = terrain.normal_map_url;
  const normalMap = useMemo(() => {
    if (!normalUrl) return null;
    const tex = new THREE.TextureLoader().load(normalUrl, () => invalidate());
    tex.channel = 1;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    return tex;
  }, [normalUrl, invalidate]);
  useEffect(() => () => { texture?.dispose(); normalMap?.dispose(); }, [texture, normalMap]);

  const geometry = useMemo(() => {
    const { w, h } = frame;
    const W = w + 2 * PAD, H = h + 2 * PAD;
    const px = terrain.grid.pixel_size_x_m, py = terrain.grid.pixel_size_y_m;
    // Mismo centro que el heightmap; PAD celdas extra por lado
    const geo = new THREE.PlaneGeometry((W - 1) * px, (H - 1) * py, W - 1, H - 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    const b = manifest.bounds_local_m;

    // PlaneGeometry recorre filas de norte a sur y columnas de oeste a este, igual que el .f32
    for (let i = 0; i < pos.count; i++) {
      const r = Math.floor(i / W) - PAD, c = (i % W) - PAD; // celda del heightmap (fuera de rango en la franja)
      const v = heights[mirrorI(r, h) * w + mirrorI(c, w)];
      // UV en coordenadas del heightmap: fuera de [0, 1] la textura se refleja (MirroredRepeatWrapping)
      uv.setXY(i, c / (w - 1), 1 - r / (h - 1));
      // Cuánto se aleja de los datos (0 = dentro); la franja se oscurece hacia afuera
      const out = Math.max(-r, r - (h - 1), -c, c - (w - 1), 0);
      const shade = out === 0 ? 1 : 0.88 - 0.3 * Math.min(1, out / PAD);
      if (Number.isNaN(v)) {
        pos.setZ(i, 0); // sin dato: se pinta distinto, no se presenta como terreno válido
        colors.set([0.55, 0.08, 0.08], i * 3);
      } else {
        pos.setZ(i, (v - terrain.elevation_min_m) * frame.exag);
        colors.set([shade, shade, shade], i * 3);
      }
    }
    geo.setAttribute('uv1', uv.clone()); // normal map: siempre en coordenadas del heightmap
    if (!terrain.texture_aligned) {
      // La textura cubre toda la zona del manifiesto: se recorta a la extensión del heightmap
      for (let i = 0; i < pos.count; i++) {
        const x = frame.cx + pos.getX(i);
        const y = frame.cy + pos.getY(i);
        uv.setXY(i, (x - b.min_x) / (b.max_x - b.min_x), (y - b.min_y) / (b.max_y - b.min_y));
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, [heights, frame, terrain, manifest.bounds_local_m]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={texture}
        normalMap={normalMap}
        normalScale={[frame.exag, frame.exag]}
        color={texture ? MARS_TINT : '#b5653a'} // la ortofoto es en gris: se tiñe en tono marciano (color aproximado)
        vertexColors
        roughness={1}
        onBeforeCompile={addGrain}
        customProgramCacheKey={() => 'terrain-grain'}
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
// Cielo marciano diurno: domo con shader que sigue a la cámara. Cenit pardo, horizonte ocre con bruma de polvo,
// sol pequeño (~0.35°, Marte está más lejos) con halo azulado: el polvo fino dispersa el azul cerca del sol.
const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith, mid, horizon, sunDir;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float h = max(d.y, 0.0);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
    col = mix(col, zenith, smoothstep(0.22, 0.95, h));
    float s = max(dot(d, sunDir), 0.0);
    col += vec3(0.85, 0.62, 0.42) * pow(s, 6.0) * 0.18;   // resplandor amplio del polvo
    col += vec3(0.55, 0.68, 0.95) * pow(s, 60.0) * 0.35;  // halo azulado
    col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99996, 0.99999, s) * 2.0; // disco solar
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;         // tramado contra el bandeado
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

// Sol al noroeste, ~30° sobre el horizonte: marca el relieve sin dejar las laderas en sombra
const SUN_DIR = new THREE.Vector3(-1, 0.67, -0.6).normalize();

function SkyDome({ radius, sunDir }: { radius: number; sunDir: THREE.Vector3 }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          zenith: { value: new THREE.Color('#2a1a12') },
          mid: { value: new THREE.Color('#6b4530') },
          horizon: { value: new THREE.Color(SKY_HORIZON) }, // igual a la niebla: el terreno lejano se funde
          sunDir: { value: sunDir.clone().normalize() },
        },
      }),
    [sunDir],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[radius, 32, 16]} />
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
const UP = new THREE.Vector3(0, 1, 0);

// Gira la órbita alrededor del astronauta hasta mirar hacia `heading`, con suavizado (filtra el temblor del sensor).
// Mantiene la inclinación y la distancia que eligió el usuario.
function HeadingDriver({ heading }: { heading: number | null }) {
  const controls = useThree((s) => s.controls) as unknown as { getAzimuthalAngle(): number; target: THREE.Vector3; update(): void } | null;
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (heading !== null) invalidate();
  }, [heading, invalidate]);
  useFrame((_, dt) => {
    if (heading === null || !controls) return;
    const diff = (-heading * Math.PI) / 180 - controls.getAzimuthalAngle(); // inverso de headingFromAzimuth
    const d = Math.atan2(Math.sin(diff), Math.cos(diff)); // giro más corto
    if (Math.abs(d) < 0.002) return;
    const step = Math.abs(d) < 0.01 ? d : d * (1 - Math.exp(-dt * 10));
    const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, step);
    camera.position.copy(controls.target).add(offset);
    controls.update(); // emite 'change': actualiza el compás y mantiene la cámara sobre el terreno
    invalidate();
  });
  return null;
}

function Terrain3D({ manifest, terrain, route, base, objectives, targetId, here, destination, onHeading, lookHeading = null, onError }: Props) {
  const [dem, setDem] = useState<{ terrain: Terrain; heights: Float32Array } | null>(null);
  // Último bloque terrain recibido: el efecto de carga lo lee sin depender de su identidad
  // (la sincronización en vivo entrega un objeto nuevo aunque el heightmap no cambie)
  const terrainRef = useRef(terrain);
  useEffect(() => {
    terrainRef.current = terrain;
  });
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
        if (alive) setDem(decimateForMesh(terrainRef.current, data));
      })
      .catch((e) => {
        if (alive) onErrorRef.current(`No se pudo cargar el terreno 3D (${e instanceof Error ? e.message : e}). Mostrando mapa 2D.`);
      });
    return () => {
      alive = false;
    };
  }, [terrain.heightmap_url, terrain.header_bytes, terrain.width_px, terrain.height_px]);

  const heights = dem?.heights ?? null;
  const meshTerrain = dem?.terrain ?? terrain; // rejilla reducida si el DEM era muy grande
  const frame = useMemo(() => (dem ? makeFrame(dem.terrain, dem.heights) : null), [dem]);
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
  // Visibilidad de 2–4.5 km según el tramo: se ve la ruta, pero el borde del modelo queda en la bruma
  const fogFar = Math.min(Math.max(view.back * 6, 2000), 4500);

  return (
    <div className="relative h-full w-full">
      {/* key: al cambiar de destino se recoloca la cámara detrás del astronauta */}
      <Canvas
        key={`${view.camera.join(',')}`}
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 50, near: 1, far: span * 10, position: view.camera }}
      >
        {/* Truco de videojuego: la niebla del color del horizonte esconde el borde de la zona de 10 km */}
        <fog attach="fog" args={[SKY_HORIZON, fogFar * 0.3, fogFar]} />
        <hemisphereLight args={['#dfe8ff', '#3a1d10', 1.2]} />
        <directionalLight position={SUN_DIR.clone().multiplyScalar(span).toArray()} intensity={1.6} />
        <SkyDome radius={span * 4} sunDir={SUN_DIR} />

        <TerrainMesh manifest={manifest} terrain={meshTerrain} heights={heights} frame={frame} />

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
          maxDistance={fogFar * 0.55} // nunca tan lejos como para ver la losa de terreno flotando
          onChange={(e) => {
            if (!e) return;
            onHeadingRef.current(Math.round(headingFromAzimuth(e.target.getAzimuthalAngle())));
            // La órbita gira alrededor del astronauta: en un valle podría meterse dentro de una loma
            const cam = e.target.object.position;
            const ground = frame.heightAt(cam.x + frame.cx, frame.cy - cam.z);
            const minY = ground === null ? 0 : (ground - terrain.elevation_min_m) * frame.exag + 15;
            if (cam.y < minY) cam.y = minY;
          }}
        />
        <HeadingDriver heading={lookHeading} />
      </Canvas>

    </div>
  );
}

export default memo(Terrain3D);
