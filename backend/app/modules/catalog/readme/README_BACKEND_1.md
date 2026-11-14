# Backend 1 — Scientific Data & Terrain (`app/modules/catalog`)

> **Proyecto:** Mapte / Mars Resilience Lab  
> **Módulo:** `app/modules/catalog/` (Backend 1)  
> **Responsabilidad:** preparación, validación y publicación de datos científicos y geoespaciales de Marte.  
> **Región piloto inicial:** MC-09 — Tharsis.  
> **Lenguaje principal:** Python 3.12–3.14 (objetivo del equipo: Python 3.14).  
> **Framework de API:** FastAPI (`mapte-backend`).

---

## 1. Propósito del módulo

Backend 1 es responsable de convertir productos científicos de NASA, USGS y otras fuentes planetarias verificables en información organizada, documentada y lista para ser utilizada por Mapte.

Su trabajo no consiste en reproducir Mars Trek ni en limitarse a mostrar imágenes. Debe preparar datos científicos que puedan ser consultados, visualizados y reutilizados por los demás componentes del sistema.

El módulo tiene dos responsabilidades principales:

1. **Data Pipeline:** localizar, descargar, inspeccionar, recortar, transformar, validar y optimizar los productos científicos.
2. **Catalog API (`app/modules/catalog/`):** publicar la información preparada mediante un `router` de FastAPI integrado en la aplicación común bajo el prefijo `/api/v1`.

Los datos que publique Backend 1 serán utilizados por:

- **Frontend:** para mostrar mapas, capas, leyendas, objetivos científicos, fotografías y procedencia de los datos (conectado mediante el proxy de Vite `/api` -> `http://127.0.0.1:8000`).
- **Backend 2 — Mission & Safety (`app/modules/missions/`):** para consultar elevación, pendientes, cobertura, geometrías y metadatos necesarios para el cálculo de rutas y la planificación de misiones mediante interfaces Python internas (sin llamadas HTTP entre módulos).

Backend 1 no es responsable de calcular rutas, planificar misiones ni evaluar contingencias. Esas responsabilidades pertenecen a Backend 2 (`app/modules/missions/`).

---

## 2. Estado actual de la base y acuerdos de coordinación

De acuerdo con la base establecida en `backend/`:

- **Estado implementado:** la entrega base implementa únicamente el punto de entrada `app/main.py` (`create_app()`), el manejo uniforme de errores en `app/core/errors.py` y el endpoint `GET /api/v1/health` (`{"status": "ok", "api_version": "v1"}`), el cual solo confirma disponibilidad HTTP y no certifica que el terreno, el catálogo o el motor de misiones estén listos. No se han creado endpoints ficticios de catálogo ni de misiones.
- **Delimitación de trabajo simultáneo:**
  - **Backend 1:** desarrolla en `app/modules/catalog/` y ubica sus pruebas en `tests/catalog/`.
  - **Backend 2:** desarrolla en `app/modules/missions/`, ubica sus pruebas en `tests/missions/` y coordina `app/main.py`, `app/core/` y las dependencias compartidas (`pyproject.toml` y `constraints.txt`).
- **Registro de rutas:** `app/modules/catalog/` expondrá un `router` de FastAPI (`catalog_router`) que se registrará en `create_app()` con `application.include_router(catalog_router, prefix="/api/v1")`. Las rutas internas del módulo no deben repetir el prefijo `/api/v1`.
- **Comunicación entre módulos:** `catalog` y `missions` se comunican únicamente mediante interfaces Python acordadas dentro del mismo proceso.
- **Integración con Frontend y OpenAPI:**
  - El cliente de frontend usa mocks por defecto (`VITE_USE_MOCK=false` activa HTTP real y requiere reiniciar Vite; no debe activarse para todo el flujo hasta implementar los endpoints).
  - Tharsis (`MC-09`) y los formatos acordados con el frontend guían la implementación.
  - El archivo raíz `contracts/openapi.yaml` aún corresponde a la propuesta anterior y su actualización (junto con los ejemplos) está pendiente de una tarea compartida. El esquema en `/openapi.json` generado por FastAPI describe únicamente lo ya implementado.

---

## 3. Región de trabajo y configuración

