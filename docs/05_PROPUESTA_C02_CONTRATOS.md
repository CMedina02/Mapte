# C02 — Propuesta histórica para alinear contratos

> [!WARNING]
> **Documento histórico: no usar para implementar.** C02 quedó cerrado con
> `contracts/openapi.yaml` como exportación verificable del OpenAPI real. Los esquemas Python,
> tipos TypeScript y mocks actuales usan la región `mc23-gale-mount-sharp`, el marco
> `MARS_GALE_MS_LOCAL_V1` y el terreno `gale-ms-v1`.

> **Estado:** propuesta para revisión de Frontend, Backend 1 y Backend 2.  
> Este documento no convierte por sí solo ninguna opción en contrato aprobado.

## Objetivo

Cerrar las diferencias entre el cliente actual, sus mocks, OpenAPI y los ejemplos antes de
implementar catálogo, terreno o misiones. Al aprobar C02, `contracts/openapi.yaml` será la fuente
canónica del contrato HTTP y las demás representaciones deberán validarse contra ella.

La región acordada es **Tharsis**, pero el sector, la cobertura, la proyección y los valores del
mock actual siguen siendo provisionales hasta que Backend 1 confirme los datos disponibles.

## Fuentes revisadas

- `frontend/src/shared/types/contracts.ts`: tipos usados por el frontend.
- `frontend/src/shared/api/contracts.ts`: segunda copia parcial de los tipos; ya difiere de la
  anterior.
- `frontend/src/shared/api/client.ts`: solicitudes y respuestas que espera el cliente.
- `frontend/src/shared/api/mocks/tharsisMock.ts`: forma y valores de los mocks actuales.
- `contracts/openapi.yaml`: contrato anterior, todavía basado parcialmente en Jezero.
- `contracts/examples/*.json`: ejemplos anteriores.

## Decisiones generales propuestas

1. **Una fuente canónica HTTP.** Después de C02 será `contracts/openapi.yaml`.
2. **Una sola definición TypeScript.** Conservar
   `frontend/src/shared/types/contracts.ts`; eliminar la duplicación de
   `frontend/src/shared/api/contracts.ts` o convertirla en una reexportación.
3. **Prefijo único.** OpenAPI mantiene `servers: [{url: /api/v1}]`; las rutas dentro de `paths`
   permanecen sin repetir `/api/v1`.
4. **Nombres JSON.** Todos los campos públicos usan `snake_case`.
5. **Nulos explícitos.** Un valor que no puede calcularse por falta de datos es `null`; no se
   sustituye por cero.
6. **Datos simulados identificables.** Los mocks de Tharsis deben declarar que el terreno, las
   métricas, las restricciones y los hallazgos son sintéticos. No deben presentar el sector A,
   Ceraunius, `lon_0=250` o los límites actuales como decisiones científicas cerradas.

## Matriz de discrepancias y decisión recomendada

