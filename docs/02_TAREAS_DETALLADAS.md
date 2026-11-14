# 02. Backlog detallado y asignación de tareas

**Equipo:** Frontend (F), Backend 1 datos/ciencia (D), Backend 2 misión/seguridad (M). Tareas transversales (C/Q) corresponden a todos. **P0 = obligatorio**; **P1 = solo con MVP integrado**.

> Los tres desarrolladores arrancan **en paralelo**, después de acordar el contrato de datos. Las dependencias se resuelven con `contracts/examples`, no esperando al código del compañero.

## Vista compacta del trabajo

| ID | Dueño | Tarea | Prioridad |
|---|---|---|---|
| C01 | Todos | Validar alcance, región piloto y demostración | P0 |
| C02 | Todos | Congelar API/OpenAPI, tipos y mocks | P0 |
| C03 | Todos | Configurar Git, repo, revisión y CI mínimo | P0 |
| D01 | Backend 1 | Inventario y licencia/procedencia de datos NASA/USGS | P0 |
| D02 | Backend 1 | Pipeline de recorte, reproyección y NoData | P0 |
| D03 | Backend 1 | Manifest de región y capas cartográficas | P0 |
| D04 | Backend 1 | Catálogo de objetivos y geología | P0 |
| D05 | Backend 1 | Fotografías Perseverance y ubicación | P0 |
| D06 | Backend 1 | Validación científica y paquetes de activos | P0 |
| M01 | Backend 2 | Grafo de terreno y cálculo de rutas | P0 |
| M02 | Backend 2 | Restricciones, tiempos y consumibles simulados | P0 |
| M03 | Backend 2 | Planificación de misión y paradas | P0 |
| M04 | Backend 2 | Observaciones y adaptación científica | P0 |
| M05 | Backend 2 | Contingencias y retorno | P0 |
| M06 | Backend 2 | Estado y exportación de paquete | P0 |
| M07 | Backend 2 | Optimizador de apoyo preventivo | P1 |
| F01 | Frontend | Cliente de API + adaptador mock | P0 |
| F02 | Frontend | Mission Control y mapa OpenLayers | P0 |
| F03 | Frontend | Planificador, ciencia y Ground Truth | P0 |
| F04 | Frontend | Explorer táctil para tableta | P0 |
| F05 | Frontend | PWA y lectura offline de misión | P0 |
| F06 | Frontend | HUD y comparación visual avanzada | P1 |
| Q01 | Todos | Integración y pruebas del flujo completo | P0 |
| Q02 | Todos | Seguridad, calidad científica y rendimiento | P0 |
| Q03 | Todos | Video, referencias y entrega | P0 |

---

## Tareas compartidas — primeros acuerdos

### C01 — Validar alcance, región piloto y demostración [P0]
- **Objetivo:** escoger un **sector pequeño** con solapamiento verificado entre elevación, geología y fotografías, y escribir un escenario científico concreto.
- **Entrada:** enunciado NASA y catálogos Mars Trek/USGS/Perseverance/PDS.
- **Entrega:** ficha de región, dos o tres objetivos, una observación con posibles resultados y una falla simulada; criterios P0/P1 aprobados.
- **Aceptación:** los tres pueden explicar la misma demostración; ninguna fuente es presentada como cobertura confirmada sin verificar.
- **Dependencias:** ninguna; antes de generar algoritmos sobre datos reales.

### C02 — Congelar API, coordenadas y fixtures [P0]
- **Objetivo:** acordar `openapi.yaml`, errores, estados `viable/not_viable/unknown`, CRS local marciano y unidades.
- **Entrada:** `docs/01_CONTRATO_FRONT_BACK.md` y `contracts/openapi.yaml`.
- **Entrega:** contratos aprobados y ejemplos JSON con IDs coherentes; un canal explícito para solicitar cambios.
- **Aceptación:** frontend renderiza fixtures y backend valida payloads con esquemas; nadie cambia claves sin PR.
- **Dependencias:** C01 para valores reales; no impide uso de fixtures ficticios iniciales.

### C03 — Repo, ramas y CI inicial [P0]
- **Objetivo:** crear la estructura modular, `.gitignore`, `README`, reglas de Git y verificaciones rápidas.
- **Entrega:** monorepo con `apps/web`, `services/api`, `tools/data_pipeline`, `contracts` y `docs`; `main` estable.
- **Aceptación:** otra persona puede clonar, levantar proyecto vacío y ejecutar el linter/test de cada stack.
- **Dependencias:** inicio oficial del hackathon para crear/implementar el entregable concursante.

