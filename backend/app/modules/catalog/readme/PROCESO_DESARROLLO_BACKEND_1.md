# Proceso de Desarrollo — Desarrollador 1 (Backend 1: `app/modules/catalog`)

> **Módulo:** `app/modules/catalog/` y `tests/catalog/`  
> **Región piloto activa:** `MC-09` (Tharsis, Marte)  
> **Objetivo:** guiar paso a paso el desarrollo de Backend 1 integrando la base existente en `backend/`, el requerimiento de terreno 3D del Frontend (`.f32` + `z_m`) y el contrato de 7 puntos acordado con Backend 2 (`app/modules/missions`).

---

## 1. Reglas de trabajo y límites de alcance

Antes de escribir código o modificar dependencias, respeta la división preestablecida en [`backend/README.md`](../../README.md) y [`README_BACKEND_1.md`](./README_BACKEND_1.md):

- **Tu zona de trabajo exclusiva:** `app/modules/catalog/` y `tests/catalog/`.
- **Archivos que NO debes modificar por tu cuenta:** `app/main.py`, `app/core/`, `pyproject.toml` y `constraints.txt` (cualquier cambio se coordina con Backend 2).
- **Comunicación entre módulos:** Backend 2 (`app/modules/missions/`) consulta datos de terreno y catálogo mediante interfaces Python en memoria dentro del mismo proceso, **nunca** por HTTP.
- **Rutas HTTP:** el `router` del módulo se montará en `app/main.py` bajo `/api/v1`; por ello tus endpoints internos se definen sin repetir `/api/v1` (por ejemplo `/regions`, `/assets/{region_id}/...`).
- **Errores:** toda respuesta de error HTTP debe pasar por `error_response(...)` y los manejadores de [`app/core/errors.py`](../../core/errors.py).

---

## 2. Resumen del contrato vigente (Frontend + Backend 2)

### 2.1 Lo que espera el Frontend

1. **Bloque `terrain` dentro de `RegionManifest` (`GET /api/v1/regions/{region_id}/manifest`):**
   - `heightmap_url`: ruta servida por el proxy del frontend, p. ej. `"/api/v1/assets/MC-09/height.f32"` (adaptando el ejemplo `demo-jezero` a `MC-09` bajo `/api/v1/assets/`).
   - `width_px`, `height_px`: dimensiones exactas del raster exportado.
   - `elevation_min_m`, `elevation_max_m`: mínimo y máximo de elevación válidos en metros (excluyendo `NaN`).
   - `texture_layer_id`: identificador de la capa visual alineada (p. ej. `"imagery"`).
   - `evidence_ids`: identificadores de evidencia científica del DEM.
2. **Archivo binario `.f32`:** arreglo plano `Float32` little-endian, sin cabecera, orden `row-major`, con `NaN` para datos faltantes (`new Float32Array(await res.arrayBuffer())`).
3. **`z_m` opcional en `Position`:** las rutas devueltas por el backend incluyen `z_m` ya muestreado para que el frontend no recalcule alturas.

### 2.2 Los 7 puntos acordados con Backend 2

Ya quedaron formalizados en Python en [`app/modules/catalog/domain/terrain_contract.py`](./domain/terrain_contract.py) y [`app/modules/catalog/api/schemas.py`](./api/schemas.py):

| Punto | Qué regula | Implementación en el contrato Python |
|---|---|---|
| 1. Sector de Tharsis | `region_id`, `sector_id`, extensión en metros y `frame_id` | `RegionSectorSpec`, `LocalExtentM` |
| 2. Cuadrícula | `width_px`, `height_px`, centro de `(0,0)`, tamaño de píxel, orden `north_to_south` | `TerrainGridSpec` + `index_to_center_xy`, `xy_to_fractional_index` |
| 3. Alturas | Unidades en metros, `vertical_datum`, `NoData = f32_nan` (nunca `0.0`) | `VerticalReferenceSpec`, `NoDataPolicy.F32_NAN` |
| 4. Archivo del frontend | `.f32` sin cabecera, Float32 little-endian, row-major y `NaN` | `encode_f32_heightmap`, `decode_f32_heightmap`, `TerrainManifestSchema` |
| 5. Acceso Python interno | Elevación, máscara válida y bloqueos sin HTTP + `z_m` por ruta | `TerrainRepository` (`Protocol`), `TerrainGridData`, `InMemoryTerrainRepository` |
| 6. Consistencia | `terrain_version`, `evidence_ids`, textura alineada al terreno | `TerrainConsistencySpec` |
| 7. Archivos estáticos | URLs bajo `/api/v1/assets/{region_id}/...` para usar el proxy `/api` | `ASSETS_URL_PREFIX`, `build_asset_url`, `TerrainAssetPaths` |

