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

Mission Control sets the base, stops, and resources on the 2D map. The backend returns the legs, their metrics, and the reasons for exclusions. The visor uses that plan to display 3D terrain, heading, radar, and an elevation profile from a simulated position. At a supported stop, the explorer can view a Curiosity reference photo, select a finding, and add a note.

### Repository structure

| Location | Responsibility |
| --- | --- |
| `frontend/src/features/` and `frontend/src/shared/` | Mission Control, map, visor, simulation, and synchronization components. Shared code includes the HTTP client and API types. [Application entry point](../../frontend/src/main.tsx) · [HTTP client](../../frontend/src/shared/api/client.ts) |
| `backend/app/modules/catalog/` | Loads the terrain and its provenance. Publishes the region manifest, objectives, and photos in a shared coordinate frame. [Catalog API](../../backend/app/modules/catalog/api/router.py) |
| `backend/app/modules/missions/` | Separates routing, resource evaluation, planning, observations, and simulation. The SQLite repository stores plan versions and mission events. [Mission API](../../backend/app/modules/missions/api/router.py) · [Persistence](../../backend/app/modules/missions/persistence/sqlite.py) |
| `backend/scripts/terrain/`, `backend/data/regions/`, and `contracts/` | Terrain product preparation and publication. The OpenAPI contract documents the requests and responses that connect the two application layers. [Terrain pipeline](../../backend/scripts/terrain/build_gale_mount_sharp.sh) · [OpenAPI contract](../../contracts/openapi.yaml) |

This workflow uses the FastAPI catalog and planner with `VITE_USE_MOCK=false`.

### Main functions

- **Create the plan.** `PlanPanel` prepares the request with the base, ordered objectives, maximum slope, walking speed, activity times, simulated support, and reserve. It sends these inputs to `POST /api/v1/missions/plan`. [Planning form](../../frontend/src/features/mission-control/PlanPanel.tsx)
- **Calculate a route leg.** `RouteApplicationService.compute()` combines elevation, terrain quality, and hazard zones with walking constraints. A* searches a 4 m grid. For long routes it can explore a 20 m corridor first and refine the path at 4 m. If the search reaches its limit or the path depends on unknown terrain, the result leaves feasibility unconfirmed. [Routing service](../../backend/app/modules/missions/routing/service.py) · [A* engine](../../backend/app/modules/missions/routing/planner.py)
- **Evaluate the return.** `MissionPlanner.plan()` reviews stops in the selected order. Before accepting each one, it calculates a return to base and passes the entire itinerary to `ResourceEvaluator.evaluate()`, which deducts one minute of simulated support for each minute of walking or activity. If a stop violates the constraints or the reserve cannot be confirmed, the planner retains the itinerary through the last accepted stop and records the reason for exclusion. [Mission planner](../../backend/app/modules/missions/planning/planner.py) · [Resource evaluation](../../backend/app/modules/missions/resources/evaluator.py)
- **Record findings and replan.** `FindingPad` submits the selected finding code and an optional note from the visor. The backend checks the mission version and applies the finding rules. Once the observation is saved, the client requests a new route from the reached stop through the remaining objectives, with the original base as the return point. [Visor form](../../frontend/src/features/visor/FindingPad.tsx) · [Client observation and replanning flow](../../frontend/src/shared/api/client.ts)
- **Share the mission and save observations.** `get_mission_package()` bundles the plan, manifest, objectives, and image references used by the visor. The browser saves the package locally. If the explorer records a finding offline, the visor can queue it for submission when connectivity returns. [Mission package](../../backend/app/modules/missions/api/router.py) · [Observation queue](../../frontend/src/features/offline-sync/offline.ts)
- **Play back a simulated traverse.** The `/sim` view shows a walk with a scripted detour. `EvaSimulation.step()` advances the position and evaluates when to issue a route-deviation warning or replan. [Simulation engine](../../backend/app/modules/missions/simulation/engine.py) · [Demo view](../../frontend/src/features/simulation/SimVisor.tsx)

## 3. NASA Data & Resources Integration

- **Terrain and orbital imagery.** The Gale v3 mosaics published by USGS Astrogeology incorporate observations from HiRISE aboard the Mars Reconnaissance Orbiter. Mapte crops and reprojects the original 1 m elevation model to 4 m to calculate slope and ascent. It aligns the original 25 cm orthophoto with that terrain and prepares it at 2 m for the map. The slope derived from the model directly constrains routing. [Elevation model](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [Orthophoto](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **Surface locations and evidence.** Mapte projects the positions of Curiosity, part of the Mars Science Laboratory mission, into the terrain's coordinate system. Rover positions approximate the locations of science activities. Raw photographs provide a view from the surface. The catalog ties **Glen Torridon** to the study of clay minerals, **Gediz Vallis** to elemental sulfur, and **Marias Pass** to silica-rich rocks. [Curiosity waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Raw images](https://mars.nasa.gov/msl/multimedia/raw-images/)
- **Challenge alignment.** The map brings together topography, optical imagery, the route, and science stops. The team can plan in 2D and use the same itinerary in the visor. The challenge suggests combining at least three data types and considering imagery from the surface. Mapte includes geology as context for individual objectives. Dust, temperature, and radiation fall outside the scope of the data layers and route calculations. Hazard zones represent scenario conditions, and slope analysis is limited to what the grid can resolve. [NASA Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) · [Brief published by the Athlone local event](https://hackathlone.com/challenges/interplanetary-survival-guide-martian-map)

## 4. Impact & Expected Goals

**Gediz Vallis scenario.** With a **15°** slope limit, the planner calculated a **910 m** outbound route and a maximum modeled slope of **14.62°**. At 20 m/min and with 15 min for science activities, the plan included the stop and return with **480 min** of simulated support and a **60 min** reserve. When available support alone dropped to **120 min**, the planner excluded the stop because completing the itinerary would leave less than 60 min in reserve.

**Intended use.** In planning exercises, Mission Control can compare itineraries and explain why it includes or drops a stop. The explorer can relate that decision to the route's elevation, surface photographs, and planned activity. The pilot focuses on Mount Sharp. Applying the same method to another area would require preparing its terrain and imagery, checking their coverage, and building a local catalog of science objectives with documented evidence.

### Development strengths

- **Explainable decisions.** The plan distinguishes a route that violates constraints, a path that depends on uncertain terrain, and an insufficient reserve. Mission Control can identify what constrains a visit before adjusting the itinerary.
- **Traceable data.** The manifest ties terrain to its resolution and sources. The catalog preserves photo credits and places Curiosity stops in the map's coordinate frame. This lets users trace the terrain that constrains the route and the evidence behind each stop.
- **Continuity from planning to exploration.** Mission Control and the visor share a versioned plan. Findings go into the same mission, and replanning preserves the original base and completed objectives.

### Future improvements

- **Replanning and support estimates.** Carry the activity times from the initial plan forward when recording findings. Show observation confirmation and recalculation results separately, with an option to retry the latter.
- **Offline use.** Allow users to download the terrain, orthophoto, and photos before leaving. The visor could identify which assets are available locally and which require a connection.
- **Terrain coverage.** Verify elevation coverage and resolution before adding a region or using the terrain to analyze obstacles smaller than the current grid can resolve. Add science objectives with documented locations, imagery, and sources for each new area.

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