---

## Backend 1 — Scientific Data & Terrain

### D01 — Inventario y evidencias NASA/USGS [P0]
- **Objetivo:** seleccionar productos ópticos, topográficos, geológicos y fotografías con solapamiento en la región.
- **Entrada:** Mars Trek, USGS SIM 3464, HiRISE/CTX, Perseverance Raw Images y PDS.
- **Entrega:** `DATA_SOURCES.md` con URLs, misiones, instrumentos, fechas, resolución, crédito, restricciones y fuente NASA de la pestaña Recursos.
- **Aceptación:** al menos tres categorías útiles y varias misiones; no confundir datos históricos con condiciones actuales.
- **Dependencias:** C01.

### D02 — Preparación geoespacial [P0]
- **Objetivo:** recortar una zona viable, transformar su referencia espacial al marco local en metros, generar derivados de pendiente y registrar NoData.
- **Entrada:** datos D01 y su información de proyección (no usar WGS84 terrestre por defecto).
- **Entrega:** datasets optimizados, metadata de transformaciones, checksums y scripts repetibles con GDAL/Rasterio.
- **Aceptación:** las distancias/posiciones pueden comprobarse con puntos de control; las celdas NoData se mantienen desconocidas.
- **Dependencias:** D01; el diseño del formato ya está en C02.

### D03 — Endpoints de regiones y manifest [P0]
- **Objetivo:** exponer la región, límites del marco local, capas, URL de assets y leyendas para OpenLayers.
- **API:** `GET /regions`, `GET /regions/{id}/manifest` y recursos estáticos preprocesados.
- **Entrega:** respuestas conformes a OpenAPI y catálogo de capas consistente.
- **Aceptación:** frontend carga al menos mapa base, elevación/pendiente y geología; cada capa incluye evidencia.
- **Dependencias:** C02; al inicio usar manifest mock, luego D02.

### D04 — Catálogo de objetivos científicos [P0]
- **Objetivo:** asociar objetivos de investigación con unidades geológicas o evidencias verificables.
- **API:** `GET /regions/{id}/objectives`.
- **Entrega:** 2–3 objetivos con pregunta científica, posición, actividades y `finding_code` válidos.
- **Aceptación:** el objetivo existe dentro de la región; los pesos de prioridad aparecen como parámetros del escenario, no puntuación científica NASA.
- **Dependencias:** D01, C02.

### D05 — Catálogo de fotografías Ground Truth [P0]
- **Objetivo:** vincular fotografías de rover con objetivos/sols/instrumentos y reportar calidad de geolocalización.
- **API:** `GET /regions/{id}/photos?objective_id=...`.
- **Entrega:** 10–20 imágenes seleccionadas optimizadas, créditos, fechas, enlaces originales y precisión de ubicación.
- **Aceptación:** imágenes sin localización fiable se etiquetan `approximate`/`unknown`; no se inventa orientación de cámara.
- **Dependencias:** D01, D04.

### D06 — Pruebas de datos y entrega offline [P0]
- **Objetivo:** verificar cobertura, tamaño de archivos, consistencia de sistema de coordenadas y referencias citables.
- **Entrega:** manifiesto/paquete de activos con hashes; tests Python de límites, capas y metadatos; archivos precargables en tableta.
- **Aceptación:** no existen capas fuera de la extensión declarada sin aviso; se distingue qué recursos se pueden abrir sin Internet.
- **Dependencias:** D02–D05.

---

## Backend 2 — Mission Intelligence & Safety

### M01 — Algoritmo de rutas [P0]
- **Objetivo:** calcular ruta desde origen a destino sobre una representación del terreno que evita celdas intransitables y marca desconocidas.
- **API:** `POST /routes/compute`.
- **Entrega:** ruta en coordenadas del marco local, distancia, ascenso, pendiente máxima, duración bajo supuestos y advertencias.
- **Aceptación:** casos manuales de cuadrícula conocidos; nunca atravesar pendientes/celdas prohibidas ni etiquetar NoData como seguro.
- **Dependencias:** C02; iniciar con cuadrícula sintética y conectar D02 después.