### 3.1 Región piloto: MC-09 Tharsis

La primera región de trabajo es el cuadrángulo cartográfico **MC-09 — Tharsis**.

| Propiedad | Valor de referencia |
|---|---|
| Identificador | `MC-09` |
| Nombre | `Tharsis` |
| Cuerpo planetario | Marte |
| Latitud mínima | `0°` |
| Latitud máxima | `30° N` |
| Longitud mínima | `225° E` |
| Longitud máxima | `270° E` |
| Tipo de latitud | Planetocéntrica, según la ficha cartográfica consultada |
| Dirección de longitud | Positiva hacia el este |
| Dominio de longitud | `0–360°` |
| Proyección de la hoja MC-09 | Mercator |

**Importante:** MC-09 es un cuadrángulo regional extenso, no una zona de procesamiento pequeña. Para el MVP se debe elegir un sector dentro de sus límites donde exista solapamiento comprobado entre elevación, geología e imágenes. No se debe asumir que todos los productos cubren todo MC-09 ni que tienen la misma resolución.

Los límites anteriores describen la cuadrícula cartográfica. Cada producto descargado debe conservar y documentar su propio sistema de referencia, extensión, resolución, datum/radio de referencia, convención de latitud y convención de longitud. No se debe asignar automáticamente la proyección Mercator de la hoja a todos los productos de la región.

### 3.2 La región se cambia únicamente en el backend

Mapte no tendrá un selector de región en el frontend. La región activa será una decisión de configuración del backend.

La región activa se establecerá mediante variables de entorno (los archivos `.env` y `.env.*` están ignorados en `.gitignore`, excepto `!.env.example`):

```env
MAPTE_ACTIVE_REGION=MC-09
MAPTE_DATA_PATH=../data/regions
```

Para cambiar a otra región en el futuro, se modificará `MAPTE_ACTIVE_REGION` y se reiniciará el servicio. El código de procesamiento y los casos de uso deben continuar siendo los mismos; únicamente cambiarán la configuración y los archivos de entrada.

La configuración debe cargarse al iniciar la aplicación. No se recomienda cambiar la región a mitad de una petición o mientras se calcula una misión. Cada misión debe conservar el `region_id`, el `frame_id` y la versión del conjunto de datos con el que fue creada.

### 3.3 Configuración específica de cada región

Cada región tendrá su propio `config.json`. Este archivo describe sus límites planetarios de referencia, el marco local seleccionado para el proyecto y las rutas relativas a sus conjuntos de datos. Los límites de MC-09 no deben confundirse con los límites locales en metros que aparecen en el manifest.

Ejemplo orientativo de `data/regions/MC-09/config.json` (los campos de proyección y origen deben completarse con los metadatos comprobados de los productos que se seleccionen):

```json
{
  "region_id": "MC-09",
  "name": "Tharsis",
  "body": "Mars",
  "planetary_bounds": {
    "min_latitude_deg": 0,
    "max_latitude_deg": 30,
    "min_east_longitude_deg": 225,
    "max_east_longitude_deg": 270,
    "latitude_type": "planetocentric",
    "longitude_domain": "0-360"
  },
  "active_frame": {
    "frame_id": "MARS_MC09_LOCAL_V1",
    "units": "m",
    "projection_definition": "PENDIENTE_DE_DEFINIR_CON_EL_PRODUCTO",
    "origin_east_lon_deg": null,
    "origin_planetocentric_lat_deg": null
  },
  "datasets": {
    "elevation": "processed/elevation.tif",
    "slope": "processed/slope.tif",
    "geology": "processed/geology.tif",
    "imagery": "processed/imagery.tif",
    "nodata_mask": "processed/nodata_mask.tif"
  }
}
```

Los valores `null` y `PENDIENTE_DE_DEFINIR_CON_EL_PRODUCTO` son marcadores, no parámetros utilizables. Deben sustituirse por valores medidos y documentados antes de publicar el manifest o ejecutar cálculos.

### 3.4 Alineación de rutas de catálogo

Las rutas previstas para el módulo de catálogo (registradas bajo `/api/v1`) son:

- `GET /regions`
- `GET /regions/{region_id}/manifest`
- `GET /regions/{region_id}/objectives`
- `GET /regions/{region_id}/photos`

