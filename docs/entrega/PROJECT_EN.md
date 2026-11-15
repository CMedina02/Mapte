---
project: Mapte
language: en
ai_assistance:
  project_coding: [Claude, OpenAI Codex]
  document_drafting: OpenAI Codex
---

# Mapte · Planning Scientific Marswalks

[Versión en español](PROYECTO_ES.md) · [Source code](https://github.com/CMedina02/Mapte) · [Local setup](DESARROLLO_Y_VALIDACION.md#ejecución-local)

## 1. Project Summary

Can a crew add a science stop and still return to base with the required reserve? Mapte answers that question in a 10 × 10 km area of Mount Sharp in Gale Crater. The web prototype turns orbital terrain data into routing constraints and uses Curiosity waypoints and photographs to give each stop scientific context. Mission Control sets the itinerary and available resources. The explorer follows the plan in a 3D visor and reviews the activity at each destination. If the plan drops a stop, Mapte explains which constraint drove the decision. The project addresses the 2026 NASA Space Apps challenge **Interplanetary Survival Guide: Martian Map**.

## 2. What It Does & How It Works

- **Planning on the 2D map.** Mission Control selects a base, orders the stops, and adjusts the slope limit, walking speed, simulated support, and reserve. The orthophoto provides the basemap for the objectives, traverse, and return route.
- **Route calculation.** The A* routing engine uses slopes derived from the digital elevation model on a 4 m grid. For longer routes, the search can first identify a corridor at 20 m and refine it at 4 m. The engine applies the slope limit, avoids scenario exclusion zones, and can route around areas with uncertain terrain data.
- **Checking each stop.** Before adding an objective, the planner estimates the time needed to reach the stop, complete the activity, and return. It retains the stops it can accommodate in the selected order while preserving the required reserve. The dashboard explains why other stops were excluded. The model deducts one minute of simulated support for each minute elapsed.
- **Simulation and surface science.** The web visor uses the Mission Control itinerary and displays 3D terrain, the route, heading, radar, and an elevation profile from a simulated position. The Explorer panel shows the science question, activities, and Curiosity photos for the current stop. For supported objectives such as Gediz Vallis, the explorer can record an observation and update mission progress.
- **Shared mission state.** FastAPI serves the catalog and computes mission plans. SQLite stores mission versions and events. The browser can save a package containing the plan and its associated catalog for use in the visor. This workflow uses the backend catalog and planner with `VITE_USE_MOCK=false`.

## 3. NASA Data & Resources Integration

- **Terrain and orbital imagery.** The Gale v3 mosaics published by USGS Astrogeology incorporate observations from HiRISE aboard the Mars Reconnaissance Orbiter. Mapte crops and reprojects the original 1 m elevation model to 4 m to calculate slope and ascent. It aligns the original 25 cm orthophoto with that terrain and prepares it at 2 m for the map. The slope derived from the model directly constrains routing. [Elevation model](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [Orthophoto](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **Surface locations and evidence.** Mapte projects the positions of Curiosity, part of the Mars Science Laboratory mission, into the terrain's coordinate system. Rover positions approximate the locations of science activities. Raw photographs provide a view from the surface. The catalog ties **Glen Torridon** to the study of clay minerals, **Gediz Vallis** to elemental sulfur, and **Marias Pass** to silica-rich rocks. [Curiosity waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Raw images](https://mars.nasa.gov/msl/multimedia/raw-images/)
- **Challenge alignment.** The map brings together topography, optical imagery, the route, and science stops. The team can plan in 2D and use the same itinerary in the visor. The challenge suggests combining at least three data types and considering imagery from the surface. Mapte includes geology as context for individual objectives. Dust, temperature, and radiation fall outside the scope of the data layers and route calculations. Hazard zones represent scenario conditions, and slope analysis is limited to what the grid can resolve. [NASA Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) · [Brief published by the Athlone local event](https://hackathlone.com/challenges/interplanetary-survival-guide-martian-map)

## 4. Impact & Expected Goals

**Gediz Vallis scenario.** With a **15°** slope limit, the planner calculated a **910 m** outbound route and a maximum modeled slope of **14.62°**. At 20 m/min and with 15 min for science activities, the plan included the stop and return with **480 min** of simulated support and a **60 min** reserve. When available support alone dropped to **120 min**, the planner excluded the stop because completing the itinerary would leave less than 60 min in reserve.

**Intended use.** In planning exercises, Mission Control can compare itineraries and explain why it includes or drops a stop. The explorer can relate that decision to the route's elevation, surface photographs, and planned activity. The pilot focuses on Mount Sharp. Applying the same method to another area would require preparing its terrain and imagery, checking their coverage, and building a local catalog of science objectives with documented evidence.

## 5. Tools, Languages, Hardware & Software

- **Interface and visor.** TypeScript, React, React DOM, and Tailwind CSS for the application. OpenLayers for the 2D map, Three.js with React Three Fiber and Drei for the 3D scene, and Lucide React for icons.
- **Backend and storage.** Python, FastAPI, Pydantic, Uvicorn, SQLite, and an OpenAPI contract.
- **Build and web application.** Node.js, pnpm, Vite, Vite Plugin PWA, and Workbox. The interface runs in a web browser with WebGL for the 3D visor.
- **Data processing.** GDAL, Bash, and cURL for mosaic preparation. NumPy and Pillow generate derivatives used by the browser.

## 6. Artificial Intelligence (AI) Usage Statement

The team defined the Mapte concept, architecture, mission workflow, planning criteria, and interface design. The team used Claude and OpenAI Codex as coding assistants during development. Codex also helped review the repository and draft the documentation. The text and metadata of this file identify the AI assistance used for this document.

## 7. References

- **Calef III, F. J., and Parker, T. (2016).** Gale v3 mosaics, USGS Astrogeology Science Center. HiRISE credit goes to NASA/JPL/University of Arizona. [MSL Gale Merged DEM Mosaic, 1 m](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [MSL Gale Merged Orthophoto Mosaic, 25 cm](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **NASA/JPL-Caltech, Mars Science Laboratory.** Curiosity rover positions and raw imagery. [Waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Image gallery](https://mars.nasa.gov/msl/multimedia/raw-images/) · [Individual photo credits](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/photos.json)
- **Glen Torridon.** Emily Lakdawalla, The Planetary Society (2019), account of the Aberlady and Kilmarie drill sites. [Curiosity Update, Sols 2313–2387](https://www.planetary.org/articles/curiosity-update-sols-2313-2387)
- **Gediz Vallis.** NASA/JPL (2024), report on the elemental sulfur discovery and update on Curiosity's activities. [Discovery report](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) · [Mission update, sols 4219–4221](https://science.nasa.gov/blog/sols-4219-4221-its-a-complex-morning)
- **Marias Pass.** Abbey et al. (2020), Curiosity drilling campaign, *Icarus*. Morris et al. (2016), tridymite in Gale Crater, *PNAS*. NASA/JPL (2015), silica-rich rocks. [Abbey et al.](https://www-robotics.jpl.nasa.gov/media/documents/1-s2.0-S0019103520302657-main_look_back_drilling_on_curiosity_part_ii.pdf) · [Morris et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4932983/) · [NASA/JPL report](https://www.jpl.nasa.gov/news/rocks-rich-in-silica-present-puzzles-for-mars-rover-team/) · [Catalog of sources by objective](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/objectives.json)
- **Interface, mapping, and visor.** [TypeScript](https://www.typescriptlang.org/) · [React and React DOM](https://react.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [OpenLayers](https://openlayers.org/) · [Three.js](https://threejs.org/) · [React Three Fiber](https://r3f.docs.pmnd.rs/) · [Drei](https://github.com/pmndrs/drei) · [Lucide React](https://lucide.dev/)
- **Build and web application.** [Node.js](https://nodejs.org/) · [pnpm](https://pnpm.io/) · [Vite](https://vite.dev/) · [Vite Plugin PWA](https://vite-pwa-org.netlify.app/) · [Workbox](https://developer.chrome.com/docs/workbox/)
- **Backend and data processing.** [Python](https://docs.python.org/3/) · [FastAPI](https://fastapi.tiangolo.com/) · [Pydantic](https://docs.pydantic.dev/) · [Uvicorn](https://www.uvicorn.org/) · [SQLite](https://www.sqlite.org/) · [OpenAPI](https://www.openapis.org/) · [GDAL](https://gdal.org/) · [Bash](https://www.gnu.org/software/bash/) · [cURL](https://curl.se/) · [NumPy](https://numpy.org/) · [Pillow](https://python-pillow.org/)
