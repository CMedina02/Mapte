# 01. Contrato de integración — Frontend ↔ Backend

**Versión de diseño:** `v1` · **Estado:** propuesta pendiente de aprobación conjunta · **Ruta base:** `/api/v1`.

## A. Decisión de arquitectura

- **Backend 1 (Data & Science):** prepara conjuntos NASA/USGS, cartografía, catálogo geológico, objetivos y fotografías; expone consultas de catálogo. No adjudica coordenadas exactas a fotos si no están verificadas.
- **Backend 2 (Mission & Safety):** calcula rutas, planifica expediciones, registra observaciones y evalúa contingencias; usa datos y objetos del Backend 1 mediante contratos internos, no llamadas HTTP entre dos backends.
- **Frontend:** React/TypeScript + OpenLayers. Puede programar en paralelo con los JSON de `contracts/examples`. El modo Explorer prepara una PWA para tableta; HUD es una vista dentro de Explorer.
- **Servicio:** un FastAPI modular, **no dos servicios**. `OpenAPI` es la fuente de verdad. En desarrollo `Vite` redirige `/api` a FastAPI; en demo se favorece mismo origen mediante proxy o servicio que sirva ambos.
- **Sin conexión:** el paquete de misión se guarda localmente y contiene datos necesarios; sin conexión no se prometen consultas nuevas al backend ni sincronización en vivo. Cambios locales se marcan como pendientes.

## B. Contratos y convenciones innegociables

| Aspecto | Contrato |
|---|---|
| Transporte | HTTPS en despliegue; JSON UTF-8 en `/api/v1`; recursos cartográficos como archivos estáticos preparados. |
| Nombres | `snake_case` en JSON para coincidir con Pydantic; TypeScript puede conservarlo al tipar. |
| Identificadores | `string` estable (`region_id`, `objective_id`, `mission_id`, `photo_id`, `evidence_id`). |
| Unidades | Distancia y elevación `m`; duración y consumibles hipotéticos en `min`; pendiente `deg`; fecha ISO 8601 UTC. |
| Posición para cálculos | `{x_m, y_m, frame_id}` en marco local de Marte; **nunca** coordenadas WGS84 terrestres. |
| Referencia planetaria | Metadatos de proyección y convención (longitud positiva al este, latitud planetocéntrica o planetográfica) declarados por región. |
| Datos faltantes | `null` o estado `unknown`; nunca cero ficticio ni supuesto de seguridad. |
| Estado de ruta | `viable` / `not_viable` / `unknown`: indican cumplimiento del **modelo**, no seguridad certificada. |
| Evidencia | `evidence_ids`, URL o identificador de producto, misión/instrumento, crédito, resolución, fecha y limitaciones. |
| Supuestos | `assumptions` siempre visibles para duración, oxígeno y escenarios de falla. |
| Errores | JSON `{error: {code, message, details, request_id}}`; frontend muestra recuperación y conserva datos válidos. |
| Versionado | `/api/v1`; cambios incompatibles requieren acuerdo y actualización de mocks/OpenAPI. |

**No usar GeoJSON RFC 7946 para declarar falsamente coordenadas marcianas como si fueran WGS84.** La aplicación puede dibujar geometrías locales mediante adaptadores y exportar JSON con metadatos de su CRS marciano.

## C. Endpoints P0 (imprescindibles)