Comportamiento esperado:

1. `GET /regions` devuelve la región activa configurada. En el MVP contendrá un único elemento (`MC-09`).
2. El frontend obtiene `region_id` automáticamente de esa respuesta sin mostrar un selector de región.
3. El frontend utiliza ese identificador internamente al solicitar el manifest, los objetivos, las fotografías y las operaciones de misión.

Cualquier ajuste en las rutas o esquemas debe sincronizarse en la tarea compartida de actualización de `contracts/openapi.yaml` y ejemplos JSON.

---

## 4. Funcionalidades de Backend 1

### 4.1 Inventario y trazabilidad de fuentes científicas

Backend 1 debe identificar y documentar los productos que se utilizarán en la región piloto.

Categorías iniciales:

| Categoría | Uso en Mapte | Fuentes a investigar |
|---|---|---|
| Imágenes orbitales | Mapa base y contexto visual | Mars Trek, CTX, HiRISE y PDS |
| Elevación (DEM) | Altitud, pendiente y análisis del terreno | MOLA, productos topográficos NASA/USGS |
| Geología | Unidades geológicas y contexto científico | USGS Astrogeology y mapas geológicos de Marte |
| Fotografías de superficie | Evidencia visual de objetivos | Perseverance Raw Images y PDS |
| Datos complementarios | Capas adicionales si aportan valor | Productos espectrales, térmicos u otros catálogos verificados |

Para cada producto se debe registrar, cuando esté disponible:

- Identificador y título del producto.
- URL de la fuente original y URL de descarga.
- Misión e instrumento.
- Fecha de adquisición o publicación.
- Resolución espacial y unidades.
- Extensión geográfica.
- Sistema de referencia espacial y convenciones planetarias.
- Formato y tamaño del archivo.
- Crédito, licencia y condiciones de uso.
- Limitaciones conocidas y calidad del producto.
- Checksum del archivo descargado.

La documentación de fuentes deberá mantenerse en `DATA_SOURCES.md`.

### 4.2 Preparación y normalización geoespacial

El pipeline debe preparar los productos para que puedan utilizarse de manera coherente en el sistema.

Operaciones contempladas:

1. Inspeccionar los metadatos del producto original.
2. Validar que el producto corresponda a Marte y que su extensión sea pertinente para el sector elegido.
3. Definir el área de interés dentro de MC-09.
4. Recortar los datos a esa área cuando sea apropiado.
5. Transformar los datos a un marco local marciano en metros cuando la integración lo requiera y la transformación esté correctamente definida.
6. Mantener registro de la proyección de origen y destino, parámetros y herramientas de transformación.
7. Generar derivados topográficos, por ejemplo pendiente y sombreado del relieve, cuando sean necesarios.
8. Preservar las máscaras y valores `NoData`.
9. Optimizar los archivos para lectura y visualización.
10. Validar los productos de salida y generar metadatos de procesamiento.

No se debe utilizar WGS84 terrestre como sistema de referencia predeterminado para coordenadas marcianas. Tampoco se deben mezclar coordenadas planetocéntricas y planetográficas sin documentar y aplicar la transformación correspondiente.

Los datos faltantes deben conservarse como desconocidos. No se deben reemplazar por cero ni interpretar como terreno seguro.

### 4.3 Catálogo de regiones y manifiestos

El catálogo describe la región activa y sus capas disponibles.

El manifest debe comunicar al frontend y a Backend 2:

- Identificador y nombre de la región.
- Marco de coordenadas local.
- Unidades y definición de proyección.
- Origen del marco local.
- Límites locales en metros.
- Capas disponibles y tipo de cada capa.
- URL pública o relativa de cada recurso preparado.
- Resolución y opacidad inicial, cuando correspondan.
- Política de `NoData`.
- Evidencias y fuentes asociadas a cada capa.
- Limitaciones relevantes.

Los manifests no deben incluir rutas absolutas del disco local del desarrollador. Deben utilizar URLs relativas o rutas servidas por la aplicación.

### 4.4 Catálogo de objetivos científicos

Backend 1 deberá publicar entre dos y tres objetivos científicos iniciales para la demostración, siempre que estén respaldados por evidencia verificable.

