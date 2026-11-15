# 06 — Plan: simulación de EVA para el video de presentación

Estado: **propuesta** (frontend). Depende de algoritmos de backend todavía pendientes.
Región: MC-23 · Gale, Monte Sharp (`mc23-gale-mount-sharp`, marco `MARS_GALE_MS_LOCAL_V1`).

## 1. Objetivo

Grabar un video donde se vea una EVA completa sobre el terreno real (DEM y ortofoto USGS):

1. Se coloca al astronauta en **cualquier punto** de la zona de 10 × 10 km.
2. Se marcan **puntos de interés** (POI) y el astronauta elige a cuál ir.
3. El **backend traza la ruta** con su algoritmo (pendiente, O₂, radiación, zonas de riesgo).
4. El astronauta **avanza a un ritmo constante** sobre la ruta, en el visor 3D y en el panel de control a la vez.
5. En algún momento **se desvía** a propósito. El backend lo detecta y **recalcula la ruta** o **avisa** que salió del camino.
6. Llega al POI, registra un hallazgo y regresa a la base.

El valor que debe quedar claro en el video: *"el astronauta decide; el sistema vigila y corrige con datos reales"*.

## 2. Guion del video (≈ 2–3 min)

| # | Escena | Pantalla | Qué se ve |
|---|---|---|---|
| 1 | Contexto | Panel `/` | Mapa 2D con ortofoto HiRISE, zona de 10 km, fuentes USGS |
| 2 | Colocar astronauta | Panel `/` | Clic en el mapa → aparece "TÚ"; se agregan 2–3 POI |
| 3 | Elegir destino | Visor `/visor` | Toca el radar → mapa → elige POI → **Verificar ruta** |
| 4 | Revisión de recursos | Visor | Distancia, tiempo, pendiente máx., O₂ y reserva → **Confirmar** |
| 5 | Caminata | Visor 3D + panel | El astronauta avanza; compás, radar y distancia restante se actualizan |
| 6 | Desvío | Visor 3D | Se sale de la ruta → alerta roja "Fuera de ruta (85 m)" → ruta nueva |
| 7 | Riesgo | Visor 3D | Si el desvío entra en zona de exclusión: aviso y ruta que la rodea |
| 8 | Llegada | Visor | **Llegué** → hallazgo en FindingPad → siguiente destino o base |
| 9 | Cierre | Panel `/` | Bitácora de decisiones: ruta original, desvío, recálculo, hallazgo |

## 3. Qué falta y quién lo hace

### Backend (bloqueante)

| Pieza | Descripción | Propuesta de contrato |
|---|---|---|
| **B1. Ruta con A\*** | Hoy el mock traza líneas rectas y casi todo sale `not_viable` por los escarpes reales (41°). Hace falta A\* (o similar) sobre el DEM con costos por pendiente, zonas de exclusión/precaución y O₂. | Sin cambios: `POST /routes/compute` → `RouteResult` |
| **B2. Seguimiento de posición** | Recibe la posición actual y responde si sigue en ruta, cuánto se desvió y qué hacer. | `POST /missions/{id}/position` (abajo) |
| **B3. Recálculo** | Si el desvío supera el umbral, o la posición entra en zona de riesgo, devuelve la ruta nueva desde la posición actual y la registra en la bitácora. | Dentro de la respuesta de B2 (`mission` actualizada) |
| **B4. Router activo** | `catalog_router` está comentado en `main.py`; `terrain.json` no trae los bloques `frame`/`region`; las URL de assets usan `gale-mount-sharp` en vez de `mc23-gale-mount-sharp`. | — |

Propuesta para B2/B3 (a acordar; la detección y el recálculo son del backend, el cliente no recalcula métricas):

```jsonc
// POST /api/v1/missions/{mission_id}/position
{
  "mission_version": 7,
  "position": { "x_m": 4520.0, "y_m": 5310.0, "z_m": null },
  "timestamp": "2026-11-20T15:04:05Z"
}
// 200
{
  "on_route": false,
  "deviation_m": 85.2,            // distancia a la ruta; null si desconocida
  "action": "rerouted",           // "none" | "warn" | "rerouted" | "stop"
  "message": "Fuera de ruta: se recalculó desde tu posición.",
  "mission": { /* Mission con route nueva, alerts y decision_log actualizados */ }
}
```