---

## 3. Proceso de desarrollo paso a paso

### Fase 0 — Preparar el entorno local

Desde `backend/`:

1. Crear el entorno virtual con Python 3.14 (objetivo del equipo; 3.12+ compatible) e instalar dependencias fijadas:

   ```powershell
   py -3.14 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -c constraints.txt -e ".[dev]"
   ```

   *(En Linux/macOS: `python3 -m venv .venv && ./.venv/bin/python -m pip install -c constraints.txt -e ".[dev]"`.)*

2. Verificar la base existente antes de programar:

   ```powershell
   .\.venv\Scripts\python.exe -m pytest
   .\.venv\Scripts\python.exe -m ruff check .
   .\.venv\Scripts\python.exe -m ruff format --check .
   ```

3. Confirmar que el servidor arranca y responde `GET /api/v1/health`:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

---

### Fase 1 — Cerrar acuerdos y desbloquear a Backend 2 de inmediato (terreno sintético)

**No esperes a terminar el procesamiento real de datos de Marte para desbloquear al equipo.**

1. Envía a Backend 2 y Frontend la confirmación de convenciones (puedes usar la plantilla de la Sección 4), aclarando:
   - Orden de filas: `north_to_south` (fila `0` = norte, col `0` = oeste).
   - Origen de la cuadrícula: centro del píxel `(row=0, col=0)`.
   - Binario `.f32`: sin cabecera (`0` bytes), Float32 little-endian (`<f4`), `row-major`, `NaN` para `NoData`.
   - Rutas de activos bajo `/api/v1/assets/MC-09/...`.
   - Interfaz Python compartida ya disponible en `app/modules/catalog/domain/terrain_contract.py` (`TerrainRepository`, `TerrainGridData`, `build_synthetic_terrain`).
2. Mientras preparas los productos reales, Backend 2 ya puede instanciar `InMemoryTerrainRepository([build_synthetic_terrain()])` para desarrollar el algoritmo de rutas y poblar `PositionSchema.z_m`.

---

### Fase 2 — Selección del sector de MC-09 e inventario científico

