# Mars Resilience Lab — Kit de coordinación técnica

**NASA Space Apps Challenge 2026 · 3 desarrolladores (1 frontend, 2 backend)**

> **Estado:** arquitectura y contratos **propuestos para acordar con el equipo**. No son endpoints desplegados ni resultados científicos calculados. Material de planificación: el código concursante debe empezar durante la ventana oficial del hackathon.

## Orden recomendado de lectura

1. [`docs/01_CONTRATO_FRONT_BACK.md`](docs/01_CONTRATO_FRONT_BACK.md) — Qué información consume el frontend, endpoints y convenciones.
2. [`contracts/openapi.yaml`](contracts/openapi.yaml) — Especificación OpenAPI 3.0 para compartir el contrato.
3. [`contracts/examples/`](contracts/examples/) — Respuestas _mock_ con identificadores y valores **ficticios**; no son datos reales de Marte.
4. [`docs/02_TAREAS_DETALLADAS.md`](docs/02_TAREAS_DETALLADAS.md) — Tareas asignadas, entregables, criterios de aceptación y dependencias.
5. [`docs/03_PLAN_COMPLETO.md`](docs/03_PLAN_COMPLETO.md) — Alcance, módulos, flujo, stack, seguridad, ciencia, fases y riesgos.
6. [`docs/04_PANTALLAS_Y_DATOS.md`](docs/05_PANTALLAS_Y_DATOS.md) — Matriz frontend ↔ API, flujo de interfaz, offline y estados de error.

## Tres acuerdos obligatorios antes de programar

1. **Región piloto:** Jezero, sector exacto pendiente de confirmar según cobertura coincidente de topografía, geología y fotos.
2. **Contrato congelado v1:** rutas, campos, unidades, estados y errores; cualquier cambio posterior debe aprobarse por los tres.
3. **Un repositorio, un backend modular:** React + TypeScript + OpenLayers + PWA; Python + FastAPI; preparación geoespacial con Rasterio/GDAL; SQLite solo si se necesita persistir misiones compartidas.

## Objetivo de demostración

En Mission Control: seleccionar lugar → capas NASA/USGS → objetivo y ruta. En Explorer (tableta): abrir paquete, ver referencia de rover y registrar observación. El sistema adapta objetivos/ruta cuando corresponde y evalúa un retorno de contingencia, con fuentes y supuestos visibles.

## Fuentes para contrastar

- [Desafío NASA Space Apps 2026](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)
- [NASA Mars Trek](https://trek.nasa.gov/mars/)
- [USGS Geologic Map SIM 3464 (Jezero)](https://pubs.usgs.gov/publication/sim3464)
- [Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/)
- [PDS Mars 2020](https://pds-geosciences.wustl.edu/missions/mars2020/index.htm)
- [NASA Space Apps / discusión de reglas oficiales](https://github.com/nasa/spaceapps/discussions/1827)
