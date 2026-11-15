---
project: Mapte
language: es
reviewed_code: 4a8878b6c416817af4c90c42f48a450a096faf3f
ai_assistance:
  project_coding: [Claude, OpenAI Codex]
  document_drafting: OpenAI Codex
---

# Mapte · Desarrollo, validación y revisión de entrega

15 de noviembre de 2026. Revisión del código en `4a8878b`. Usar [PROJECT_EN.md](PROJECT_EN.md) para la página de Space Apps y [PROYECTO_ES.md](PROYECTO_ES.md) como versión equivalente en español.

## Estado de la entrega

| Elemento | Estado y evidencia |
| --- | --- |
| Título, resumen, descripción, datos, referencias y declaración de IA | Redactados en los dos idiomas. Para el formulario oficial, usar la sección 1 como resumen, las secciones 2, 4 y 5 como descripción, la 3 para NASA Data, la 6 para AI/SI y la 7 para References. Al copiar el texto, sustituir los enlaces relativos por sus URLs públicas verificadas. |
| Demo pública | Pendiente. La organización pide un enlace accesible sin permisos especiales a un video de hasta 30 segundos o una presentación de hasta siete diapositivas, incluidas portada y cierre. Si el video está en español, añadir subtítulos en inglés. [Formato e idioma](https://github.com/nasa/spaceapps/discussions/1973) |
| Proyecto final | El [repositorio público](https://github.com/CMedina02/Mapte) es el enlace candidato. Comprobar en ventana privada que el código, la documentación de esta entrega y los archivos de terreno estén en la rama pública. El formulario pide un enlace al proyecto y otro a la demo. [Enlaces de entrega](https://github.com/nasa/spaceapps/discussions/1991) |
| Datos NASA para elegibilidad global | El uso de observaciones de MRO y datos de Curiosity está comprobado. La coincidencia con una fuente de la pestaña Resources del reto sigue pendiente. La organización exige incorporar al menos una de esas fuentes de forma significativa. Véase la comparación debajo. [Regla del equipo organizador](https://github.com/nasa/spaceapps/discussions/1849) |
| Asistencia y etiquetado de IA | La declaración y los metadatos de estos Markdown identifican las herramientas y su uso. El equipo informó que todavía no había etiquetado los demás materiales. Revisar las piezas que se generaron con IA y completar, donde aplique, el reconocimiento en descripción y metadatos de código, datos y audio o la marca visible en imágenes y videos. Verificar también las condiciones de marca para cualquier pieza generada. [Reglas de IA](https://github.com/nasa/spaceapps/discussions/1849) |
| Envío oficial | Pendiente de verificación. Confirmar reto, registro, sede del equipo y términos en la pestaña Project de la página del equipo. El cierre general publicado es el **15 de noviembre de 2026 a las 23:59, hora local de la sede del propietario del equipo**. Revisar si la sede tiene requisitos locales adicionales. [Calendario oficial](https://www.spaceappschallenge.org/2026/) · [Zona horaria del equipo](https://github.com/nasa/spaceapps/discussions/1916) · [Campos de entrega](https://github.com/nasa/spaceapps/discussions/1858) |

La guía central y la pestaña oficial del reto no cargaron durante la revisión. Para los requisitos generales se usaron aclaraciones de la organización y para comparar la lista del reto se consultó la copia de HackAthlone, sede local de Space Apps. Esa copia lista Mars Trek, USGS–NASA Planetary Geologic Mapping Program, *Curiosity’s Proposed Path up Mount Sharp*, NASA Worldview y el archivo de imágenes de Perseverance. En Mapte, Mars Trek aparece como referencia del escenario simulado. Las capas que intervienen en el cálculo proceden de los mosaicos de Gale del USGS y el catálogo usa posiciones e imágenes **de Curiosity**. La procedencia revisada no establece que esos archivos se hayan obtenido del programa de cartografía geológica ni del mapa propuesto de Curiosity. Confirmar una integración efectivamente usada con la organización o incorporar y demostrar una fuente de la lista antes de declarar cumplido el requisito global. [Resources del reto](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=resources) · [Copia de la sede HackAthlone](https://hackathlone.com/challenges/interplanetary-survival-guide-martian-map) · [Mapa propuesto de Curiosity](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/)

## Evolución del proyecto

| Etapa | Desarrollo y evidencia |
| --- | --- |
| Alcance y contrato | El plan inicial propuso Jezero. El prototipo eligió Monte Sharp, cráter Gale, para combinar relieve, ortofoto y paradas de Curiosity en un marco local. Los ejemplos iniciales del contrato contienen escenarios ficticios. El contrato vigente se exporta desde FastAPI. [Plan inicial](../03_PLAN_COMPLETO.md) · [OpenAPI vigente](../../contracts/openapi.yaml) |
| Interfaz y simulación | React y TypeScript incorporaron mapa cartesiano, selección de base y objetivos, capas, Explorer, avisos, cola local y visor con instrumentos de navegación. Los primeros flujos funcionan con un adaptador simulado y los mismos tipos de API. [Cliente HTTP y modos](../../frontend/src/shared/api/client.ts) · [Simulador](../../frontend/src/shared/api/mockAdapter.ts) |
| Datos y catálogo | El proceso de GDAL recorta y reproyecta el sector de 10 × 10 km. Publica elevación a 4 m, ortofoto a 2 m, metadatos y sumas SHA-256. El proceso de frontend crea un relieve a 20 m y versiones más ligeras de la ortofoto y el mapa de normales. Se añadieron posiciones y fotos de Curiosity con créditos y limitaciones. [Proceso GDAL](../../backend/scripts/terrain/build_gale_mount_sharp.sh) · [Proceso para navegador](../../frontend/scripts/import_backend_terrain.py) · [Metadatos de terreno](../../backend/data/regions/mc23-gale-mount-sharp/derived/terrain.json) |
| Enrutamiento y soporte | El motor incorporó A* con restricciones de pendiente, calidad del dato y zonas de riesgo. El plan usa trayectos de ida y vuelta y tiempos de visita para evaluar soporte y reserva. Las optimizaciones posteriores añadieron rejillas precalculadas, caché, límite de búsqueda y refinamiento por corredor. [Motor de rutas](../../backend/app/modules/missions/routing/planner.py) · [Planificador](../../backend/app/modules/missions/planning/planner.py) · [Evaluación de soporte](../../backend/app/modules/missions/resources/evaluator.py) |
| Ciclo y persistencia de misión | SQLite guarda versiones y eventos. La API planifica, consulta y actualiza el progreso, valida observaciones, empaqueta la misión y ofrece operaciones para riesgos, contingencia de oxígeno y comparación de apoyo preventivo. Las operaciones de cambio usan versiones esperadas para detectar conflictos. [Persistencia](../../backend/app/modules/missions/persistence/sqlite.py) · [API de misiones](../../backend/app/modules/missions/api/router.py) |
| Integración y ajustes de interfaz | Mission Control, Explorer y el visor comparten el estado de misión mediante el paquete local y las consultas al backend. El visor puede planificar desde una posición simulada cuando está sin misión y usa 2D como respaldo del 3D. El panel y el radar muestran el trayecto asociado a una exclusión. La simulación de contingencia se retiró de la interfaz actual y la capacidad permanece en la API. [Panel](../../frontend/src/features/mission-control/MissionControl.tsx) · [Visor](../../frontend/src/features/visor/Visor.tsx) · [Visor sin plan asignado](../../frontend/src/features/visor/IdleVisor.tsx) |

## Arquitectura y trazabilidad

```text
Mosaicos de Gale USGS (observaciones MRO/HiRISE) → GDAL → relieve y ortofoto
Ubicaciones, fotos y antecedentes de Curiosity → catálogo en el marco local

Relieve + objetivos + restricciones simuladas → FastAPI → A* y evaluación de reserva
                                                        → SQLite: plan y eventos
                                                        → paquete de misión
Mission Control (mapa 2D) ↔ Explorer (fotos y hallazgos) ↔ visor (3D, radar y perfil)
```

- **Marco común.** `MARS_GALE_MS_LOCAL_V1` utiliza una proyección transversa de Mercator sobre una esfera de Marte, centrada cerca de 4,75° S y 137,40° E. La elevación y la ortofoto comparten el recorte. El DEM operativo se almacena como `float32` y sus metadatos indican resolución, cobertura, identificadores de evidencia y limitaciones. [Contrato de terreno](../../backend/app/modules/catalog/domain/terrain_contract.py)
- **Catálogo científico.** Glen Torridon (Aberlady y Kilmarie), Gediz Vallis (Mammoth Lakes) y Marias Pass (Buckskin) son los tres objetivos activos. Highfield quedó desactivado en el catálogo actual. Cada objetivo relaciona posición, pregunta científica, hallazgos posibles y evidencia. Las fotografías incluyen cámara, sol, crédito y calidad de ubicación. [Objetivos y referencias](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/objectives.json) · [Créditos por fotografía](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/photos.json)
- **Decisión y retorno.** El planificador verifica los objetivos en el orden solicitado. Si una parada impediría confirmar el regreso con reserva, deja fuera esa parada y las siguientes. La viabilidad que devuelve corresponde al itinerario retenido y puede corresponder a permanecer en la base. El motor distingue agotamiento del presupuesto de búsqueda, terreno incierto e inviabilidad por restricciones. [Planificador](../../backend/app/modules/missions/planning/planner.py) · [Servicio de rutas](../../backend/app/modules/missions/routing/service.py)
- **Separación del escenario.** El relieve y la ortofoto derivan de observaciones. Los polígonos de riesgo, el mapa mineral del modo simulado, la posición del explorador y el soporte en minutos son parte del escenario. El modo simulado puede utilizar un trazado en línea recta cuando el backend cae. Un resultado de ese modo no equivale al cálculo A* del backend. [Riesgos del escenario](../../backend/app/modules/catalog/data/mc23-gale-mount-sharp/hazards.json) · [Modos del cliente](../../frontend/src/shared/api/client.ts)
- **Desconexión.** El navegador guarda el paquete y una cola de observaciones en almacenamiento local. El service worker tiene una regla de caché para `/assets/`. Los archivos que sirve el backend en `/api/v1/assets/` y las fotografías remotas requieren una comprobación propia en condiciones de desconexión. Un paquete `ready_to_sync` confirma que el backend lo pudo construir con los archivos locales declarados. La disponibilidad de todos los recursos en el navegador sigue pendiente de verificación. [Reglas de caché](../../frontend/vite.config.ts) · [Cola](../../frontend/src/features/offline-sync/offline.ts)

## Ejecución local

En una terminal PowerShell, desde la raíz de Mapte:

```powershell
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c constraints.txt -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

En otra terminal PowerShell, desde la raíz de Mapte:

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
$env:VITE_USE_MOCK = 'false'
pnpm dev
```

Abrir la URL que indique Vite para Mission Control y añadir `/visor` para el visor en el mismo navegador. FastAPI expone el [esquema interactivo en local](http://127.0.0.1:8000/docs). Se puede omitir la creación del entorno virtual y la instalación cuando las dependencias ya están preparadas. El entorno de revisión usó Python 3.12.4, Node.js 22.14.0 y pnpm 12.21.0. [Entorno y datos del backend](../../backend/README.md)

## Evidencia y límites de validación

- **Terreno real.** Se cargó `mc23-gale-mount-sharp` y se invocaron los manejadores del catálogo, rutas y planificación directamente, con SQLite temporal. Base local `(5300, 3700)` m, destino `obj-gediz-vallis-mammoth-lakes`, pendiente límite `15°`, velocidad `20 m/min`, terreno desconocido excluido, actividad de `15 min`, soporte simulado de `480 min` y reserva de `60 min`. La ruta de ida devolvió `viable`, 910,44 m, 14,62° de pendiente máxima y 45,52 min modelados. El plan conservó dos tramos y un margen de 313,67 min por encima de la reserva. El catálogo devolvió tres objetivos activos y siete imágenes. El paquete devolvió `ready_to_sync`. Estos valores describen ese escenario y sus parámetros. [Pruebas de rutas con terreno real](../../backend/scripts/bench_routes.py)
- **Comparación con la misma ruta.** Al cambiar solo el soporte disponible de 480 a 120 min y mantener la reserva en 60 min, el plan pasó de uno a cero objetivos. La segunda respuesta incluyó `OBJECTIVE_EXCLUDED:obj-gediz-vallis-mammoth-lakes` y registró la falta de margen para regresar con la reserva. Esta comparación comprueba una decisión del planificador usando el mismo terreno, destino y tiempos de actividad.
- **Compilación.** `pnpm build` y `pnpm lint` completaron correctamente. Vite generó el service worker y avisó que algunos paquetes de JavaScript superan 500 kB minificados.
- **Pruebas del backend.** Se repitieron 89 pruebas seleccionadas. Resultado: 83 aprobadas y seis fallidas, más tres subpruebas aprobadas. Para este recuento se excluyeron `test_foundation.py`, `test_catalog_router.py` y `test_route_api.py`. El flujo completo HTTP, navegador y desconexión queda por verificar en conjunto.

```powershell
# Desde backend, con el entorno virtual preparado
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
.\.venv\Scripts\python.exe -m pytest -q --tb=no --ignore=tests/test_foundation.py --ignore=tests/catalog/test_catalog_router.py --ignore=tests/missions/test_route_api.py
```

| Fallos reproducidos | Qué falta comprobar o resolver |
| --- | --- |
| Cuatro en planificación | Una prueba espera el texto anterior del registro de decisión. Las otras mantienen expectativas anteriores para duraciones desconocidas, soporte insuficiente y tramos inalcanzables. Verificar que la presentación distingue el plan solicitado del itinerario retenido, sobre todo si no queda ningún objetivo. |
| Uno en el paquete de misión | La prueba selecciona Highfield, desactivado en el catálogo. El empaquetado devuelve un error al intentar incluirlo. Probar por separado el paquete con un objetivo activo y la compatibilidad con misiones que ya hacen referencia a Highfield. |
| Uno en reglas de hallazgo | Buckskin está activo, pero sus tres códigos en Marias Pass carecen de regla. El backend devuelve un error al registrar esos hallazgos. Para una demostración del registro usar un objetivo compatible, como Gediz Vallis, previa comprobación en navegador. |

Las elevaciones tienen un datum pendiente de confirmación. En el este, la calidad de pendiente se marca como desconocida por artefactos del DEM. Hay huecos reales de ortofoto al norte y los obstáculos pequeños no se resuelven en la rejilla de 4 m. El modelo de soporte es simulado y la prueba local no establece seguridad operativa en Marte.

## Evidencia para el jurado

| Criterio | Qué evidencia puede mostrar el equipo |
| --- | --- |
| Impacto | La comparación de Gediz Vallis muestra cómo pasar de 480 a 120 min de soporte cambia la decisión, con la misma reserva y el mismo relieve. La exclusión se refleja en el itinerario y se explica en el panel. |
| Creatividad | El mismo plan versionado sirve al panel y al visor del explorador. En el visor, el perfil y el radar hacen visible el relieve y la dirección de la marcha. |
| Validez | Los parámetros y unidades de la prueba de Gediz Vallis permiten repetir el cálculo. El estado de cada tramo, la reserva y las zonas inciertas hacen explícitos los límites del modelo. |
| Relevancia | El DEM de Gale modifica qué rutas se pueden calcular. Las ubicaciones y fotos del rover determinan qué destino se visita y qué evidencia se consulta. Verificar también la coincidencia con Resources para la evaluación global. |
| Presentación | El caso de Gediz Vallis conecta una decisión del panel, su recorrido en el visor y una fotografía de Curiosity en el mismo escenario. Los valores comprobados y las etiquetas de simulación ayudan a interpretar el resultado. |

**Best Use of Data** es la categoría que mejor encaja con la evidencia disponible, si la organización confirma la elegibilidad global. La integración transforma elevaciones orbitales en restricciones de recorrido y vincula posiciones y fotos del rover con destinos científicos. [Guía de evaluación y premios](https://www.spaceappschallenge.org/resources/judging-awards-guide/)
