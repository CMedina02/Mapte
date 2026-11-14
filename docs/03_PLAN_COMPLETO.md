# 03. Plan completo de desarrollo — Mars Resilience Lab

**Proyecto:** *One Mission, Two Perspectives* · **Equipo:** 1 Frontend + 2 Backend · **Fecha objetivo:** NASA Space Apps 2026, 14–15 noviembre.

## 1. Problema y propuesta

NASA solicita una **vista hiperlocal, integrada y por capas** de una región/ruta en Marte que combine datos de varias misiones para planificar y realizar una caminata científica de forma informada, considerando seguridad. No basta con reproducir Mars Trek.

**Propuesta:** crear una experiencia conectada entre **Mission Control** (PC/hábitat) y **Explorer Mode** (tableta) con HUD simulado opcional. El astronauta planifica, recibe un paquete de misión, consulta observaciones orbitales/superficiales, registra un hallazgo simulado y obtiene un ajuste justificable del próximo objetivo, con evaluación de retorno ante una falla.

**Innovación que debemos demostrar:** *ciencia adaptativa con trazabilidad* — una observación modifica la siguiente decisión de misión cuando la evidencia y las reglas lo justifican; la modificación respeta las restricciones declaradas.

## 2. Alcance y límites

### P0 (hacer sí o sí)

1. Un sector de Jezero verificado donde coincidan **al menos tres tipos de datos útiles** y fuentes de varias misiones (óptica, topografía, geología; una cuarta capa térmica/espectral solo si aporta).
2. Mapa interactivo con capas, leyendas, procedencia y calidad de los datos.
3. 2–3 objetivos geológicos sustentados en publicaciones y fotografías de rover con ubicación validada o incertidumbre declarada.
4. Ruta calculada sobre terreno, restricciones de pendiente, tiempo y reserva de regreso.
5. Una misión con objetivos, actividades y una observación **simulada** que reordena o conserva la siguiente parada por reglas explícitas.
6. Una contingencia hipotética (por ejemplo, reducción de oxígeno) que reevalúa la viabilidad del retorno.
7. Mission Control (PC) y Explorer (tableta), con paquete consultable offline tras precarga.
8. Prueba de extremo a extremo, documentación de fuentes y presentación verificable.

### P1 (si P0 ya es confiable)

- HUD visual de casco, no casco real; gráfico de plan original vs. adaptado; informe exportable; sincronización automática; optimizador de intervención con rover o depósito de apoyo.

### Fuera de alcance para concurso

- Garantías de seguridad reales; telemetría/meteorología actual sin fuente validada; modelado fisiológico certificado; rastreo GPS terrestre del astronauta; IA que invente observaciones o resultados; aplicaciones nativas separadas; sistema multiusuario complejo.

## 3. Arquitectura y tecnologías

```text
                  NASA / USGS / PDS
                         |
             Pipeline Python (preparación)
                         |
     Datos estáticos + Evidencia + Manifest por región
                         |
                 FastAPI modular
           /catalog              /missions
       (Backend 1)             (Backend 2)
                         |
                   API /api/v1
                         |
                 Cliente TypeScript
                         |
            React + OpenLayers + PWA
                /               \
        Mission Control        Explorer (tableta)
                                    |
                               HUD simulado
```

| Capa | Elección | Justificación |
|---|---|---|
| UI | React + TypeScript + Vite | Trabajo rápido y componentes compartidos. |
| Mapa | OpenLayers (+ Proj4 cuando corresponda) | Capas raster/vector y proyecciones personalizadas. |
| Backend | Python + FastAPI + Pydantic | Contratos OpenAPI y dos equipos backend en un servicio. |
| Pipeline científico | GDAL/Rasterio, NumPy, GeoPandas/Shapely cuando se necesiten | Reproyección, recorte, datos ráster y vectoriales. |
| Rutas | A* sobre cuadrícula recortada; optimizaciones solo si hacen falta | Determinismo y validación. |
| Persistencia | SQLite simple (misiones), archivos preparados (mapas), IndexedDB (Explorer) | No construir BD distribuida. |
| Offline | PWA + Service Worker, manifiesto de assets | Leer paquete de misión sin Internet. |
| Testing | Pytest, Vitest, Playwright, Ruff, ESLint/TypeScript | Pruebas de riesgo alto antes que cobertura masiva. |
| Colaboración | GitHub, ramas feature, PR y CI | Módulos desacoplados con integraciones frecuentes. |

