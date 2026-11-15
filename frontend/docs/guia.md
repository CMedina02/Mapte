#  Guía de Desarrollo Frontend — Mars EVA Tactical System (v1)

Esta guía define la arquitectura, el stack tecnológico, las librerías, las reglas de negocio y la hoja de ruta paso a paso para el desarrollo del **Frontend (Dev 3)**, alineado al **Contrato de Integración v1** con FastAPI (Backend 1 & Backend 2).

---

## 1. Principios de Arquitectura y Rigor Científico

El frontend actúa como una **terminal táctica de visualización, planificación y registro en campo**, delegando todo cálculo geoespacial y de rutas al backend:

1. **Cero recálculo en el cliente:** El frontend nunca calcula pendientes, distancias, consumo de oxígeno ni rutas A\*. Únicamente renderiza las geometrías, métricas, advertencias y justificaciones entregadas por el backend.
2. **Proyección Cartesiana Local (No WGS84 / No GeoJSON):** Todas las posiciones utilizan coordenadas planas en metros (`x_m`, `y_m`) dentro del marco de referencia declarado por cada región marciana. Nunca se proyectan coordenadas terrestres.
3. **Manejo estricto de incertidumbre:** Si un dato falta (`null`) o el estado de una ruta es desconocido (`unknown`), la interfaz debe indicarlo explícitamente (*"Datos insuficientes / Desconocido"*). Jamás se sustituyen valores nulos por ceros ficticios ni se asumen condiciones seguras.
4. **Trazabilidad y Supuestos Visibles:** Toda estimación de oxígeno, tiempo o ruta mantiene visibles los supuestos del modelo y permite consultar los identificadores de evidencia científica (NASA/USGS) que respaldan cada capa o hallazgo.
5. **Control de Concurrencia:** Cada observación o contingencia incrementa la versión de la misión. Si ocurre un conflicto de versión con el servidor (`409`), la interfaz recupera automáticamente el estado más reciente antes de reintentar.

---

## 2. Stack Tecnológico y Librerías

* **Framework Principal:** **React 19** con **TypeScript** (manteniendo nomenclatura `snake_case` en los modelos de datos para coincidir exactamente con los esquemas Pydantic del backend).
* **Entorno de Construcción:** **Vite**, configurado con proxy hacia `/api` en desarrollo para comunicarse con FastAPI sin problemas de CORS.
* **Motor Cartográfico:** **OpenLayers (`ol`)**, elegido por su soporte nativo para proyecciones cartesianas personalizadas en metros e imágenes raster estáticas georreferenciadas localmente.
* **Estilos e Interfaz:** **Tailwind CSS** para el diseño responsivo (escritorio y tableta) con estética táctica de alto contraste, acompañado de **Lucide React** para iconografía técnica.
* **Gestión de Estado Global:** **React Context**, para administrar de forma centralizada la misión activa, su versión, el modo de vista (Mission Control vs. Explorer) y el estado de red.
* **Almacenamiento Offline y PWA:** **Vite PWA Plugin** junto con **localForage (localstorage)** para descargar, persistir y consultar el paquete de misión en tableta sin conexión a internet.
* **Vista 3D (FE-09):** **Three.js** con `@react-three/fiber` y `@react-three/drei` para el terreno inclinado del visor (Explorer/HUD). Trabaja en las mismas coordenadas cartesianas en metros que OpenLayers.

---

## 3. Estructura Modular del Proyecto

La aplicación se organiza en cinco módulos funcionales dentro de `frontend/src/`:

1. **Capa de Tipos y Contratos (`types/`):** Definiciones estrictas de regiones, manifiestos cartográficos, objetivos científicos, referencias fotográficas, resultados de rutas, misiones y errores HTTP.
2. **Capa de Comunicación y Mocks (`api/`):** Cliente HTTP centralizado con manejo de errores (`400`, `404`, `409`, `503`) y un adaptador de simulación (`mockAdapter`) que consume los ejemplos JSON oficiales para trabajar en paralelo mientras se completa el backend.
3. **Motor Cartográfico (`components/map/`):** Lienzo interactivo en OpenLayers con proyección local marciana, control de encendido/apagado de capas raster, ajuste de opacidad y renderizado de marcadores y polilíneas de ruta.
4. **Paneles Tácticos y Evidencia (`components/panels/` y `components/hud/`):** Barras de telemetría de recursos, registro explicable de decisiones, visor de fotografías en primera persona (Perseverance) y vista minimalista HUD.
5. **Vistas Principales (`pages/`):** Separación clara entre la estación de planificación (*Mission Control*) y la interfaz táctil de campo (*Explorer Mode*).

---

## 4. Integración de Endpoints P0

El flujo del frontend se conecta directamente con los endpoints esenciales del contrato:

