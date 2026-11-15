---
project: Mapte
language: en
ai_assistance:
  project_coding: [Claude, OpenAI Codex]
  document_drafting: OpenAI Codex
---

## 1. Project Summary (High-Impact Pitch)

**Mapte** is a web prototype for planning and simulating a scientific Marswalk on Mount Sharp in Gale Crater. It addresses the **Interplanetary Survival Guide: Martian Map** challenge for the 2026 NASA Space Apps Challenge. A mission control team selects a base and scientific targets. Mapte computes the route from Martian slopes and checks whether the simulated reserve covers the return. The explorer views the same itinerary in a 3D display, opens Curiosity photographs, and records observations at supported targets. If the plan excludes a stop, the panel explains which constraint prevented its inclusion. Data from two NASA missions serve complementary purposes. Mosaics derived from orbital observations determine where the route can go, and the rover catalog provides the scientific context for each destination. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)

## 2. What It Does & How It Works

- **Mission control.** On the 2D map, users select the base, the target order, and the slope, speed, support, and reserve limits. The planner checks the outbound leg, scientific activities, and return before accepting each target. If a constraint prevents further travel, it retains the portion of the itinerary that meets the model and explains which targets were excluded.
- **Routing engine.** The server derives slopes from the digital elevation model and searches a 4 m grid with A*. For long traverses, it first plots a corridor on a 20 m grid and then refines it with weighted A*. It avoids scenario exclusion zones, penalizes caution zones, and can avoid areas of unknown data quality. The corridor search can return a higher-cost route than the global optimum.
- **Explorer and visor.** The explorer can view photographs for each stop and navigate using a 3D terrain display, radar, and elevation profile, with a 2D map as a fallback. Position is simulated. When a finding rule exists, the backend records the observation, completes the target, and preserves the order of the remaining visits.
- **API, persistence, and offline operation.** FastAPI serves the catalog and mission operations. SQLite stores versions, routes, and events. The progressive web app saves the package in the browser and can queue observations for submission when connectivity returns. The API also implements recalculation in response to hazard reports and evaluates an early return under an oxygen contingency.
- **Life-support assumptions.** The calculation subtracts one minute of simulated support per minute elapsed and checks the return margin. Speed is configurable. The model excludes physiology, radiation, dust, temperature, and suit load.

## 3. NASA Data & Resources Integration

