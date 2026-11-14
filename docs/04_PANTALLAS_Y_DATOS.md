# 05. Matriz de pantallas y datos del frontend

**Dos modos; un motor; tres superficies visuales:** Mission Control (PC/hábitat), Explorer (tableta PWA) y HUD simulado como vista reducida de Explorer.

| Pantalla / componente | Datos necesarios | API / fuente | Estados que debe manejar |
|---|---|---|---|
| Selector de región | región, descripción, disponibilidad | `GET /regions` | cargando, sin regiones, error |
| Mapa y selector de capas | CRS local, límites, capas, URL de assets, evidencia | `GET /regions/{id}/manifest` | cargando, NoData, offline, error |
| Panel de ciencia | objetivos, preguntas, actividades, prioridades | `GET /regions/{id}/objectives` | sin cobertura, seleccionado |
| Ground Truth Explorer | imagen, instrumento, fecha, sol, ubicación/calidad | `GET /regions/{id}/photos?objective_id=...` | foto aproximada, sin foto, offline |
| Planificador | base, objetivos, restricciones, recursos | `POST /missions/plan` | calculando, no viable, desconocido |
| Comparador de rutas | geometrías, distancias, pendientes, alertas | `POST /routes/compute` | calculando, parcial, error |
| Dashboard de misión | estado, ruta, objetivos completados, alertas | `GET /missions/{id}` | misión no encontrada, versión |
| Formulario de observación | lista de posibles resultados por objetivo, notas | `POST /missions/{id}/observations` | guardando, conflicto 409, offline |
| Panel de contingencia | tipo de falla, posición, recursos disponibles | `POST /missions/{id}/contingencies` | viable/no viable/unknown |
| Preparar Explorer | paquete completo + archivos listados | `GET /missions/{id}/package` | descargando, espacio insuficiente |
| Explorer Navigation | ruta, próxima parada, fotos, estado | `Mission` local/cache | offline, datos obsoletos |
| HUD simulado | siguiente punto, estado de recursos, alerta prioritaria | `Mission` local | atención crítica, sin datos |

## Flujo de interacción

```text
Mission Control
  -> seleccionar región
  -> cargar manifest y capas
  -> elegir objetivos (con su evidencia)
  -> planificar misión
  -> consultar ruta y margen modelado
  -> preparar paquete offline
Explorer / tableta
  -> abrir paquete
  -> seguir ruta simulada (NO GPS terrestre en Marte)
  -> consultar fotografía de rover
  -> registrar observación codificada
  -> cambiar próximo objetivo si reglas lo justifican
  -> activar falla simulada y evaluar retorno
  -> mostrar y exportar resultados de misión
```

## Acuerdos de interfaz

- En pantalla siempre distinguir: **observación NASA**, **dato derivado**, **modelo**, **escenario simulado**, **sin datos**.
- No presentar oxígeno, radiación o clima como telemetría real si no existe una fuente específica.
- La navegación es una **simulación**: el navegador/tableta no conoce su posición real en Marte.
- Alertas con texto e iconos, no solo color; controles táctiles amplios; acciones críticas accesibles en Explorer sin menús profundos.
- Capas cartográficas tienen una leyenda y referencia a fuente/fecha/resolución.
- Fotos se etiquetan como ubicación `verified`, `approximate` o `unknown` y muestran crédito original.
- El paquete offline contiene una versión del plan y lista de assets; mostrar si los datos quedan obsoletos.
- Al reconectar, en P0 se ofrece **exportación/importación manual** de observaciones; la sincronización automática es P1.

## Datos falsos de desarrollo

Los archivos `../contracts/examples/*.json` usan IDs `demo-*`, valores sintéticos y la referencia `DEMO_LOCAL_MARS_V1`. Son solo para desarrollar y probar la interfaz. Antes de la presentación científica, reemplazarlos por archivos de fuentes verificadas y mantener escenarios hipotéticos etiquetados.