| Método | Endpoint | Responsable | Lo que necesita el frontend |
|---|---|---|---|
| GET | `/health` | Integración | Servicio disponible, versión. |
| GET | `/regions` | Backend 1 | Selector de regiones. |
| GET | `/regions/{region_id}/manifest` | Backend 1 | Extensión, CRS, capas, resolución, archivos y fuentes. |
| GET | `/regions/{region_id}/objectives` | Backend 1 | Objetivos, ubicación, valor científico **asignado**, actividades y resultados posibles. |
| GET | `/regions/{region_id}/photos?objective_id=...` | Backend 1 | URL local, cámara, sol, captura, posición y **precisión** de asociación. |
| POST | `/routes/compute` | Backend 2 | Ruta base/objetivo, distancia, pendiente, tiempos y restricciones. |
| POST | `/missions/plan` | Backend 2 | Misión planificada, paradas, ruta, recursos y explicación. |
| GET | `/missions/{mission_id}` | Backend 2 | Misión completa/estado actual tras eventos. |
| POST | `/missions/{mission_id}/observations` | Backend 2 | Registrar observación codificada y cambio justificado del plan. |
| POST | `/missions/{mission_id}/contingencies` | Backend 2 | Revaluar ruta/recursos tras un evento simulado. |
| GET | `/missions/{mission_id}/package` | Backend 2 + Backend 1 | Índice offline con plan y referencias a activos precargables. |

**P1, no bloqueante:** `GET /missions/{id}/report`, importación de eventos offline, sincronización automática, optimizador de rover de apoyo, notificaciones en vivo y tiles dinámicos. No crear endpoints P1 antes de que funcione el flujo P0.

## D. Modelos principales — campos para front y backend

### `Region`

- `region_id`, `name`, `body="Mars"`, `description`, `available`.

### `RegionManifest`

- `region_id`, `frame`: `{frame_id, units, origin, projection_definition, longitude_direction, latitude_type}`.
- `bounds_local_m`: `{min_x, min_y, max_x, max_y}`.
- `layers[]`: `{layer_id, kind, title, asset_url, opacity_default, resolution_m_per_pixel, evidence_ids, nodata_policy}`.
- `evidence[]`: `{evidence_id, title, mission, instrument, source_url, credit, captured_at, resolution_m, caveats}`.
- `assets` son URL relativas del sitio/servidor, **no** rutas de disco local del desarrollador.

### `ScienceObjective`

- `objective_id`, `region_id`, `title`, `position`, `science_question`, `priority_weight` (configurable, **no** valor científico absoluto), `activities[]` y `possible_findings[]`.
- Las reglas del árbol de decisiones consumen códigos válidos `finding_code`; nunca infieren conclusiones solo del texto libre.

### `PhotoReference`

- `photo_id`, `objective_id`, `image_url`, `camera`, `sol`, `captured_at`, `credit`, `source_url`, `location` opcional, `location_quality="verified"|"approximate"|"unknown"` y `limitations`.
- **Una foto del mismo sol no equivale a una foto del objetivo exacto.** Si la ubicación es incierta, se muestra como referencia regional.

### `RouteResult`

- `route_id`, `region_id`, `path[]` de posiciones locales, `distance_m`, `duration_min`, `ascent_m`, `max_slope_deg`, `status`, `unknown_segments`, `warnings[]`, `evidence_ids[]`, `assumptions[]`.
- El frontend **no recalcula** métricas científicas; solo presenta las recibidas.

### `Mission`

- `mission_id`, `region_id`, `version`, `status`, `base_position`, `objective_ids`, `route`, `resources` (`oxygen_available_min`, `return_reserve_min`), `completed_objective_ids[]`, `next_objective_id`, `alerts[]`, `decision_log[]`, `evidence_ids[]`.
- `version` cambia tras observación o contingencia; evita sobrescribir el plan con datos anteriores.

## E. Ejemplos de solicitudes y respuestas

**Todos los identificadores, posiciones y valores de ejemplo son ficticios.** Ver JSON completo en `../contracts/examples/`.

### POST `/api/v1/routes/compute`

```json
{
  "region_id": "demo-jezero",
  "start": {"x_m": 100, "y_m": 200, "frame_id": "DEMO_LOCAL_MARS_V1"},
  "end": {"x_m": 600, "y_m": 850, "frame_id": "DEMO_LOCAL_MARS_V1"},
  "constraints": {"max_slope_deg": 15, "speed_m_per_min": 20, "avoid_unknown": true}
}
```