| Área | Frontend actual | OpenAPI/ejemplos actuales | Decisión recomendada | Responsable |
|---|---|---|---|---|
| Fuente TypeScript | Usa `shared/types/contracts.ts` | Existe otra copia en `shared/api/contracts.ts` | Una sola fuente TypeScript; reexportar o retirar la copia de `api` | Frontend |
| Listado de regiones | Espera `Region[]` | Devuelve `{regions: Region[]}` | Conservar el envoltorio para permitir metadatos y hacer que el cliente lea `.regions` | Frontend + Backend 1 |
| Listado de objetivos | Espera `ScienceObjective[]` | Devuelve `{objectives: Objective[]}` | Conservar el envoltorio y hacer que el cliente lea `.objectives` | Frontend + Backend 1 |
| Listado de fotos | Espera `PhotoReference[]` | Devuelve `{photos: Photo[], sample_only?}` | Conservar el envoltorio y hacer que el cliente lea `.photos` | Frontend + Backend 1 |
| Posiciones de entrada | `{x_m,y_m,frame_id}` | Igual | Mantener `LocalMarsPosition` sin altura | Todos |
| Puntos de ruta | Usa `LocalMarsPosition[]` | Usa `Position[]` | Crear `RoutePoint` con `x_m`, `y_m`, `frame_id` y `z_m: number \| null` | Frontend + Backend 2 |
| Métricas de ruta | Permite `null` | Exige números | Permitir `null` en `distance_m`, `duration_min`, `ascent_m` y `max_slope_deg` cuando el estado sea `unknown` | Frontend + Backend 2 |
| Segmentos desconocidos | `number[][]`, mock `[[4,5]]` | Un entero | Usar pares de índices: `Array<[number, number]>`; cada par identifica los extremos del tramo | Frontend + Backend 2 |
| Estados de ruta | `viable`, `not_viable`, `unknown` | Igual | Mantenerlos; describen el modelo, no garantizan seguridad | Todos |
| Marco del manifiesto | `origin` es una posición local | OpenAPI usa longitud/latitud de origen | Mantener ambos conceptos con nombres distintos: `origin_local` y `origin_geographic`; Backend 1 define sus campos finales | Backend 1 + Frontend |
| Terreno 3D | No existe | No existe | Añadir `RegionManifest.terrain` con el contrato propuesto abajo | Todos |
| Evidencia: `caveats` | `string` | `string[]` | Usar `string[]` | Backend 1 + Frontend |
| Capas: `kind` | Valores amplios, incluidos `elevation`, `slope`, `geology` | Enum distinto: `topographic`, `geologic`, etc. | Acordar enum único: `optical`, `elevation`, `slope`, `geology`, `thermal`, `spectral`, `other` | Backend 1 + Frontend |
| Capas: NoData | Texto libre | Solo `unknown` | Usar enum `transparent`, `unknown`, `blocked`; documentar su efecto visual y de cálculo | Backend 1 + Frontend |
| Hallazgos posibles | Objetos `{finding_code,label,description?}` | Códigos `string[]` | Usar objetos; la interfaz necesita etiquetas y Backend 2 valida por `finding_code` | Backend 1 + Frontend + Backend 2 |
| Evidencia de objetivo | No tiene `evidence_ids` | Campo obligatorio | Añadir `evidence_ids: string[]` al tipo y mock del frontend | Backend 1 + Frontend |
| Foto: campos nulos | `objective_id`, `sol` y `captured_at` mayormente obligatorios | Admite algunos nulos | Permitir `objective_id`, `sol`, `captured_at` y `location` nulos cuando la fuente no los prueba | Backend 1 + Frontend |
| Foto: `limitations` | `string` | `string[]` | Usar `string[]` | Backend 1 + Frontend |
| Estado de misión | `active`, `aborted`, `unknown` | `in_progress`, `cancelled` | Usar `planned`, `active`, `contingency`, `completed`, `aborted`, `unknown` | Frontend + Backend 2 |
| Alertas | Objetos con ID, severidad, código y mensaje | `string[]` | Usar objetos `MissionAlert[]` | Frontend + Backend 2 |
| Historial de decisiones | `{timestamp,step,reason,evidence_ids?}` | `{event_type,message,evidence_ids,simulated}` | Combinar lo necesario en `DecisionLogEntry`: ID, fecha, tipo, razón, evidencias y `simulated` | Frontend + Backend 2 |
| `Mission.route` | Una sola ruta completa | Una sola ruta completa | Mantener provisionalmente; antes de M03 definir si representa la ruta restante, la ruta original o un itinerario por tramos | Frontend + Backend 2 |
| Reserva de regreso | Minutos, sin semántica cerrada | Igual | Definirla como minutos que deben quedar **después del retorno estimado a base**; no es parte del tiempo utilizable | Todos |
| Actividades | No tienen duración | No tienen duración | Para MVP, añadir duración configurada por objetivo o declarar explícitamente que el evaluador todavía no la consume | Backend 1 + Backend 2 |
| Observación | `notes` obligatorio en cliente | `notes` opcional | Hacerlo opcional, con máximo de 1000 caracteres | Frontend + Backend 2 |
| Contingencia | Oxígeno opcional en cliente y tipo de texto abierto | Oxígeno obligatorio; enum de dos casos | Para `oxygen_reduced`, exigir `oxygen_available_min`; rechazarlo o ignorarlo explícitamente en otros tipos | Frontend + Backend 2 |
| Paquete de misión | `{mission,manifest,objectives,photos}` | Usa `region_manifest` y añade versión, activos, estado y fecha | Mantener la forma completa de OpenAPI y el nombre `region_manifest` | Frontend + ambos backends |
| Errores | `details` y `request_id` opcionales | Ambos obligatorios | Mantenerlos obligatorios; `details` puede ser `{}` | Todos |
| `sample_only` | No está en tipos nuevos | Aparece de forma irregular | Sustituirlo por `data_status: synthetic \| verified \| mixed` en manifiesto y paquete | Todos |
| URL de activos | Mock usa `/assets/...` | Ejemplos usan `/assets/...` | Servir activos del backend bajo `/api/v1/assets/...` para aprovechar el proxy existente | Backend 1 + Frontend |

## Tipos HTTP propuestos para ruta

```ts
interface LocalMarsPosition {
  x_m: number;
  y_m: number;
  frame_id: string;
}

interface RoutePoint extends LocalMarsPosition {
  z_m: number | null;
}

interface RouteResult {
  route_id: string;
  region_id: string;
  path: RoutePoint[];
  distance_m: number | null;
  duration_min: number | null;
  ascent_m: number | null;
  max_slope_deg: number | null;
  status: 'viable' | 'not_viable' | 'unknown';
  unknown_segments: Array<[number, number]>;
  warnings: string[];
  evidence_ids: string[];
  assumptions: string[];
}
```

Reglas propuestas:

- `z_m` se calcula a partir de la versión de terreno usada para la ruta.
- `z_m=null` significa que la elevación es desconocida; no significa nivel cero.
- Los índices de `unknown_segments` deben existir en `path` y cumplir `start_index < end_index`.
- Si un tramo necesario carece de datos, el resultado no puede ser `viable`.
- `not_viable` indica que el modelo encontró una restricción incumplida; `unknown` indica que no
  existe evidencia suficiente para decidir.

## `RegionManifest.terrain` propuesto

```json
{
  "terrain": {
    "terrain_id": "terrain-tharsis-provisional-v1",
    "version": "1",
    "asset_url": "/api/v1/assets/terrain/tharsis-provisional-v1.f32",
    "encoding": "float32_le",
    "width": 201,
    "height": 201,
    "cell_size_m": 10,
    "grid_origin": {
      "x_m": 0,
      "y_m": 2000,
      "frame_id": "MARS_THARSIS_LOCAL_PROVISIONAL_V1"
    },
    "origin_anchor": "cell_center",
    "column_direction": "x_increasing",
    "row_direction": "y_decreasing",
    "storage_order": "row_major",
    "nodata_value": "NaN",
    "vertical_reference": "PENDING_BACKEND_1",
    "min_z_m": null,
    "max_z_m": null,
    "texture_layer_id": "layer-optical-provisional",
    "evidence_ids": [],
    "data_status": "synthetic"
  }
}
```

Convención recomendada, pendiente de confirmación:

- Binario sin cabecera, Float32 little-endian y orden por filas.
- `grid_origin` señala el centro de la celda `[row=0,column=0]`.
- Las columnas avanzan hacia `x` creciente y las filas hacia `y` decreciente.
- NoData se codifica como NaN en el archivo. En JSON se describe con la cadena `"NaN"`, porque
  JSON no admite NaN como número.
- `min_z_m` y `max_z_m` excluyen las celdas NoData y pueden ser `null` si todavía no se conocen.
- `texture_layer_id` referencia una capa del mismo manifiesto; no duplica su URL.
- El manifiesto público puede usar una resolución visual distinta de la cuadrícula de cálculo.

Antes de aceptar este bloque, Backend 1 debe confirmar la referencia vertical, cobertura, tamaño
de celda, orientación y alineación con la textura. Frontend debe confirmar que puede cargar la
matriz y colocar una ruta de control sobre ella.

## Contrato Python interno de terreno propuesto

El motor de rutas no leerá directamente el `.f32` público. Consumirá una interfaz Python pequeña
que Backend 1 podrá respaldar primero con datos sintéticos y después con el producto verificado.

```python
class TerrainProvider(Protocol):
    @property
    def frame_id(self) -> str: ...

    @property
    def version(self) -> str: ...

    @property
    def cell_size_m(self) -> float: ...

    def world_to_cell(self, x_m: float, y_m: float) -> tuple[int, int] | None: ...

    def cell_center(self, row: int, column: int) -> tuple[float, float]: ...

    def sample_cell(self, row: int, column: int) -> TerrainSample: ...
```

```python
class TerrainSample(NamedTuple):
    elevation_m: float | None
    status: Literal["valid", "nodata", "outside"]
    blocked: bool
    restriction_codes: tuple[str, ...]
```

Reglas propuestas:

- Una coordenada de otro `frame_id` se rechaza; no se transforma silenciosamente.
- `world_to_cell` devuelve `None` fuera de cobertura.
- `nodata` y `outside` nunca se consideran terreno seguro.
- `blocked=True` representa una restricción explícita y no se confunde con NoData.
- La pendiente se calcula usando elevaciones válidas; si faltan vecinos necesarios, su resultado
  es desconocido.
- La versión de terreno utilizada queda registrada en las suposiciones o metadatos de la ruta.

## Decisiones que requieren confirmación del equipo

1. Envoltorios para las tres listas de catálogo.
2. Forma final de `frame`, especialmente el origen geográfico y el origen local.
3. Enum de capas y política NoData.
4. Semántica de `return_reserve_min` y duración de actividades.
5. Significado exacto de `Mission.route` después de una observación o contingencia.
6. Campos definitivos de `DecisionLogEntry`.
7. Convención binaria y geométrica del terreno.
8. Resolución y alineación entre terreno de cálculo, matriz visual y textura.
9. Sector real de Tharsis, `frame_id` definitivo y fuentes científicas.

## Implementación posterior a la aprobación

Una vez aceptadas las decisiones anteriores, C02 se implementará en este orden:

1. Actualizar `contracts/openapi.yaml`.
2. Actualizar todos los ejemplos y reemplazar referencias de Jezero por un conjunto sintético de
   Tharsis claramente etiquetado.
3. Alinear el tipo TypeScript canónico y el cliente; retirar la duplicación.
4. Alinear los mocks sin presentar parámetros provisionales como datos verificados.
5. Añadir validación automática de ejemplos contra OpenAPI.
6. Ejecutar pruebas del backend y comprobación TypeScript del frontend.

No se implementarán routers de catálogo, rutas o misiones como parte de C02.