* **Verificación y Catálogo Inicial:**
  * `GET /api/v1/health`: Comprueba disponibilidad del servidor al iniciar; si no hay conexión, habilita el modo offline si existe un paquete local.
  * `GET /api/v1/regions`: Pobla el selector inicial de regiones marcianas disponibles.
  * `GET /api/v1/regions/{region_id}/manifest`: Configura los límites del mapa en metros, la proyección local, las capas cartográficas y los créditos científicos.
  * `GET /api/v1/regions/{region_id}/objectives`: Posiciona los puntos de interés científico sobre el mapa con sus preguntas y actividades.
  * `GET /api/v1/regions/{region_id}/photos`: Carga fotografías de superficie vinculadas a cada objetivo, mostrando obligatoriamente su nivel de precisión (`verified`, `approximate` o `unknown`).

* **Planificación y Cálculo:**
  * `POST /api/v1/routes/compute`: Previsualiza trayectorias entre dos puntos y colorea la ruta según su viabilidad (`viable`, `not_viable` o `unknown`).
  * `POST /api/v1/missions/plan`: Genera la misión oficial, inicializa la versión, despliega la explicación del itinerario y establece el presupuesto de oxígeno y reserva de retorno.

* **Ejecución en Campo, Adaptación y Offline:**
  * `GET /api/v1/missions/{mission_id}`: Sincroniza el estado actual de la misión o resuelve conflictos de versión.
  * `POST /api/v1/missions/{mission_id}/observations`: Registra hallazgos científicos mediante códigos predefinidos y actualiza el plan si el motor decide reordenar objetivos.
  * `POST /api/v1/missions/{mission_id}/contingencies`: Simula fallas críticas (como reducción de oxígeno) para visualizar alertas y rutas alternativas de retorno.
  * `GET /api/v1/missions/{mission_id}/package`: Descarga el paquete integral de la misión en almacenamiento local para operar en tableta sin conexión.

---

## 5. Diseño Funcional por Fases

### Fase P0 — MVP Funcional (Indispensable para Demo)

1. **Mission Control (Planificación en Hábitat / PC):**
   * **Lienzo Central:** Mapa OpenLayers en coordenadas locales con marcadores de Base y Objetivos Científicos.
   * **Panel de Capas:** Controles de visibilidad y opacidad para capas óptica, elevación, pendiente y geología, con fichas de evidencia NASA/USGS.
   * **Panel de Planificación:** Selección de objetivos, configuración de restricciones de pendiente y velocidad, visualización de oxígeno vs. reserva de retorno, banner fijo de supuestos y botón para transferir el paquete offline.

2. **Explorer Mode (Tableta Táctica / Ground Truth):**
   * **Barra de Estado de Red:** Indicador explícito de estado (`Online`, `Offline - Paquete Local` o `Cambios Pendientes`).
   * **Tarjeta de Navegación:** Progreso hacia el objetivo activo, distancia restante, pendiente máxima y acceso a la vista fotográfica POV con etiqueta de precisión espacial.
   * **Registro de Observación:** Formulario guiado con selector cerrado de hallazgos científicos válidos que dispara la adaptación del plan y muestra la comparación antes/después en el historial de decisiones.
   * **Simulador de Contingencias:** Control para detonar escenarios de falla en tiempo real y evaluar rutas de regreso seguro.

### Fase P1 — Mejoras Visuales (Si hay margen tras P0)

* **Modo HUD Táctico (Visor de Casco):** Vista inmersiva de alto contraste dentro de *Explorer Mode*, inspirada en el visor del traje espacial, que oculta menús secundarios y deja visibles únicamente la brújula direccional, distancia al siguiente punto, elevación, recursos críticos y alertas en rojo.

---

## 6. Hoja de Ruta Paso a Paso (Plan de Ejecución)

1. **Paso 1 — Inicialización del Entorno:** Crear la aplicación con Vite, React, TypeScript, Tailwind CSS y OpenLayers; configurar el proxy de desarrollo hacia FastAPI.
2. **Paso 2 — Contratos y Simulación:** Definir las interfaces tipadas del Contrato v1 y conectar el adaptador de mocks con los JSON de ejemplo para construir toda la interfaz sin bloqueos.
3. **Paso 3 — Motor Cartográfico:** Implementar el mapa en OpenLayers con proyección cartesiana en metros, carga de capas estáticas y control de opacidad.
4. **Paso 4 — Flujo Mission Control:** Construir la selección de región, configuración de objetivos, previsualización de rutas y creación del plan de misión con su registro de decisiones.
5. **Paso 5 — Flujo Explorer Mode:** Desarrollar la vista táctil de campo, el visor de fotos con insignias de precisión, el registro de observaciones codificadas y el simulador de contingencias.
6. **Paso 6 — Modo Offline y PWA:** Integrar la descarga del paquete de misión en IndexedDB y los indicadores visuales de conectividad.
7. **Paso 7 — Integración Real y Pruebas:** Desactivar el modo mock, validar cada endpoint contra el servidor FastAPI del equipo, verificar manejo de errores (`409` y `503`) y pulir la vista HUD (P1) si el tiempo lo permite.