### M02 — Motor de restricciones y recursos [P0]
- **Objetivo:** evaluar duración, movilidad, reserva de retorno y disponibilidad de recursos hipotéticos.
- **Entrada:** ruta M01 y límites configurados (`oxygen_available_min`, `return_reserve_min`, etc.).
- **Entrega:** evaluador puro con `viable/not_viable/unknown`, `assumptions` y explicaciones de límites incumplidos.
- **Aceptación:** menos recursos no puede aumentar rutas viables si las demás condiciones no cambian; no prometer seguridad real.
- **Dependencias:** M01 parcial; se puede probar con rutas ficticias.

### M03 — Planificador de misión [P0]
- **Objetivo:** combinar base, orden de objetivos, ruta, actividades y recursos en una misión reproducible.
- **API:** `POST /missions/plan`, `GET /missions/{id}`.
- **Entrega:** `Mission` versionada con paradas, próximo objetivo y `decision_log`.
- **Aceptación:** todos los IDs referencian objetivos del catálogo; el plan tiene alternativa de retorno o estado explícito de no viabilidad.
- **Dependencias:** C02; fixtures para objetivos, M01–M02.

### M04 — Observaciones y planificación adaptativa [P0]
- **Objetivo:** cambiar o conservar la siguiente parada **solo** con reglas explícitas asociadas al `finding_code`.
- **API:** `POST /missions/{id}/observations`.
- **Entrega:** registro inmutable de la observación, nueva versión de misión y justificación legible.
- **Aceptación:** no se inventan hallazgos científicos con IA; entrada inválida rechazable; versión obsoleta produce `409`.
- **Dependencias:** M03, D04 o fixtures de objetivos.

### M05 — Falla y retorno [P0]
- **Objetivo:** simular `oxygen_reduced` o `rover_unavailable` y recalcular qué opción de retorno satisface el modelo.
- **API:** `POST /missions/{id}/contingencies`.
- **Entrega:** ruta de regreso, margen bajo parámetros o estado `not_viable/unknown`, acompañado de advertencias.
- **Aceptación:** en un escenario de falta de datos no se declara viabilidad; la falla y el resultado quedan auditados.
- **Dependencias:** M01–M03.

### M06 — Paquete de misión y persistencia mínima [P0]
- **Objetivo:** permitir llevar la misión a Explorer sin depender de una consulta HTTP para cada pantalla.
- **API:** `GET /missions/{id}/package`.
- **Entrega:** JSON autocontenido con versión, ruta, objetivos, fotos/metadatos y lista de assets precargables; guardar misiones en SQLite simple o repositorio equivalente.
- **Aceptación:** el paquete funciona en un cliente desconectado una vez cacheado; informa de activos faltantes y estado de sincronización.
- **Dependencias:** M03 y D03–D05 o fixtures.

### M07 — Optimizar intervención preventiva [P1]
- **Objetivo:** comparar ruta alternativa y posición de vehículo de apoyo para un escenario seleccionado.
- **Entrega:** alternativas con costos e indicadores, sin garantizar supervivencia.
- **Aceptación:** resultados cuantificables y reproducibles; no retrasa P0.
- **Dependencias:** M05 integrado, datos reales suficientes.

---

## Frontend — Mission Control & Explorer

### F01 — Cliente tipado y mocks [P0]
- **Objetivo:** desacoplar interfaz de endpoints aún no terminados mediante `ApiClient` y `MockApiClient`.
- **Entrada:** `openapi.yaml` y `contracts/examples/*.json`.
- **Entrega:** hooks/servicios tipados, estados de carga/error y pruebas de renderizado con mocks.
- **Aceptación:** frontend navega toda la demostración sin el backend conectado; mismos formatos en mock y HTTP.
- **Dependencias:** C02; sin bloqueo con B1/B2.

### F02 — Mission Control y mapa [P0]
- **Objetivo:** mostrar selector de región, capas, posición, leyendas y procedencia de fuentes con OpenLayers.
- **API:** `GET /regions`, `GET /regions/{id}/manifest`.
- **Entrega:** dashboard responsivo y visor cartográfico marciano (no reproyección WGS84 implícita).
- **Aceptación:** zoom/selección, visualización correcta del CRS, avisos en celdas sin datos; no bloquea interfaz.
- **Dependencias:** F01; fixtures D03.