Cada objetivo debe incluir:

- `objective_id` estable.
- `region_id`.
- Título y descripción.
- Posición en el marco local marciano.
- `frame_id` de esa posición.
- Pregunta científica (`science_question`).
- Peso de prioridad configurable para el escenario (`priority_weight`).
- Actividades sugeridas.
- Hallazgos posibles mediante códigos (`finding_code` o códigos equivalentes acordados).
- Identificadores de evidencia que sustenten el objetivo.

El peso de prioridad es un parámetro del escenario de misión, no una puntuación científica oficial de NASA. Los objetivos no deben colocarse con coordenadas inventadas ni fuera de la cobertura comprobada de los datos.

### 4.5 Catálogo de fotografías y evidencia de superficie

El módulo deberá organizar fotografías relevantes de rovers y asociarlas con objetivos cuando exista evidencia suficiente.

Metadatos previstos:

- `photo_id`.
- `objective_id` asociado, cuando corresponda.
- URL del recurso optimizado y URL de la fuente original.
- Cámara e instrumento.
- `sol`, cuando esté disponible.
- Fecha de captura.
- Crédito.
- Posición, si está verificada.
- Calidad de geolocalización: `verified`, `approximate` o `unknown`.
- Limitaciones de la asociación.

Una fotografía capturada durante el mismo sol no demuestra por sí sola que corresponda al objetivo exacto. Si no existe una ubicación fiable, se deberá presentar como referencia regional y etiquetarla como `approximate` o `unknown`.

El backlog actual contempla seleccionar aproximadamente 10–20 imágenes optimizadas para el MVP, si los datos y el tiempo disponible lo permiten.

### 4.6 Validación de datos y paquete de activos

Antes de publicar un conjunto de datos se deben verificar:

- Integridad del archivo y checksum.
- Sistema de referencia y unidades.
- Extensión y resolución.
- Cobertura espacial y coincidencia entre capas.
- Valores `NoData` y máscaras.
- Coherencia de los metadatos.
- Correspondencia entre capas, objetivos y evidencias.
- URLs de recursos.
- Tamaño de los recursos y posibilidad de precarga offline.

Los resultados de validación deben poder consultarse en reportes generados por el pipeline. Los datos que no superen una validación no deben publicarse como datos confirmados.

---

## 5. Arquitectura del proyecto y estructura de carpetas

Backend 1 forma parte de la aplicación FastAPI modular ubicada en `backend/`. No constituye un microservicio separado.

```text
          NASA / USGS / PDS / Mars Trek
                        |
                        v
            Pipeline de datos (offline)
  Descarga -> Inspección -> Recorte -> Transformación
           -> Derivados -> Validación
                        |
                        v
               data/regions/MC-09/
       Raw / Processed / Manifest / Catalog
                        |
                        v
            backend/ (FastAPI: app.main)
                        |
              app/modules/catalog/
                        |
          +-------------+-------------+
          |                           |
          v                           v
   Frontend (Vite)             Backend 2
   Proxy /api -> :8000         app/modules/missions/
```

### 5.1 Organización interna de `app/modules/catalog/`

Dentro de `app/modules/catalog/` se recomienda una separación por capas ligera:

| Capa | Responsabilidad | Ejemplos |
|---|---|---|
| `api/` | Recibir peticiones HTTP, validar parámetros y devolver respuestas mediante el `router` del módulo | Routers FastAPI, schemas Pydantic |
| `application/` | Ejecutar casos de uso y coordinar repositorios | `GetActiveRegion`, `GetRegionManifest`, `GetObjectives`, `GetPhotos` |
| `domain/` | Definir entidades, tipos, interfaces y reglas propias del catálogo | `Region`, `Layer`, `Evidence`, `ScienceObjective`, `PhotoReference`, `TerrainRepository` |
| `infrastructure/` | Leer archivos, consultar metadatos y ejecutar adaptadores geoespaciales | Repositorios JSON, filesystem, lectura de rasters |

El dominio no debe depender directamente de FastAPI ni de rutas físicas del sistema.