**Respuesta 200:** `RouteResult`. Si faltan datos imprescindibles, `status: "unknown"` con `warnings` y segmentos sin evidencia; no declarar `viable`.

### POST `/api/v1/missions/plan`

```json
{
  "region_id": "demo-jezero",
  "base_position": {"x_m": 100, "y_m": 200, "frame_id": "DEMO_LOCAL_MARS_V1"},
  "objective_ids": ["obj-001", "obj-002"],
  "constraints": {"max_slope_deg": 15, "speed_m_per_min": 20, "avoid_unknown": true},
  "resources": {"oxygen_available_min": 240, "return_reserve_min": 60}
}
```

**Respuesta 201:** `Mission`, con `decision_log` que explique ruta y orden de objetivos.

### POST `/api/v1/missions/{mission_id}/observations`

```json
{
  "mission_version": 1,
  "objective_id": "obj-001",
  "finding_code": "LAYERING_OBSERVED",
  "notes": "Observación simulada para el ejercicio"
}
```

**Respuesta 200:** misión `version: 2`, `decision_log` con la razón para conservar o modificar el próximo objetivo. `409` si `mission_version` no coincide.

### POST `/api/v1/missions/{mission_id}/contingencies`

```json
{
  "mission_version": 2,
  "contingency_type": "oxygen_reduced",
  "position": {"x_m": 400, "y_m": 540, "frame_id": "DEMO_LOCAL_MARS_V1"},
  "oxygen_available_min": 90
}
```

**Respuesta 200:** misión `version: 3`, cambio de ruta/estado o `unknown`/`not_viable`; nunca garantizar supervivencia.

### Respuesta de error común

```json
{
  "error": {
    "code": "REGION_NOT_READY",
    "message": "La región no dispone de datos suficientes para calcular la ruta",
    "details": {"missing_layers": ["elevation"]},
    "request_id": "req-demo-01"
  }
}
```

## F. Códigos HTTP y estados

| Código | Cuándo se usa | Comportamiento frontend |
|---|---|---|
| 200 | Consulta/cálculo exitoso | Renderizar resultados. |
| 201 | Misión creada | Abrir Mission Control con `mission_id`. |
| 400 | Solicitud mal formada | Mensaje claro, no borrar misión local. |
| 404 | Región/objetivo/misión inexistente | Volver al catálogo o mostrar recuperación. |
| 409 | Versión desactualizada de misión | Recuperar estado actual antes de reintentar. |
| 422 | Esquema o restricción inválida | Señalar campo incorrecto. |
| 503 | Datos científicos no preparados | Mostrar catálogo/cache offline si lo hay. |

## G. Orden de implementación para trabajar en paralelo

1. En la primera reunión: revisar OpenAPI, congelar nombres y generar `examples/`.
2. **Frontend:** crear un cliente tipado y un `mockAdapter` que lea exactamente los ejemplos JSON; implementar pantallas sin backend disponible.
3. **Backend 1:** producir `regions`, `manifest`, `objectives` y `photos`; respaldar cada dato con un ID de evidencia.
4. **Backend 2:** implementar el contrato de rutas/misiones con un dataset de prueba en memoria; integrar datos preparados por Backend 1 cuando estén disponibles.
5. Sustituir mocks uno a uno; validar rutas y respuestas contra OpenAPI en cada integración.
6. Para tableta: generar `package`, cachear datos esenciales y mostrar explícitamente `online`, `offline` y `cambios pendientes`.

## H. Propiedad y cambios de contrato

- Un solo archivo OpenAPI y ejemplos compartidos. Ningún desarrollador renombra campos unilateralmente.
- Cualquier cambio incompatible requiere PR con actualización de OpenAPI, mocks, frontend y pruebas, revisado por otro integrante.
- El `id` de fotografía, objetivo y evidencia siempre debe persistir sin cambiar entre Backend 1 y Backend 2.
- Los endpoints definidos aquí forman el **MVP acordable**; los recursos NASA/USGS externos **no** son esta API.