**Decisión consciente:** antes consideramos un backend opcional con Web Workers. Ahora se elige **FastAPI como interfaz central** porque el equipo tiene dos desarrolladores backend y exige endpoints comunes. Los cálculos más pesados están en el servidor; frontend puede hacer render y tareas ligeras en Workers. La PWA permite consulta offline de datos previamente exportados, no cálculo remoto sin servidor.

## 4. Organización del monorepo

```text
mars-resilience-lab/
├── apps/web/                    # Frontend: React, OpenLayers, PWA
│   └── src/{app,features,shared,services}
├── services/api/                # FastAPI único
│   ├── app/main.py
│   ├── app/core/                # configuración, errores, contratos
│   ├── app/modules/catalog/     # Backend 1
│   ├── app/modules/missions/    # Backend 2
│   └── tests/
├── tools/data_pipeline/        # Backend 1, scripts y tests científicos
├── contracts/
│   ├── openapi.yaml
│   └── examples/
├── data/
│   ├── manifests/              # metadatos pequeños rastreados
│   └── processed/              # datasets grandes ignorados de Git
├── docs/
└── .github/workflows/
```

**No subir** GeoTIFF grandes, cachés de Python, `node_modules`, `.env`, contraseñas ni tokens. Descargas originales deben conservar enlace y checksum, no subirse si no son necesarios.

## 5. Flujo funcional de la misión

1. **Iniciar:** seleccionar región y cargar manifest de capas; mostrar su CRS y leyendas.
2. **Ciencia:** elegir una pregunta geológica; cargar objetivos y fotografías con fuentes.
3. **Planificar:** seleccionar base, objetivos, restricciones y reserva; calcular ruta/estado.
4. **Transferir:** generar paquete a Explorer, descargar/cargar assets para modo offline.
5. **Explorar:** consultar ruta, siguiente parada e imágenes de rover en tableta.
6. **Observar:** registrar hallazgo con `finding_code` válido; el motor cambia o mantiene prioridades de forma auditable.
7. **Contingencia:** simular falla; calcular si existe retorno válido bajo el modelo; si no, mostrar `not_viable`/`unknown`.
8. **Cerrar:** mostrar recorrido, decisión original vs adaptada, fuentes, límites y lecciones.

## 6. Reglas de seguridad y honestidad científica

- **Escala:** no inferir rocas pequeñas ni obstáculos invisibles a la resolución del DEM; usar máscara NoData.
- **Coordenadas:** distinguir Marte de la Tierra; declarar radio/datum/convensión, proyección y unidades; rutas internas en marco local `x_m/y_m/frame_id`.
- **Fotografías:** el sol y la cámara no aseguran geolocalización; relacionar imágenes con PDS/recorrido y declarar `location_quality`.
- **Radiación/clima:** no presentar valores históricos de otra ubicación como condiciones actuales. Si no se modelan, quedan informativos.
- **Recursos:** oxígeno y velocidad son parámetros **simulados**, no datos reales de un astronauta.
- **Riesgo:** mostrar `unknown` ante evidencia insuficiente; no usar un simple icono verde para prometer seguridad.
- **API:** validar entradas con Pydantic; límites de payload/rate limit razonables; CORS solo para orígenes usados; no exponer secretos.
- **Front:** evitar render HTML no confiable, sanitizar contenido, no confiar en datos del cliente como fuente de verdad científica.
- **Supply chain:** lockfiles, revisión de dependencias y permisos mínimos en GitHub Actions.
- **Disponibilidad:** demo que pueda ejecutarse localmente con assets esenciales; contingencia si no hay Internet.

## 7. Clean Code / SOLID sin sobreingeniería

- Una responsabilidad por componente: catálogo ≠ planificación ≠ presentación.
- Capa de dominio independiente de librerías cartográficas; casos de uso testeables y deterministas.
- Interfaces pequeñas en límites reales; no crear interfaces o clases vacías por moda.
- Dependencias hacia contratos de dominio; integraciones externas por adaptadores.
- Nombres consistentes y unidades en campos (`distance_m`, `duration_min`).
- TypeScript `strict`, Pydantic, Ruff, ESLint/Prettier y pruebas esenciales.
- Cambios en contrato OpenAPI y fixtures revisados por el equipo antes de fusionar.