- **Mars Reconnaissance Orbiter (MRO), HiRISE.** Mapte uses two v3 Gale mosaics distributed by the USGS Astrogeology Science Center. The team reprojected the 1 m elevation model onto a 4 m grid to calculate slopes, ascent, and routes, and aligned the original 25 cm orthophoto, prepared at 2 m, with the terrain across a 10 × 10 km area. The browser also has lighter derivatives for demo mode. [USGS elevation](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [USGS orthophoto](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **Mars Science Laboratory (MSL), Curiosity.** The team projected localized rover positions into the terrain frame to locate three active targets: Glen Torridon, Gediz Vallis, and Marias Pass. The active catalog contains seven raw reference photographs. The coordinates locate the rover and approximate the site of scientific activity. The uncalibrated photographs provide visual context for the simulated activity. [Curiosity waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Raw images](https://mars.nasa.gov/msl/multimedia/raw-images/)
- **Evidence and uncertainty.** Catalog reports and publications explain the clays at Glen Torridon, elemental sulfur at Gediz Vallis, and silica and tridymite at Marias Pass. The demo hazard zones and mineral layer are synthetic. The orthophoto has gaps to the north, and artifacts in the eastern part of the elevation model limit slope estimation. The 4 m grid leaves smaller obstacles unresolved. The vertical datum is pending confirmation. [Gediz Vallis](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) · [Marias Pass](https://www.jpl.nasa.gov/news/rocks-rich-in-silica-present-puzzles-for-mars-rover-team/)

## 4. Impact & Expected Goals

**Expected benefit.** Mapte aims to help mission control staff and explorers in simulation exercises compare itineraries, understand an exclusion, and consult the scientific evidence for the next destination. Extending the pilot to another region would require preparing and verifying its terrain, imagery, and target catalog.

**Verified result.** In a local backend check using Gale data, Mapte computed a **910 m** traverse toward Gediz Vallis. The maximum modeled slope was **14.62°** under a **15°** limit. With **480 min** of simulated support and a **60 min** reserve, the backend generated a round trip and a package ready to sync. When support alone dropped to **120 min**, the plan excluded the target and explained that it could not preserve the return reserve. The interface built successfully and passed ESLint.

**Pending validation.** Of the 89 selected backend tests, 83 passed. The six failures concern planning expectations, a test package that references a disabled target, and the Marias Pass finding rules. Marias Pass is available as a destination, but the backend rejects its finding codes. End-to-end browser testing, access to all resources offline, and operational validation for a real EVA remain pending. [Development and validation](DESARROLLO_Y_VALIDACION.md)

## 5. Tools, Languages, Hardware & Software

- **Interface:** TypeScript, React, React DOM, Tailwind CSS, OpenLayers, Three.js, React Three Fiber, Drei, and Lucide React.
- **Build and progressive web app:** Node.js, pnpm, Vite, Vite PWA, Workbox, and ESLint. Browser storage holds the package and observation queue.
- **Backend, contract, and tests:** Python 3.12 in the verified environment, FastAPI, Pydantic, Uvicorn, SQLite, OpenAPI, and pytest.
- **Data preparation:** GDAL, Bash, and cURL to obtain and prepare the mosaics. NumPy and Pillow to generate browser derivatives.
- **Operating environment:** a web browser for Mission Control, Explorer, and the visor. Demo-specific hardware: not provided.

## 6. Artificial Intelligence (AI) Usage Statement

The team used **Claude** and **OpenAI Codex** mainly as coding assistants. The team defined the architecture, mission workflow, reasoning behind the algorithm’s emphasis on route safety, frontend design and organization, and development tools. Codex also helped review the repository, run checks, and draft this documentation. This statement and the file metadata identify that assistance. The team reported that it had applied no AI labels, credits, or notices to the other project materials.

## 7. References

- **USGS Astrogeology Science Center.** Gale v3 mosaics. HiRISE credit recorded in the project metadata: NASA/JPL/University of Arizona. [MSL Gale Merged DEM Mosaic, 1 m](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) · [MSL Gale Merged Orthophoto Mosaic, 25 cm](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)
- **NASA/JPL-Caltech, Mars Science Laboratory.** Curiosity localized waypoints and raw images. Source version: not provided. [Waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Raw images](https://mars.nasa.gov/msl/multimedia/raw-images/)
- **Glen Torridon and Gediz Vallis.** Emily Lakdawalla, The Planetary Society (2019), overview of the Aberlady and Kilmarie drill sites. NASA/JPL (2024), report on elemental sulfur and mission update for sols 4219–4221. [Aberlady and Kilmarie](https://www.planetary.org/articles/curiosity-update-sols-2313-2387) · [Elemental sulfur](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) · [Mission update](https://science.nasa.gov/blog/sols-4219-4221-its-a-complex-morning)
- **Marias Pass.** Abbey et al. (2020), Curiosity drilling campaign, *Icarus*. Morris et al. (2016), evidence of tridymite at Gale Crater, *PNAS*, 113(26), 7071–7076. NASA/JPL (2015), report on silica-rich rocks. [Abbey et al.](https://www-robotics.jpl.nasa.gov/media/documents/1-s2.0-S0019103520302657-main_look_back_drilling_on_curiosity_part_ii.pdf) · [Morris et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4932983/) · [NASA/JPL report](https://www.jpl.nasa.gov/news/rocks-rich-in-silica-present-puzzles-for-mars-rover-team/)
- **Interface and build.** [React and React DOM 19.3.1](https://react.dev/) · [TypeScript 6.0.3](https://www.typescriptlang.org/) · [Tailwind CSS 4.3.5](https://tailwindcss.com/) · [OpenLayers 10.11.0](https://openlayers.org/) · [Three.js 0.187.0](https://threejs.org/) · [React Three Fiber 9.8.2](https://r3f.docs.pmnd.rs/) · [Drei 10.7.9](https://github.com/pmndrs/drei) · [Lucide React 1.73.0](https://lucide.dev/) · [Node.js](https://nodejs.org/) · [pnpm](https://pnpm.io/) · [Vite 8.3.8](https://vite.dev/) · [Vite PWA 2.0.0](https://vite-pwa-org.netlify.app/) · [Workbox 7.4.1](https://developer.chrome.com/docs/workbox/) · [ESLint 10.15.0](https://eslint.org/)
- **Backend and data.** [Python 3.12](https://docs.python.org/3.12/) · [FastAPI 0.163.0](https://fastapi.tiangolo.com/) · [Pydantic 2.14.3](https://docs.pydantic.dev/) · [Uvicorn 0.54.0](https://www.uvicorn.org/) · [SQLite](https://www.sqlite.org/) · [OpenAPI](https://www.openapis.org/) · [pytest 9.2.0](https://docs.pytest.org/) · [GDAL](https://gdal.org/) · [Bash](https://www.gnu.org/software/bash/) · [cURL](https://curl.se/) · [NumPy](https://numpy.org/) · [Pillow](https://python-pillow.org/)
- **Project.** The source code and local setup instructions document the prototype. The public demonstration link is pending. [Mapte repository](https://github.com/CMedina02/Mapte) · [Backend setup](../../backend/README.md) · [Running the prototype](DESARROLLO_Y_VALIDACION.md#ejecución-local)
