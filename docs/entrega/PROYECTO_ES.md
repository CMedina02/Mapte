---
project: Mapte
language: es
ai_assistance:
  project_coding: [Claude, OpenAI Codex]
  document_drafting: OpenAI Codex
---

# Mapte · Planificación de caminatas científicas en Marte

[English version](PROJECT_EN.md) · [Código fuente](https://github.com/CMedina02/Mapte) · [Ejecución local](DESARROLLO_Y_VALIDACION.md#ejecución-local)

## 1. Resumen del proyecto

¿Se puede añadir una parada científica y regresar a la base con la reserva prevista? Mapte responde a esa pregunta en un sector de 10 × 10 km de Monte Sharp, cráter Gale. El prototipo web convierte el relieve orbital en restricciones de ruta y usa las posiciones y fotografías de Curiosity para dar contexto a las paradas. Control de Misión fija el itinerario y los recursos disponibles. El explorador sigue el plan en un visor 3D y consulta qué actividad corresponde en cada destino. Si el plan excluye una parada, Mapte explica qué restricción motivó la decisión. El proyecto responde al reto **Interplanetary Survival Guide: Martian Map** de NASA Space Apps 2026.

## 2. Qué hace y cómo funciona

- **Planificación en el mapa 2D.** Control de Misión fija la base, ordena las paradas y ajusta el límite de pendiente, la velocidad de marcha, el soporte simulado y la reserva. La ortofoto muestra la superficie sobre la que se trazan los objetivos, el recorrido y el regreso.
- **Cálculo del recorrido.** El motor A* usa pendientes derivadas del modelo digital de elevación en una rejilla de 4 m. Para recorridos largos, la búsqueda puede identificar primero un corredor a 20 m y refinarlo a 4 m. El motor respeta el límite de pendiente, evita zonas de exclusión del escenario y puede apartarse de sectores donde la calidad del dato es incierta.
- **Decisión sobre cada parada.** Antes de añadir un objetivo, el planificador estima los tiempos de ida, actividad y vuelta. Conserva las paradas que se pueden completar en el orden elegido con la reserva exigida. El panel muestra por qué quedaron fuera otras paradas. El modelo descuenta un minuto de soporte simulado por cada minuto transcurrido.
- **Simulación y trabajo científico.** El visor web usa el itinerario de Control de Misión y muestra terreno 3D, ruta, rumbo, radar y perfil de elevación desde una posición simulada. El panel Explorador presenta la pregunta científica, las actividades y las fotos de Curiosity de la parada actual. En objetivos compatibles, como Gediz Vallis, permite registrar una observación y actualizar el avance de la misión.
- **Estado compartido.** FastAPI sirve el catálogo y calcula los planes. SQLite guarda versiones y eventos de la misión. El navegador puede guardar un paquete con el plan y el catálogo asociado para abrirlo en el visor. El flujo descrito usa el catálogo y el planificador del backend con `VITE_USE_MOCK=false`.

## 3. Integración de datos y recursos de la NASA

- **Relieve e imagen orbital.** Los mosaicos de Gale v3 publicados por USGS Astrogeology incorporan observaciones de HiRISE a bordo de Mars Reconnaissance Orbiter. Mapte recorta y reproyecta el modelo de elevación de origen de 1 m a 4 m para calcular pendientes y ascensos. Alinea la ortofoto de origen de 25 cm con ese relieve y la prepara a 2 m para el mapa. La pendiente obtenida del modelo interviene directamente en la selección del trazado. [Modelo de elevación](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [Ortofoto](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **Ubicación y evidencia de superficie.** Mapte proyecta las posiciones de Curiosity, de la misión Mars Science Laboratory, al mismo sistema de coordenadas del terreno. Las posiciones del rover aproximan la ubicación de las actividades científicas. Las fotografías crudas aportan una referencia visual desde la superficie. El catálogo vincula **Glen Torridon** con el estudio de arcillas, **Gediz Vallis** con el azufre elemental y **Marias Pass** con las rocas ricas en sílice. [Posiciones de Curiosity](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Imágenes crudas](https://mars.nasa.gov/msl/multimedia/raw-images/)
- **Correspondencia con el reto.** El mapa integra topografía, imagen óptica, ruta y paradas científicas. El equipo puede planificar en 2D y usar el mismo itinerario en el visor. El enunciado sugiere combinar al menos tres tipos de datos y considerar imágenes de superficie. Mapte incorpora la geología como contexto por objetivo. El polvo, la temperatura y la radiación quedan fuera de las capas de datos y del cálculo. Las zonas de riesgo representan condiciones del escenario y el análisis de pendiente se limita al detalle de la rejilla. [Reto de NASA Space Apps](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) · [Enunciado publicado por la sede de Athlone](https://hackathlone.com/challenges/interplanetary-survival-guide-martian-map)

## 4. Impacto y objetivos esperados

**Caso de Gediz Vallis.** Con un límite de pendiente de **15°**, el planificador calculó una ida de **910 m** con una pendiente máxima modelada de **14,62°**. A 20 m/min y con 15 min de actividad científica, el plan incluyó la visita y el regreso con **480 min** de soporte simulado y una reserva de **60 min**. Al reducir solo el soporte disponible a **120 min**, excluyó la parada porque completar el itinerario habría dejado menos de 60 min de reserva.

**Uso previsto.** En ejercicios de planificación, Control de Misión puede comparar itinerarios y explicar por qué se acepta o se excluye una parada. El explorador puede relacionar esa decisión con la elevación del recorrido, las fotografías de superficie y la actividad prevista. El piloto se centra en Monte Sharp. Extender el método a otra zona requeriría preparar su relieve e imágenes, comprobar su cobertura y construir un catálogo local de objetivos con evidencia documentada.

## 5. Herramientas, lenguajes, hardware y software

- **Interfaz y visor.** TypeScript, React, React DOM y Tailwind CSS para la aplicación. OpenLayers para el mapa 2D, Three.js con React Three Fiber y Drei para la escena 3D, y Lucide React para la iconografía.
- **Backend y almacenamiento.** Python, FastAPI, Pydantic, Uvicorn, SQLite y contrato OpenAPI.
- **Compilación y aplicación web.** Node.js, pnpm, Vite, Vite Plugin PWA y Workbox. La interfaz se ejecuta en un navegador con WebGL para el visor 3D.
- **Procesamiento de datos.** GDAL, Bash y cURL para preparar los mosaicos. NumPy y Pillow para los derivados que usa el navegador.

## 6. Declaración de uso de inteligencia artificial

El equipo definió el concepto de Mapte, la arquitectura, el flujo de misión, los criterios de planificación y el diseño de la interfaz. Claude y OpenAI Codex se usaron como asistentes de programación durante el desarrollo. Codex también ayudó a revisar el repositorio y redactar la documentación. El texto y los metadatos de este archivo identifican la asistencia de IA en este documento.

## 7. Referencias

- **Calef III, F. J., y Parker, T. (2016).** Mosaicos de Gale v3, USGS Astrogeology Science Center. Crédito de HiRISE a NASA/JPL/University of Arizona. [MSL Gale Merged DEM Mosaic, 1 m](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [MSL Gale Merged Orthophoto Mosaic, 25 cm](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **NASA/JPL-Caltech, Mars Science Laboratory.** Posiciones del rover Curiosity e imágenes crudas. [Posiciones](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Galería de imágenes](https://mars.nasa.gov/msl/multimedia/raw-images/) · [Créditos por fotografía](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/photos.json)
- **Glen Torridon.** Emily Lakdawalla, The Planetary Society (2019), recuento de las perforaciones Aberlady y Kilmarie. [Curiosity Update, Sols 2313–2387](https://www.planetary.org/articles/curiosity-update-sols-2313-2387)
- **Gediz Vallis.** NASA/JPL (2024), informe sobre el hallazgo de azufre elemental y actualización de las actividades de Curiosity. [Informe del hallazgo](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) · [Actualización, soles 4219–4221](https://science.nasa.gov/blog/sols-4219-4221-its-a-complex-morning)
- **Marias Pass.** Abbey et al. (2020), campaña de perforación de Curiosity, *Icarus*. Morris et al. (2016), tridimita en el cráter Gale, *PNAS*. NASA/JPL (2015), rocas ricas en sílice. [Abbey et al.](https://www-robotics.jpl.nasa.gov/media/documents/1-s2.0-S0019103520302657-main_look_back_drilling_on_curiosity_part_ii.pdf) · [Morris et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4932983/) · [Informe de NASA/JPL](https://www.jpl.nasa.gov/news/rocks-rich-in-silica-present-puzzles-for-mars-rover-team/) · [Catálogo de fuentes por objetivo](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/objectives.json)
- **Interfaz, mapa y visor.** [TypeScript](https://www.typescriptlang.org/) · [React y React DOM](https://react.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [OpenLayers](https://openlayers.org/) · [Three.js](https://threejs.org/) · [React Three Fiber](https://r3f.docs.pmnd.rs/) · [Drei](https://github.com/pmndrs/drei) · [Lucide React](https://lucide.dev/)
- **Compilación y aplicación web.** [Node.js](https://nodejs.org/) · [pnpm](https://pnpm.io/) · [Vite](https://vite.dev/) · [Vite Plugin PWA](https://vite-pwa-org.netlify.app/) · [Workbox](https://developer.chrome.com/docs/workbox/)
- **Backend y procesamiento de datos.** [Python](https://docs.python.org/3/) · [FastAPI](https://fastapi.tiangolo.com/) · [Pydantic](https://docs.pydantic.dev/) · [Uvicorn](https://www.uvicorn.org/) · [SQLite](https://www.sqlite.org/) · [OpenAPI](https://www.openapis.org/) · [GDAL](https://gdal.org/) · [Bash](https://www.gnu.org/software/bash/) · [cURL](https://curl.se/) · [NumPy](https://numpy.org/) · [Pillow](https://python-pillow.org/)
