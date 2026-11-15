"""Genera la versión ligera del terreno real del backend para el visor 3D/2D.

El backend publica el DEM a 4 m (2500 x 2500, 25 MB) y la ortofoto a 2 m (5000 x 5000, 15 MB):
demasiado para una tableta. Este script produce:
  - height_20m.f32: promedio 5 x 5 -> 500 x 500 (1 MB), Float32 LE, filas norte -> sur, NaN = sin dato
  - ortho_2048.jpg: ortofoto en gris reducida a 2048 px
  - src/shared/api/mocks/realTerrain.json: metadatos del bloque terrain para el mock

Uso (desde frontend/, con numpy y Pillow):
  python scripts/import_backend_terrain.py [carpeta_derived]
Por defecto lee ../backend/data/regions/mc23-gale-mount-sharp/derived/
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # la ortofoto (25 MP) es de confianza: viene del repo

FACTOR = 5  # 4 m -> 20 m
TEXTURE_PX = 2048
OUT_DIR = Path('public/assets/mc23-real')
META_OUT = Path('src/shared/api/mocks/realTerrain.json')

src = Path(sys.argv[1] if len(sys.argv) > 1 else '../backend/data/regions/mc23-gale-mount-sharp/derived')
meta = json.loads((src / 'terrain.json').read_text(encoding='utf-8'))
tm = meta['terrain_manifest']
w, h = tm['width_px'], tm['height_px']

# Verifica contra las sumas publicadas por el backend
sums = dict(line.split()[::-1] for line in (src / 'SHA256SUMS').read_text().splitlines() if line.strip()) if (src / 'SHA256SUMS').exists() else {}
for name in ('heightmap_4m.f32', 'ortho_2m.png'):
    expected = sums.get(name) or sums.get('*' + name)
    if expected and hashlib.sha256((src / name).read_bytes()).hexdigest() != expected:
        sys.exit(f'Checksum distinto en {name}: el archivo no es el publicado por el backend.')

# --- Heightmap: promedio por bloques ignorando NaN (como el 'average' del backend) ---
z = np.fromfile(src / 'heightmap_4m.f32', dtype='<f4')
assert z.size == w * h, f'tamaño inesperado: {z.size} valores'
z = z.reshape(h, w)
assert h % FACTOR == 0 and w % FACTOR == 0
blocks = z.reshape(h // FACTOR, FACTOR, w // FACTOR, FACTOR)
with np.errstate(invalid='ignore'):
    small = np.nanmean(blocks, axis=(1, 3)).astype('<f4')  # bloque todo NaN -> NaN (sin dato)

OUT_DIR.mkdir(parents=True, exist_ok=True)
small.tofile(OUT_DIR / 'height_20m.f32')

px = tm['grid']['pixel_size_x_m'] * FACTOR
py = tm['grid']['pixel_size_y_m'] * FACTOR
# centro de la primera celda gruesa = esquina del área + medio píxel grueso
x0 = tm['grid']['origin_center_x_m'] - tm['grid']['pixel_size_x_m'] / 2 + px / 2
y0 = tm['grid']['origin_center_y_m'] + tm['grid']['pixel_size_y_m'] / 2 - py / 2

# --- Textura: gris, 2048 px, JPEG (el 0 de la ortofoto = sin cobertura HiRISE, se conserva) ---
ortho = Image.open(src / 'ortho_2m.png').convert('L')
ortho.resize((TEXTURE_PX, TEXTURE_PX), Image.Resampling.BOX).save(OUT_DIR / 'ortho_2048.jpg', quality=82)

out = {
    'source_terrain_version': tm['terrain_version'],
    'frame_id': tm['frame_id'],
    'vertical_datum': tm['vertical_datum'],
    'evidence_ids': tm['evidence_ids'],
    'heightmap_url': '/assets/mc23-real/height_20m.f32',
    'texture_url': '/assets/mc23-real/ortho_2048.jpg',
    'width_px': int(small.shape[1]),
    'height_px': int(small.shape[0]),
    'elevation_min_m': float(np.nanmin(small)),
    'elevation_max_m': float(np.nanmax(small)),
    'nodata_cells': int(np.isnan(small).sum()),
    'grid': {'origin_center_x_m': x0, 'origin_center_y_m': y0, 'pixel_size_x_m': px, 'pixel_size_y_m': py},
    'sector': meta['sector'],
    'sources': meta['sources'],
    'limitations': meta['limitations'],
}
META_OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f"{small.shape[1]}x{small.shape[0]} @ {px} m, z {out['elevation_min_m']:.1f}..{out['elevation_max_m']:.1f} m, "
      f"NaN {out['nodata_cells']}; textura {TEXTURE_PX}px")