### 5.2 Estructura real de `backend/` y su evolución para Backend 1

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                      # Punto de integración (coordinado por Backend 2)
│   ├── core/                        # Infraestructura compartida (coordinada por Backend 2)
│   │   ├── __init__.py
│   │   └── errors.py                # Manejadores y formato uniforme de errores
│   │
│   └── modules/
│       ├── __init__.py
│       ├── catalog/                 # Espacio de Backend 1
│       │   ├── __init__.py
│       │   ├── README_BACKEND_1.md  # Este documento
│       │   ├── api/                 # (Por implementar) router y endpoints del catálogo
│       │   ├── application/         # (Por implementar) casos de uso del catálogo
│       │   ├── domain/              # (Por implementar) entidades y protocolos (p. ej. terreno)
│       │   └── infrastructure/      # (Por implementar) lectura de JSON, rasters y assets
│       │
│       └── missions/                # Espacio de Backend 2 (tareas M01–M06)
│           └── __init__.py
│
├── tests/
│   ├── test_foundation.py           # Pruebas base de salud y envoltura de errores
│   ├── catalog/                     # (Por implementar) Pruebas de Backend 1
│   └── missions/                    # (Por implementar) Pruebas de Backend 2
│
├── constraints.txt                  # Versiones fijadas (coordinado entre ambos backend)
├── pyproject.toml                   # Configuración del paquete, dependencias, pytest y ruff
├── README.md                        # Guía general del backend
└── .gitignore
```

Los archivos raster grandes (`raw`, `interim` y `processed`) no deben subirse directamente a Git. Se versionan únicamente el código, manifiestos, configuraciones y metadatos ligeros. Tampoco se deben subir archivos `.env`.

---

## 6. Tecnologías y dependencias

### 6.1 Dependencias actuales en `pyproject.toml` y `constraints.txt`

La base instalada y fijada en el proyecto incluye:

| Paquete | Rango en `pyproject.toml` | Versión en `constraints.txt` | Uso |
|---|---|---|---|
| Python | `>=3.12,<3.15` | Compatible 3.12–3.14 (objetivo 3.14) | Lenguaje principal |
| `fastapi` | `>=0.115,<1` | `0.163.0` | Framework API REST |
| `pydantic` | `>=2,<3` | `2.14.3` | Modelos, validación y serialización |
| `uvicorn` | `>=0.30,<1` | `0.54.0` | Servidor ASGI |
| `pytest` (dev) | `>=8,<10` | `9.2.0` | Pruebas automatizadas |
| `httpx` (dev) | `>=0.27,<1` | `0.28.1` | Cliente HTTP para `TestClient` y descargas |
| `ruff` (dev) | `>=0.9,<1` | `0.17.5` | Linting (`E`, `F`, `I`) y formato (`line-length = 100`) |

### 6.2 Dependencias adicionales para geoespacial y procesamiento

Cuando se incorporen bibliotecas adicionales (como `pydantic-settings`, `numpy`, `rasterio`, `pyproj`, `shapely`, `pillow`, etc.) al entorno del backend:

- **Coordinación obligatoria:** cualquier cambio en `pyproject.toml` y `constraints.txt` debe coordinarse con Backend 2.
- **Compatibilidad con Python 3.12–3.14:** verificar que los paquetes (especialmente las ruedas binarias de `rasterio`/`GDAL`/`pyproj`/`numpy`) sean compatibles con la versión objetivo del equipo.

---

## 7. Pipeline de datos

El pipeline de datos se ejecuta de forma previa e independiente de las peticiones HTTP de la API. No se deben descargar ni reproyectar imágenes grandes cada vez que el frontend llama a un endpoint.

### 7.1 Flujo general

```text
1. Identificar producto y fuente
             |
             v
2. Descargar y guardar metadatos originales
             |
             v
3. Inspeccionar formato, CRS, resolución y bounds
             |
             v
4. Validar cobertura con el sector piloto MC-09
             |
             v
5. Recortar y transformar si corresponde
             |
             v
6. Generar derivados (p. ej. pendiente / hillshade)
             |
             v
7. Optimizar activos para lectura y visualización
             |
             v
8. Crear manifest, catálogo y checksums
             |
             v
