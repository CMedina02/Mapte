# Backend de Mapte

Una aplicación FastAPI con módulos separados para catálogo (Backend 1) y misiones
(Backend 2). La región piloto actual es Monte Sharp, en el cráter Gale.

## Entorno y ejecución (PowerShell)

Ejecutar desde `D:\PROG\NASA\Mapte\backend`.
Objetivo del equipo: Python 3.14. Se mantiene compatibilidad con Python 3.12–3.14
para poder comprobar la base con el intérprete actualmente instalado.

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -c constraints.txt -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

El arranque carga una sola vez el terreno de `MAPTE_ACTIVE_REGION`. Si la variable no
está definida y existe exactamente una región publicada en `data/regions`, se utiliza
esa región. `MAPTE_DATA_ROOT` permite indicar otra carpeta de regiones.

```powershell
$env:MAPTE_ACTIVE_REGION = "mc23-gale-mount-sharp"
```

Si aún no está instalado Python 3.14, se puede crear el entorno con `py -3.12`.
El entorno virtual es local y no se comparte. No es necesario activar scripts de
PowerShell: los comandos usan directamente su intérprete.

`constraints.txt` fija las versiones resueltas para esta base en Windows/Python 3.12.
La instalación y las pruebas en Python 3.14 deben verificarse al actualizar el
intérprete. Los cambios de dependencias y de este archivo se coordinan entre ambos backend.

- Salud: http://127.0.0.1:8000/api/v1/health
- Regiones: http://127.0.0.1:8000/api/v1/regions
- Cálculo de ruta: `POST http://127.0.0.1:8000/api/v1/routes/compute`
- Swagger: http://127.0.0.1:8000/docs
- Esquema de lo implementado: http://127.0.0.1:8000/openapi.json

`health` devuelve `{"status":"ok","api_version":"v1"}`. Solo confirma que la API
responde; no afirma que el terreno, catálogo o motor de misiones estén listos.

## Comprobaciones

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

## Trabajo simultáneo

- Backend 1: `app/modules/catalog/` y sus futuras pruebas en `tests/catalog/`.
- Backend 2: `app/modules/missions/` y sus futuras pruebas en `tests/missions/`.
- Backend 2 coordina `app/main.py`, `app/core/` y dependencias compartidas.
- Cada módulo expone un `router` de FastAPI. Se registra en `create_app()`
  con prefijo `/api/v1`; las rutas internas no repetirán ese prefijo.
- Los módulos se comunican mediante interfaces Python acordadas; no por HTTP.
- Catálogo y misiones comparten el mismo repositorio de terreno cargado en memoria.

## Integración con frontend

El proxy existente de Vite envía `/api` a `http://127.0.0.1:8000`. No requiere
cambios para esta base ni CORS abierto. Frontend conserva su entorno y dependencias.
Su cliente usa mocks por defecto; `VITE_USE_MOCK=false` activa HTTP real y requiere
reiniciar Vite. Catálogo y rutas ya tienen endpoints; los demás flujos de misión siguen
pendientes.

Monte Sharp y los formatos actuales acordados del frontend guían las próximas tareas.
El archivo raíz `contracts/openapi.yaml` todavía corresponde a la propuesta anterior:
su actualización y la de los ejemplos están pendientes de una tarea compartida.
El OpenAPI generado por la aplicación describe lo implementado actualmente.

## Errores

Formato común: `{"error":{"code":"...","message":"...","details":{},"request_id":"..."}}`.
Los errores HTTP preservan su estado y cabeceras; la validación devuelve 422.
Los fallos inesperados devuelven 500 sin exponer detalles internos al cliente.
Los códigos específicos del dominio se acordarán al implementar misiones.

Referencias: [errores en FastAPI](https://fastapi.tiangolo.com/tutorial/handling-errors/)
y [pruebas con TestClient](https://fastapi.tiangolo.com/tutorial/testing/).