Umbrales sugeridos: avisar a partir de **30 m** fuera de ruta y recalcular a partir de **60 m** o al entrar en zona de exclusión. Los define el backend; el frontend solo los muestra.

### Frontend

| Pieza | Descripción |
|---|---|
| **F1. Colocar astronauta** | En el panel, modo "Simulación": clic en el mapa para fijar la posición inicial (hoy el clic fija la base) y clic para agregar POI temporales. |
| **F2. Reproductor de caminata** | Avanza la posición sobre `route.path` a `speed_m_per_min` × factor de tiempo (×1, ×10, ×30 para el video). Controles: ▶ ⏸, velocidad, reiniciar. Cada N segundos envía la posición a B2. |
| **F3. Desvío manual** | Durante la caminata: botón/teclas para desviar al astronauta (empujar 50–100 m a un lado, o arrastrarlo en el mapa). Solo mueve la posición; lo demás lo decide el backend. |
| **F4. Reacción en el HUD** | Mostrar `action` de B2: alerta "Fuera de ruta", ruta nueva animada en 3D/2D, distancia restante y ETA actualizadas con los datos que devuelva el backend. |
| **F5. Sincronía panel ↔ visor** | El panel ve al astronauta moverse en tiempo real (el mock ya comparte estado entre pestañas vía `localStorage`; con backend, *polling* de `GET /missions/{id}`). |
| **F6. Cámara de video** | Modo "presentación": oculta controles de depuración, cámara que sigue al astronauta suavemente y vista 3D a pantalla completa. |

Mientras B1–B3 no existan, F1–F6 se construyen contra el **mock**: el mock emula B2 con el mismo contrato (distancia a la ruta + umbrales) para que cambiar a backend real sea solo `VITE_USE_MOCK=false`.

## 4. Fases

| Fase | Contenido | Depende de |
|---|---|---|
| 1 | F1 + F2 sobre el mock (rutas rectas) | — |
| 2 | Mock de B2 + F3 + F4 (desvío y alerta) | Fase 1 |
| 3 | Integrar B1 (A\*): rutas viables reales | Backend B1, B4 |
| 4 | Integrar B2/B3 reales | Backend B2, B3 |
| 5 | F5 + F6, ensayo y grabación | Fases 3–4 |

Si el backend no llega a tiempo, el video se puede grabar con las fases 1, 2 y 5 sobre el mock, **indicando en pantalla** que las rutas son simuladas (regla: nada simulado se presenta como medido).

## 5. Criterios de aceptación

- [ ] Se puede iniciar desde cualquier punto con datos de terreno (si cae en una celda sin dato, se avisa y no se inicia).
- [ ] Las rutas, la viabilidad y los recálculos vienen del backend (o del mock con el mismo contrato), nunca del cliente.
- [ ] El astronauta avanza de forma fluida en 3D y el panel lo refleja en ≤ 2 s.
- [ ] Un desvío mayor al umbral produce alerta y ruta nueva sin recargar la página.
- [ ] Entrar en una zona de exclusión produce aviso inmediato y nunca se presenta como seguro.
- [ ] La bitácora muestra ruta original, desvío, recálculo y hallazgo, con hora.
- [ ] Funciona a 60 fps en la laptop de grabación y no rompe el modo sin conexión.

## 6. Riesgos

- **A\* sobre 2500² celdas** puede ser lento: usar el DEM de 20 m para búsqueda y refinar el tramo cercano a 4 m.
- **Rutas no viables por relieve real**: elegir POI de demo con acceso razonable o permitir pendiente máx. configurable en la demo (declarado en pantalla).
- **Objetivos y zonas de riesgo actuales son inventados**: para el video conviene ubicar POI reales (contacto arcillas–sulfatos, boxwork, campo de dunas del norte) con sus fuentes.