9. Ejecutar validaciones y publicar activos aprobados
```

### 7.2 Datos derivados y optimización

- **Elevation:** modelo de elevación preparado para el sector.
- **Slope:** pendiente calculada a partir del DEM con resolución horizontal correcta, unidades verticales coherentes y tratamiento documentado de bordes y `NoData`.
- **Hillshade:** representación sombreada del relieve para visualización.
- **Geology:** capa geológica recortada o adaptada al marco común.
- **Coverage / NoData mask:** indicador de dónde existen datos válidos.
- **Imagery:** imagen orbital preparada para el visor.

Reglas operativas:

- Recortar los productos al sector útil de la demostración.
- Precalcular productos estáticos; no recalcular pendientes en cada solicitud HTTP.
- Mantener originales y derivados separados.
- No cargar mosaicos gigantes completos en memoria sin necesidad.

---

## 8. Contrato HTTP de Backend 1 y manejo de errores

El router de `app/modules/catalog` se monta en `app/main.py` bajo `/api/v1`. Las rutas definidas dentro del router no incluyen dicho prefijo:

| Método | Ruta en el router | Ruta final expuesta | Responsabilidad |
|---|---|---|---|
| `GET` | `/regions` | `/api/v1/regions` | Devolver la región activa configurada (en el MVP, `MC-09`). |
| `GET` | `/regions/{region_id}/manifest` | `/api/v1/regions/{region_id}/manifest` | Devolver marco espacial, bounds, capas, assets y evidencias. |
| `GET` | `/regions/{region_id}/objectives` | `/api/v1/regions/{region_id}/objectives` | Devolver los objetivos científicos de la región. |
| `GET` | `/regions/{region_id}/photos` | `/api/v1/regions/{region_id}/photos` | Devolver fotografías y metadatos; admite `objective_id` opcional. |

### 8.1 Detalle de respuestas esperadas

- **`GET /api/v1/regions`**: devuelve `{"regions": [{"region_id": "MC-09", "name": "Tharsis", "body": "Mars", "description": "Tharsis quadrangle, Mars", "available": true}]}`.
- **`GET /api/v1/regions/{region_id}/manifest`**: devuelve `region_id`, `frame` (`frame_id`, unidades, origen, definición de proyección, dirección de longitud y tipo de latitud), `bounds_local_m`, `layers` (id, tipo, título, URL relativa/pública, opacidad, resolución, evidencias y política `nodata`) y `evidence` (fuente, misión, instrumento, URL, crédito, fecha, resolución y limitaciones).
- **`GET /api/v1/regions/{region_id}/objectives`**: devuelve objetivos con posición en el marco local, `science_question`, `priority_weight`, actividades, hallazgos posibles y referencias de evidencia.
- **`GET /api/v1/regions/{region_id}/photos`**: devuelve fotografías (filtrables por `?objective_id=...`) declarando su calidad de localización (`verified`, `approximate` o `unknown`) y sus limitaciones.

### 8.2 Formato de errores (implementado en `app/core/errors.py`)

Toda la aplicación utiliza la función `error_response` y los manejadores registrados en `app/core/errors.py`:

```json
{
  "error": {
    "code": "HTTP_404",
    "message": "Not Found",
    "details": {},
    "request_id": "3f9a1b2c-..."
  }
}
```

Comportamiento preestablecido en la base:

- **`HTTPException`:** conserva el código de estado HTTP y las cabeceras (`headers`), devolviendo `"code": "HTTP_{status_code}"` y `"message": str(exc.detail)`.
- **`RequestValidationError` (422):** devuelve `"code": "VALIDATION_ERROR"`, `"message": "Solicitud inválida"` y `"details": {"issues": [{"location": [...], "message": "...", "type": "..."}]}` sin exponer valores de entrada privados ni contextos internos.
- **`Exception` inesperada (500):** registra el fallo en el log y devuelve `"code": "INTERNAL_ERROR"` y `"message": "Error interno del servidor"`, sin filtrar detalles internos al cliente.
- **Errores de dominio:** se pueden construir con `error_response(status, code, message, details, headers)` de `app.core.errors`, acordando los códigos específicos entre ambos módulos.

---

## 9. Contratos internos para Backend 2 (`app/modules/missions`)

Además de los endpoints HTTP, Backend 1 debe proporcionar acceso interno en Python a los datos científicos y al terreno para que `app/modules/missions` los consuma en el mismo proceso:

```python
from typing import Protocol