### F03 — Ciencia, rutas y Ground Truth [P0]
- **Objetivo:** permitir objetivos/actividades, ver fotografías verificadas, solicitar ruta y planificar misión.
- **API:** `GET /objectives`, `GET /photos`, `POST /routes/compute`, `POST /missions/plan` (rutas completas en contrato).
- **Entrega:** lista de paradas científicas, comparador básico de rutas y panel de evidencia.
- **Aceptación:** seleccionar objetivo -> plan calculado -> rutas y fotos con créditos visibles.
- **Dependencias:** F01 y mocks.

### F04 — Explorer Mode táctil [P0]
- **Objetivo:** optimizar para tableta horizontal: siguiente parada, navegación, fotos, observaciones, estado y regreso.
- **API:** misión actual, `POST /observations`, `POST /contingencies` y datos del paquete.
- **Entrega:** pantallas táctiles, estados `viable/not_viable/unknown`, mensajes de situación simulada.
- **Aceptación:** flujo operativo en viewport de tableta; controles utilizables con tacto; no depende del GPS de la Tierra.
- **Dependencias:** F01, M03 mock.

### F05 — PWA y offline [P0 básico]
- **Objetivo:** instalar Explorer como PWA y consultar paquete de misión/activos sin conexión.
- **API:** `GET /missions/{id}/package`, archivos estáticos listados.
- **Entrega:** manifest PWA, service worker, cache verificado, observaciones locales con indicador `pending`.
- **Aceptación:** tras precargar, desactivar Internet y consultar ruta, objetivos y fotos seleccionadas sin error; si no se puede, explicar qué falta.
- **Dependencias:** F04, M06/fixtures.

### F06 — HUD y comparador avanzado [P1]
- **Objetivo:** vista de casco **simulada**, minimalista, con siguiente punto, advertencia y recursos; comparación visual plan anterior/actual.
- **Entrega:** componentes reutilizando `Mission`, sin motor de decisiones duplicado.
- **Aceptación:** no distrae ni retrasa la ruta principal; se etiqueta HUD simulado.
- **Dependencias:** F04/flujo completo estable.

---

## Integración, calidad y entrega

### Q01 — Integración vertical [P0]
- **Objetivo:** conectar progresivamente módulos reales siguiendo el escenario completo.
- **Entrega:** recorrido Mission Control → plan → paquete → Explorer → observación → contingencia → resultado.
- **Aceptación:** al menos un test E2E y demo repetible sin editar datos manualmente entre pantallas.
- **Dependencias:** C02; empezar con mocks desde las primeras horas.

### Q02 — Ciberseguridad, calidad y validación [P0]
- **Objetivo:** proteger integridad y disponibilidad de la demo; comprobar algoritmos, dispositivos, fuentes y límites.
- **Entrega:** lint, TypeScript strict, Ruff/Pytest, Vitest/Playwright esenciales, validación Pydantic, revisión dependencias, secretos y CORS.
- **Aceptación:** cero claves privadas en git; errores representables; fuentes y supuestos documentados; móvil/tableta probado.
- **Dependencias:** continuamente desde C03.

### Q03 — Documentación, presentación y envío [P0]
- **Objetivo:** explicar problema, datos NASA empleados, innovación, arquitectura, demo y limitaciones para jurado.
- **Entrega:** README reproducible, DATA_SOURCES/VALIDATION, capturas, material breve para demo y enlace verificable de presentación.
- **Aceptación:** los enlaces funcionan en ventana privada; fuentes/créditos/uso de IA declarados conforme a la guía vigente; envío antes del límite.
- **Dependencias:** integración suficientemente estable; documentación empieza paralelamente.

---

## Ritmo recomendado de integración

| Corte aproximado | Resultado comprobable | Si falla |
|---|---|---|
| Hora 0–3 | Contrato + repositorio + fixtures + ejecución básica | Corregir antes de crear más endpoints. |
| Hora 3–11 | Front con mocks, Backend 1 con región y Backend 2 con ruta ficticia | Mantener interfaces estables. |
| Hora 11–19 | Flujo E2E con plan, observación y fallo, al menos sobre región sintética | Congelar funciones P1. |
| Hora 19–27 | Sustitución de datos sintéticos por fuentes verificadas; ajustes científicos | Reducir región o número de objetivos. |
| Hora 27–33 | Offline/tableta, calidad, documentación y comparación | Priorizar estabilidad y envío. |
| Hora 33–39 | Video, validación, publicación y entrega con margen | No agregar funciones nuevas. |

**Definición de terminado:** requisito funcional cumplido + contrato respetado + estados de error manejados + prueba mínima + evidencia citada si aplica + merge a `main` sin romper la demostración.
