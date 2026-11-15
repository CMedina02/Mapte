# Mapte

**In Curiosity’s wheel tracks**  
NASA Space Apps Challenge 2026 · [Abandoned but not Forgotten](https://www.spaceappschallenge.org/2026/challenges/nasas-discarded-equipment-storytelling/)

[The story](#detailed-project-description) · [NASA data](#nasa-data-and-resources) · [Run locally](#run-mapte-locally) · [Demo](#demo-for-judges)

## High-level project summary

Curiosity’s sky crane stayed on Mars after lowering the rover onto its wheels. Years later, one of those wheels cracked open a rock containing yellow sulfur crystals. **Mapte** is a web experience that invites students and space enthusiasts to explore the connection between the hardware and the discoveries it made possible. Visitors plan a simulated walk across real Mount Sharp terrain, explore sites studied by Curiosity in a 3D viewer, and examine rover photographs. The experience asks visitors to make and explain a decision of their own. Can they reach the site, investigate it, and return to base with the planned reserve? [Curiosity’s landing](https://science.nasa.gov/resource/scene-of-a-martian-landing/) · [Sulfur discovery](https://www.jpl.nasa.gov/images/pia26307-curiosity-captures-close-up-of-sulfur-crystals/)

## Detailed project description

### From landing hardware to a scientific discovery

In 1997, Mars Pathfinder used airbags to land and deploy Sojourner. Fifteen years later, Mars Science Laboratory used a rocket-powered descent stage to lower Curiosity on cables. After releasing the rover, the stage flew away and crashed. From orbit, the HiRISE camera photographed the rover and the landing sites of the heat shield, parachute and backshell, and descent stage. These two missions introduce the engineering choices that got scientific instruments onto Martian soil. Mapte then takes visitors to Curiosity’s science stops on Mount Sharp. [NASA Mars Pathfinder](https://science.nasa.gov/mission/mars-pathfinder/) · [NASA Scene of a Martian Landing](https://science.nasa.gov/resource/scene-of-a-martian-landing/)

In 2024, Curiosity drove over a rock in **Gediz Vallis** and broke it open. **MAHLI**, a close-up camera on the rover’s robotic arm, photographed the crystals. The **Alpha Particle X-Ray Spectrometer (APXS)** helped identify the material as elemental sulfur. That rock was nicknamed _Convict Lake_. Mapte’s stop in the same channel is **Mammoth Lakes**, where Curiosity drilled another rock. Together the sites give visitors a question to investigate. What can you see in a photograph, and what do you need an instrument to measure? [Convict Lake close-up and measurement](https://www.jpl.nasa.gov/images/pia26307-curiosity-captures-close-up-of-sulfur-crystals/) · [Mammoth Lakes panorama](https://www.jpl.nasa.gov/images/pia26363-curiosity-takes-a-360-degree-view-of-gediz-vallis-channel/)

| Stop in Mapte                             | What Curiosity did and what visitors can investigate                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Marias Pass · Buckskin**                | Curiosity drilled a silica-rich rock. **CheMin** analyzed the powdered sample with X-rays and identified tridymite. What can a mineral tell us about the history of a rock? [NASA ARES](https://ares.jsc.nasa.gov/missions/msl/important-discoveries.cfm)                                                                                    |
| **Vera Rubin Ridge · Highfield**          | Curiosity drilled a gray outcrop on a ridge whose hematite signal had attracted attention from orbit. What can scientists learn by sampling a site directly? [NASA Highfield campaign](https://science.nasa.gov/blog/sol-2224-go-for-drilling-at-highfield/) · [NASA ARES](https://ares.jsc.nasa.gov/missions/msl/important-discoveries.cfm) |
| **Glen Torridon · Aberlady and Kilmarie** | The rover drilled two targets and **CheMin** found abundant clay minerals. What clues can water leave behind when it interacts with sediment? [NASA/JPL Glen Torridon findings](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-finds-a-clay-cache/)                                                                                |
| **Gediz Vallis · Mammoth Lakes**          | **Mastcam** photographed the channel and the robotic arm after drilling at Mammoth Lakes. The sulfur discovery nearby provides an example of how imaging and chemical measurements answer different questions. [NASA/JPL Gediz Vallis campaign](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) |

### What visitors do

1. **Plan the walk.** In Mission Control, choose a base and science stops on the 2D map. Set the maximum slope, walking pace, time at each stop, available support, and return reserve. Mapte checks the outward and return legs before accepting each stop. The panel shows route metrics and explains any exclusions.
2. **Explore the terrain.** Open the same itinerary in the 3D viewer and consult the compass, radar, and elevation profile. The destination card presents a science question, activities, and photographs from Curiosity. A 2D view is available as a fallback.
3. **Record a finding.** At a stop, choose an observation from the simulated scenario and add an optional note. The backend validates the observation and saves a new mission version. The client requests a revised itinerary from the current position for the remaining stops and the return to the original base.
4. **Watch a route change.** The `/sim` view runs a separate, preconfigured walk toward Gediz Vallis. A scripted deviation shows how the backend detects that the explorer has left the route and calculates a replacement from the simulated position.

Mapte is designed for school-age learners and casual space enthusiasts. A class can split into mission-control and explorer roles, compare itineraries, and explain what evidence supports a particular finding. The learning goal is for visitors to connect a piece of engineering to an observation and explain a decision using evidence. The locations and photographs come from the real mission. The walk, hazard scenarios, support budget, and findings entered by visitors are simulated.

## NASA data and resources

| Source                                                                                                          | How Mapte uses it                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Gale merged elevation mosaic v3**, published by USGS Astrogeology using HiRISE and other orbital observations | The original 1 m product is cropped and reprojected over a 10 × 10 km sector. Mapte uses the 4 m derivative to calculate elevation, slope, ascent, and routes. [USGS elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)                                                                                                                                           |
| **Gale merged orthophoto mosaic v3**, published by USGS Astrogeology                                            | The original 25 cm product is prepared at 2 m and aligned with the elevation data. It provides the map imagery and the basis for the browser’s visual assets. [USGS orthophoto mosaic](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm)                                                                                                                           |
| **Curiosity waypoints**, NASA/JPL-Caltech                                                                       | The selected positions locate science stops in the same local coordinate frame as the map, `MARS_GALE_MS_LOCAL_V1`. They approximate the locations of field activities. [Mars Science Laboratory waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json)                                                                                                                       |
| **Curiosity surface imagery**, NASA/JPL-Caltech and instrument teams                                            | The viewer connects rover photographs to the sites and science questions. The catalog records the target, camera, Martian day, credit, and provenance. [Curiosity image gallery](https://mars.nasa.gov/msl/multimedia/raw-images/) · [Mapte photo catalog](backend/app/modules/catalog/data/mc23-gale-mount-sharp/photos.json)                                                                         |
| **Mars Pathfinder and Sojourner**, NASA Science                                                                 | This submission uses Pathfinder’s landing and deployment account as a historical comparison in the educational narrative. The Athlone Space Apps event lists the NASA mission page among its challenge resources. [NASA Mars Pathfinder](https://science.nasa.gov/mission/mars-pathfinder/) · [Athlone challenge resources](https://hackathlone.com/challenges/nasas-discarded-equipment-storytelling) |

The topography influences whether a stop fits the itinerary. Curiosity’s waypoints determine where the visitor goes, and the photographs show what the rover saw at the site. The organizer’s Global Awards guidance calls for use of a NASA source listed in the challenge resources. The Pathfinder page is used in this submission’s narrative. Its status for that eligibility criterion remains to be confirmed. [Official challenge resources](https://www.spaceappschallenge.org/2026/challenges/nasas-discarded-equipment-storytelling/?tab=resources) · [Organizer clarification](https://github.com/nasa/spaceapps/discussions/1849)

## Architecture and development

| Component                             | Implementation                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web application**                   | React, TypeScript, Vite, and Tailwind CSS. OpenLayers renders the 2D map. Three.js, React Three Fiber, and Drei render the 3D viewer. Visitors use a web browser with WebGL for 3D. Compatible devices can also provide orientation input. [Frontend](frontend/src)                                                                                                                       |
| **Catalog and terrain**               | Python, FastAPI, and Pydantic serve the region manifest, terrain, objectives, and photographs. GDAL, Bash, and cURL prepare the geospatial files. NumPy and Pillow produce lighter browser assets. [Catalog](backend/app/modules/catalog) · [Terrain pipeline](backend/scripts/terrain/build_gale_mount_sharp.sh) · [Browser assets pipeline](frontend/scripts/import_backend_terrain.py) |
| **Routes and support**                | A\* searches a 4 m grid, with an optional 20 m corridor search for longer routes. The planner accounts for slope, terrain quality, and scenario hazards, then evaluates whether each stop fits with a return to base. [Routing](backend/app/modules/missions/routing) · [Mission planner](backend/app/modules/missions/planning/planner.py)                                               |
| **Mission state and synchronization** | SQLite retains mission versions and events. The browser stores a mission package and a local queue for observations. Workbox and Vite Plugin PWA cache web assets. Use a network connection for remote rover photos during the demo. [Persistence](backend/app/modules/missions/persistence/sqlite.py) · [Browser synchronization](frontend/src/features/offline-sync/offline.ts)         |
| **API and simulation**                | The versioned OpenAPI contract covers catalog queries, routing, mission lifecycle, observations, and simulation. The backend advances each simulated walk in steps and maintains sessions in memory. [OpenAPI contract](contracts/openapi.yaml) · [Simulation engine](backend/app/modules/missions/simulation/engine.py)                                                                  |

The three-person team divided work across the frontend, scientific catalog, and mission planning backend. Early planning considered Jezero. The team chose Mount Sharp for the implementation to bring elevation, imagery, and Curiosity’s science stops into one coordinate system. The frontend and backend initially worked from shared contracts and sample responses, then integrated terrain processing, route planning, persistence, and the viewer. [Initial development plan](docs/03_PLAN_COMPLETO.md) · [Terrain manifest and provenance](backend/data/regions/mc23-gale-mount-sharp/derived/terrain.json)

The support budget uses one simulated minute per minute of walking or activity. The route calculation depends on the 4 m terrain grid and treats the eastern strip with lower-quality slope data as uncertain. Route results apply to the educational scenario. [Support model](backend/app/modules/missions/resources/evaluator.py) · [Terrain metadata](backend/data/regions/mc23-gale-mount-sharp/derived/terrain.json)

## Run Mapte locally

These commands use **Windows PowerShell** with Git, Python 3.12, Node.js 22, and pnpm. The terrain derivatives needed to run the application are included in the repository.

```powershell
git clone https://github.com/CMedina02/Mapte.git
Set-Location Mapte
```

### 1. Start the API

From the repository root, run the following in the first terminal.

```powershell
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c constraints.txt -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Keep the terminal open. Use one Uvicorn process so simulation requests share the same in-memory sessions. [API health](http://127.0.0.1:8000/api/v1/health) · [Interactive API reference](http://127.0.0.1:8000/docs)

### 2. Start the web application

From the repository root in a second terminal, run the following.

```powershell
Set-Location frontend
pnpm.cmd install --frozen-lockfile
$env:VITE_USE_MOCK = 'false'
pnpm.cmd dev --host 127.0.0.1
```

`VITE_USE_MOCK=false` selects the FastAPI catalog and route planner. Vite forwards `/api` requests to port `8000`. Use the address printed by Vite. Open Mission Control and the viewer in two tabs of the same browser on the same host and port.

| View                                     | Default address                                            |
| ---------------------------------------- | ---------------------------------------------------------- |
| Mission Control                          | [http://127.0.0.1:5173/](http://127.0.0.1:5173/)           |
| Explorer viewer                          | [http://127.0.0.1:5173/visor](http://127.0.0.1:5173/visor) |
| Simulated walk with a scripted deviation | [http://127.0.0.1:5173/sim](http://127.0.0.1:5173/sim)     |

## Demo for judges

1. **Start with the evidence.** Show the yellow crystals. Explain what the wheel exposed, what the camera captured, and what APXS measured. [MAHLI photograph, NASA/JPL-Caltech/MSSS](https://www.jpl.nasa.gov/images/pia26307-curiosity-captures-close-up-of-sulfur-crystals/)
2. **Plan a visit to Gediz Vallis.** In Mission Control, choose a nearby base north of the stop and select **Gediz Vallis**. Under **Settings**, use a 15° maximum slope, a 1.2 km/h walking pace, 15 minutes at the stop, eight hours of support, and a 60-minute return reserve. Select **Plan**.
3. **Open the viewer.** Once Mission Control has loaded the mission package, open `/visor` in the same browser. Use **Details** to inspect the rover photographs and **Arrived** to open the simulated observation form.
4. **Change one input.** Keep the base, stop, and other settings. Reduce **Available oxygen** to two hours, recalculate, and show why the stop is excluded. Use the API example below to reproduce the exact base position.

### Reproduce the planning comparison

With FastAPI running, the following example uses base coordinates **(5300, 3700) m** and keeps the terrain, destination, and activity duration fixed.

```powershell
$objective = 'obj-gediz-vallis-mammoth-lakes'
$payload = @{
    region_id = 'mc23-gale-mount-sharp'
    base_position = @{ x_m = 5300; y_m = 3700; frame_id = 'MARS_GALE_MS_LOCAL_V1' }
    objective_ids = @($objective)
    constraints = @{ max_slope_deg = 15; speed_m_per_min = 20; avoid_unknown = $true }
    resources = @{ oxygen_available_min = 480; return_reserve_min = 60 }
    activity_durations_min = @{ $objective = 15 }
}
foreach ($support in 480, 120) {
    $payload.resources.oxygen_available_min = $support
    $request = @{
        Uri = 'http://127.0.0.1:8000/api/v1/missions/plan'
        Method = 'Post'
        ContentType = 'application/json'
        Body = ($payload | ConvertTo-Json -Depth 6)
    }
    $plan = Invoke-RestMethod @request
    [pscustomobject]@{
        SupportMin = $support
        Stops = $plan.objective_ids.Count
        Legs = $plan.legs.Count
        Alerts = $plan.alerts -join ', '
    }
}
```

| Available support | Observed result                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **480 min**       | The itinerary includes Gediz Vallis and the return to base. The outward leg is **910.44 m**, with a maximum modeled slope of **14.62°**. The full visit consumes **106.33 min** of simulated support, leaving **313.67 min** above the required reserve. |
| **120 min**       | The planner excludes Gediz Vallis because the round trip would leave less than 60 minutes in reserve. The retained itinerary stays at the base and returns an `OBJECTIVE_EXCLUDED` alert.                                                                |

### Evidence for the evaluation criteria

| Criterion        | What the demo shows                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impact**       | A visitor can explain how an instrument turned a surprising observation into evidence about a Martian rock.                                                |
| **Creativity**   | The experience turns a rover science story into a decision the visitor makes in a map, an itinerary, and a 3D landscape.                                   |
| **Validity**     | The comparison uses identical terrain and mission inputs apart from the support budget. The results show how an explicit constraint changes the itinerary. |
| **Relevance**    | The story links landing hardware to the instruments it delivered, and NASA observations shape where visitors can go and what they can investigate.         |
| **Presentation** | One discovery carries the audience from the photo to the route and the return decision.                                                                    |

**Suggested demo narration.** “Curiosity’s sky crane stayed on Mars after setting the rover down on its wheels. Years later, one of those wheels cracked a rock open and revealed yellow crystals. In Mapte, you can visit the site, see the rover’s evidence, and decide whether your team has enough support to get home.”

## Use of artificial intelligence (SI)

The team defined Mapte’s concept, architecture, mission workflow, planning criteria, and interface design. **Claude and OpenAI Codex** were used as coding assistants. **OpenAI Codex** also assisted with repository review and drafting this documentation. This declaration and the Markdown metadata identify that assistance. [NASA Space Apps guidance on AI disclosure](https://github.com/nasa/spaceapps/discussions/1849)