class TerrainRepository(Protocol):
    def get_elevation_grid(self, region_id: str): ...

    def get_slope_grid(self, region_id: str): ...

    def get_nodata_mask(self, region_id: str): ...

    def get_spatial_metadata(self, region_id: str): ...
```

La interfaz interna debe devolver valores numéricos y metadatos (dimensiones de la grilla, resolución espacial, transformación entre índices de grilla y coordenadas del marco local, `frame_id`, unidades, máscara `NoData` y extensión válida). Una imagen renderizada o tesela visual no sustituye a un DEM numérico.

---

## 10. Uso de Mars Trek y fuentes planetarias

[NASA Mars Trek](https://trek.nasa.gov/mars/) es la herramienta de exploración visual para delimitar el sector dentro de MC-09 e identificar productos relevantes, pero:

1. Los productos científicos deben descargarse de sus fuentes oficiales (NASA, USGS, PDS) siempre que sea posible.
2. **Una tesela visual no sustituye a un dato científico numérico.** Una imagen coloreada de elevación no debe utilizarse como DEM para calcular pendientes o rutas.
3. No se debe realizar scraping de la interfaz de Mars Trek como sustituto de una fuente de datos documentada.

---

## 11. Entorno, ejecución y comprobaciones

Según lo establecido en `backend/README.md`:

### 11.1 Instalación y ejecución (PowerShell en Windows)

Ejecutar desde el directorio `backend` (`D:\PROG\NASA\Mapte\backend`):

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c constraints.txt -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Si aún no está instalado Python 3.14, se puede crear el entorno con `py -3.12`. En entornos Linux/macOS equivalentes:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -c constraints.txt -e ".[dev]"
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Endpoints de sistema disponibles en la base:

- Salud: `http://127.0.0.1:8000/api/v1/health`
- Swagger UI: `http://127.0.0.1:8000/docs`
- Esquema OpenAPI implementado: `http://127.0.0.1:8000/openapi.json`

### 11.2 Pruebas y calidad de código

Desde `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

- Las pruebas de Backend 1 deben ubicarse en `tests/catalog/`.
- El estilo se valida con Ruff según `pyproject.toml` (`target-version = "py312"`, `line-length = 100`, reglas `E`, `F`, `I`).

---

## 12. Pruebas y criterios de aceptación de Backend 1

### 12.1 Pruebas de datos y pipeline

- El producto existe, puede abrirse y coincide con su checksum registrado.
- El CRS, unidades y convenciones planetarias están documentados.
- La extensión recortada está dentro del sector solicitado en MC-09.
- Los valores `NoData` se conservan sin reemplazarse por cero.
- Los derivados tienen dimensiones y resolución esperadas y se solapan donde el manifest lo declara.

### 12.2 Pruebas del módulo `catalog` (`tests/catalog/`)

- La configuración activa apunta a una región válida (`MC-09`).
- El manifest referencia archivos existentes y URLs relativas/públicas válidas.
- Los IDs de capas y evidencias son únicos y consistentes.
- Los objetivos están dentro de los límites declarados y cuentan con evidencia.
- Las fotografías declaran su calidad de localización (`verified`, `approximate` o `unknown`).
- Los endpoints responden bajo `/api/v1` y los errores cumplen la envoltura de `app/core/errors.py`.

---

## 13. Gestión de versiones de datos y límites de alcance

### 13.1 Versionado de activos

Cada conjunto de datos generado debe registrar en sus metadatos:

- `dataset_version` y fecha de procesamiento en ISO 8601 UTC.
- Identificadores y checksums de los productos fuente.
- Parámetros de recorte/transformación, CRS de origen/destino, resolución, dimensiones y política de `NoData`.

### 13.2 Fuera del alcance de Backend 1

- Algoritmo de rutas, planificación y persistencia de misiones, registro de observaciones y evaluación de contingencias: pertenecen a **Backend 2 (`app/modules/missions/`)**.
- Componentes visuales, selector de capas y experiencia de usuario: pertenecen al **Frontend**.
- Coordinación de `app/main.py` y `app/core/`: responsabilidad coordinada por **Backend 2**.