1. Usa [NASA Mars Trek](https://trek.nasa.gov/mars/) únicamente como explorador visual para elegir un sector concreto dentro de `MC-09` (0°–30° N, 225°–270° E) donde exista solapamiento comprobado entre:
   - DEM numérico (MOLA / CTX / HiRISE según disponibilidad del sector).
   - Imagen orbital base (`imagery`).
   - Capa geológica (USGS).
   - Fotografías/evidencia científica asociadas al área.
2. Descarga los productos desde fuentes oficiales (NASA, USGS, PDS), nunca haciendo scraping ni usando teselas RGB como DEM.
3. Documenta cada producto descargado en `DATA_SOURCES.md` (URL, misión/instrumento, fecha, resolución en metros, CRS original, tipo de latitud planetocéntrica/planetográfica, dominio de longitud `0-360`, datum/radio de referencia, licencia/crédito, limitaciones y checksum SHA-256).

---

### Fase 3 — Pipeline offline de datos geoespaciales y exportación `.f32`

1. Coordina con Backend 2 antes de agregar librerías geoespaciales (`numpy`, `rasterio`, `pyproj`, etc.) a `pyproject.toml` y `constraints.txt`, verificando compatibilidad con Python 3.12–3.14.
2. Crea un pipeline offline (scripts reproducibles fuera del flujo de petición HTTP) que tome los productos en `data/regions/MC-09/raw/` y produzca `data/regions/MC-09/processed/`:
   - Inspeccionar CRS, unidades, resolución y `NoData` de cada fuente.
   - Definir la extensión exacta del sector elegido y un marco local en metros (`frame_id`, p. ej. `MARS_MC09_LOCAL_V1`) sin usar WGS84 terrestre por defecto.
   - Recortar y reproyectar DEM, textura orbital (`imagery`) y geología al mismo sector y alineación.
   - Calcular derivados offline: pendiente (`slope.tif`), sombreado (`hillshade`) y máscara explícita de datos válidos / bloqueos por pendiente o `NoData`.
   - **Exportar `height.f32`**: convertir las alturas válidas a metros (`float32` little-endian, orden `row-major` norte a sur, sin cabecera) y cualquier celda `NoData` a `NaN` (nunca `0.0`). Puedes reutilizar `encode_f32_heightmap(...)` de `terrain_contract.py` o validar la salida con `decode_f32_heightmap(...)`.
   - **Verificar consistencia**: comprobar que `imagery` cubre exactamente la misma extensión y orientación que `height.f32`, calcular `elevation_min_m`, `elevation_max_m` (ignorando `NaN`), `terrain_version` y SHA-256 del `.f32`.
   - Si decides usar una resolución distinta para renderizar el `.f32` en 3D y otra para que Backend 2 calcule rutas, documéntalo en `TerrainMetadata.routing_grid` (por defecto ambas usan la misma cuadrícula).
3. Escribe la configuración final de la región en `data/regions/MC-09/config.json` sustituyendo cualquier marcador `null` o pendiente, junto con objetivos científicos (2–3 objetivos con coordenadas reales dentro de la cobertura y evidencia verificable) y catálogo de fotos (`verified`, `approximate` o `unknown`).
4. No subas archivos raster pesados (`raw`, `interim`, `processed`) ni `.env` a Git; versiona solo código, configuraciones, manifiestos y metadatos ligeros.

---

### Fase 4 — Implementación de capas en `app/modules/catalog/`

Organiza el código siguiendo la arquitectura por capas de [`README_BACKEND_1.md`](./README_BACKEND_1.md):

1. **`domain/`**:
   - Ya existe `terrain_contract.py` (contrato de 7 puntos + `TerrainRepository`).
   - Agrega las entidades restantes del catálogo: `Region`, `Layer`, `Evidence`, `ScienceObjective`, `PhotoReference` y el puerto/protocolo `CatalogRepository`.
2. **`infrastructure/`**:
   - Configuración tipada leída al arranque (`MAPTE_ACTIVE_REGION=MC-09`, `MAPTE_DATA_PATH`).
   - Repositorio en disco que lea `config.json`, `manifest.json`, `objectives.json`, `photos.json` y cargue `height.f32` con `decode_f32_heightmap(...)` hacia `TerrainGridData` / `InMemoryTerrainRepository`.
   - Validación estricta de rutas al servir activos estáticos (evitar *path traversal* y nunca exponer rutas absolutas locales en las respuestas).
3. **`application/`**:
   - Casos de uso: `GetActiveRegion`, `GetRegionManifest`, `GetObjectives`, `GetPhotos` y el proveedor de terreno inyectable para Backend 2.
   - Al devolver objetivos con `PositionSchema`, rellena `z_m` consultando `TerrainRepository.sample_elevation(...)`.
4. **`api/`**:
   - Ya existen `PositionSchema` y `TerrainManifestSchema` en [`api/schemas.py`](./api/schemas.py).
   - Completa los esquemas de `RegionsResponse`, `RegionManifestResponse` (con campo `terrain: TerrainManifestSchema`), `ObjectivesResponse` y `PhotosResponse`.
   - Implementa `catalog_router = APIRouter()` con:
     - `GET /regions`
     - `GET /regions/{region_id}/manifest`
     - `GET /regions/{region_id}/objectives`
     - `GET /regions/{region_id}/photos` (con query param opcional `objective_id`)
     - `GET /assets/{region_id}/{asset_path:path}` para entregar `height.f32` (`application/octet-stream`) y texturas/imágenes bajo `/api/v1/assets/...`.
   - Maneja regiones desconocidas o archivos faltantes usando `HTTPException` o `error_response(...)` de `app.core.errors`.

---

### Fase 5 — Integración en `app/main.py`, OpenAPI y Frontend

1. Coordina con Backend 2 para descomentar e integrar `catalog_router` en [`app/main.py`](../../main.py):
   `application.include_router(catalog_router, prefix="/api/v1")`.
2. Coordina con Backend 2 la inyección de `TerrainRepository` hacia `app/modules/missions/` al inicializar la app.
3. Actualicen en conjunto `contracts/openapi.yaml` (incluyendo el bloque `terrain` del manifest y `z_m` en `Position`).
4. Con ambos módulos integrados, prueben con el Frontend configurando `VITE_USE_MOCK=false` (reiniciando Vite) y verificando que `/api/v1/regions`, `/api/v1/regions/MC-09/manifest` y `/api/v1/assets/MC-09/height.f32` funcionen a través del proxy `/api`.

---

### Fase 6 — Pruebas automatizadas y validación final (`tests/catalog/`)

1. Pruebas unitarias de dominio y `.f32` (ya iniciadas en [`tests/catalog/test_terrain_contract.py`](../../../tests/catalog/test_terrain_contract.py)):
   - Conversión índice `<->` coordenadas `(x_m, y_m)`.
   - Serialización/lectura `.f32` little-endian sin cabecera y conservación de `NaN`.
   - Interpolación bilineal rechazando `NaN` sin convertirlo en `0.0` y respetando bloqueos/bordes.
2. Pruebas de integración HTTP con `fastapi.testclient.TestClient`:
   - `GET /api/v1/regions` devuelve `MC-09`.
   - `GET /api/v1/regions/MC-09/manifest` incluye `terrain` con URLs `/api/v1/assets/MC-09/...`, dimensiones y `evidence_ids`.
   - `GET /api/v1/assets/MC-09/height.f32` devuelve exactamente `width_px * height_px * 4` bytes.
   - Región inexistente o ruta inválida responde con la envoltura `{"error": {"code", "message", "details", "request_id"}}`.
3. Comandos finales obligatorios antes de hacer commit/PR:

   ```powershell
   .\.venv\Scripts\python.exe -m pytest
   .\.venv\Scripts\python.exe -m ruff check .
   .\.venv\Scripts\python.exe -m ruff format --check .
   ```

---

## 4. Plantilla de respuesta lista para enviar a Backend 2

> Acordado. Ya formalicé el contrato Python de los 7 puntos en `app/modules/catalog/domain/terrain_contract.py` y los esquemas HTTP (`TerrainManifestSchema` y `PositionSchema` con `z_m`) en `app/modules/catalog/api/schemas.py`.
>
> Confirmación de convenciones:
> 1. **Sector de Tharsis:** región `MC-09`, con `sector_id`, extensión en metros (`LocalExtentM`) y `frame_id` (`MARS_MC09_LOCAL_V1` hasta fijar el producto definitivo).
> 2. **Cuadrícula:** `TerrainGridSpec` con `width_px`, `height_px`, coordenadas del centro de `(row=0, col=0)`, `pixel_size_x_m`, `pixel_size_y_m` y `row_order="north_to_south"` (`col` crece al este `+X`, `row` crece al sur `-Y`).
> 3. **Alturas:** en metros respecto a `vertical_datum` explícito; zonas sin datos representadas únicamente con `NaN` (nunca `0.0`).
> 4. **Archivo del frontend:** `.f32` sin cabecera (`0` bytes), `Float32` little-endian (`<f4`), `row-major` y `NaN` para faltantes.
> 5. **Acceso Python en memoria:** puedes consumir `TerrainRepository` (`get_metadata`, `get_terrain`, `sample_elevation`, `sample_route_elevations`) con elevación, `valid_mask` y `blocked_mask`. Para arrancar de inmediato sin esperar el DEM real, usa `InMemoryTerrainRepository([build_synthetic_terrain()])`.
> 6. **Consistencia:** incluye `terrain_version`, `evidence_ids` y `texture_aligned_to_terrain=True`. Si visualización y rutas llegaran a usar resoluciones distintas, se informará en `TerrainMetadata.routing_grid`.
> 7. **Archivos estáticos:** todos los assets públicos irán bajo `/api/v1/assets/MC-09/...` (ej. `/api/v1/assets/MC-09/height.f32`).