## 8. Estrategia paralela en tres ramas

| Desarrollador | Propietario de | Comienza con | Sale de su módulo |
|---|---|---|---|
| Backend 1 | `tools/data_pipeline`, `api/modules/catalog` | manifest y objetivos mock + inventario de datos | catálogo verificable y assets listos |
| Backend 2 | `api/modules/missions` | terreno/objetivos sintéticos del contrato | rutas, planes, observaciones, contingencias, paquete |
| Frontend | `apps/web` | `MockApiClient` desde `contracts/examples` | PC + tableta navegables desde primera integración |

**Regla:** integrar cada 2–4 horas en `main` con PR revisado; no esperar al final. Si un módulo aún falta, el cliente funciona con su mock etiquetado.

## 9. Plan del hackathon (~39 h de ventana de entrega)

| Horas desde comienzo oficial | Prioridad | Puerta de salida |
|---|---|---|
| 0–3 | Repo + contratos + mocks | Desarrollo paralelo sin bloqueos. |
| 3–11 | Mapa/territorio + backend de misiones + UI | Cada módulo funciona con test básico. |
| 11–19 | Primera integración E2E sintética | Se ve todo el ciclo sin cambiar datos manualmente. |
| 19–27 | Reemplazar con datos de Marte verificados; ciencia adaptativa | Demo fundamentada; si falta, reducir alcance. |
| 27–33 | PWA/tableta, seguridad, evidencia y prueba | Demo estable sin dependencia crítica externa. |
| 33–39 | Video, publicación, materiales y entrega | No incorporar funciones nuevas. |

*No confundir la duración de dos días del evento con las ~39 h entre las 9:00 del sábado y las 23:59 del domingo.* Ajustar siempre a la **zona horaria del evento local del dueño del equipo**.

## 10. Pruebas críticas

1. Un cambio de marco de coordenadas no debe alterar erróneamente la distancia del recorrido.
2. El planificador no puede atravesar terrenos declarados intransitables; NoData debe marcarse desconocido.
3. Reducir consumibles disponibles no debe aumentar el conjunto de rutas viables, con todo lo demás constante.
4. Una observación sin `finding_code` autorizado no puede cambiar el objetivo por inferencia libre.
5. `mission_version` antiguo produce `409` y no sobrescribe cambios posteriores.
6. Mission Control y Explorer muestran el mismo estado a partir del mismo paquete versionado.
7. Abrir Explorer offline después de precargar funciona, y muestra qué funciones dejan de estar disponibles.
8. Todas las evidencias y fotos que se muestran tienen enlaces y crédito visibles.

## 11. Criterio de terminado

Cada entrega debe: compilar, respetar el contrato, mostrar errores, pasar pruebas de riesgo principal, no filtrar secretos, incluir citas científicas cuando aplique y poder demostrarse en el flujo completo.

## 12. Reglas del concurso que impactan la ejecución

- NASA Space Apps 2026 es **14–15 de noviembre**; el equipo oficial indicó **no iniciar el proyecto antes del 14 de noviembre a las 9:00 a. m. locales del evento**; sí permite investigación/preparación del equipo.
- Para elegibilidad global debe utilizarse **al menos una fuente NASA incluida en la pestaña Recursos del desafío** y citar **todas** las fuentes, software, texto e imágenes usados.
- La fecha límite publicada es **15 de noviembre, 11:59 p. m. de la zona horaria asignada al equipo**.
- Revisar el [Project Submission Guide 2026](https://www.spaceappschallenge.org/resources/project-submission-guide) para duración/formato de la demo, idioma y declaraciones de uso de IA; no copiar requisitos de 2025 como si fueran actuales.

**Referencias:** [NASA Space Apps 2026](https://www.spaceappschallenge.org/2026/); [equipo organizador — reglas de preparación](https://github.com/nasa/spaceapps/discussions/1827); [equipo organizador — hora y entrega](https://github.com/nasa/spaceapps/discussions/1916).
