"""HTTP endpoints for the simulated EVA walk (``/sim``).

Demo only: every response carries ``simulated: true``. The walk is synthetic;
routes, hazards and reroutes come from the real planner and terrain.
"""

from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from app.modules.catalog.api.schemas import PositionSchema
from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.api.router import _route_response, get_terrain_repository
from app.modules.missions.api.schemas import RouteConstraintsSchema, RouteResultSchema
from app.modules.missions.routing import InvalidRouteEndpointError, RoutePlanningConstraints
from app.modules.missions.simulation import (
    DeviationPlan,
    EvaSimulation,
    SimulationRegistry,
    SimulationRouteError,
)
from app.modules.missions.terrain import FrameMismatchError, LocalPosition

simulation_router = APIRouter(prefix="/sim", tags=["Simulation"])

# Escenario preestablecido (Monte Sharp): hacia Gediz Vallis. El destino está a ~800 m en línea
# recta, pero la pendiente obliga al A* a rodear el relieve: ~3.9 km de trayecto con ~270 m de
# desnivel, para que se note que la ruta no es una recta.
PRESET_REGION_ID = "mc23-gale-mount-sharp"
PRESET_FRAME_ID = "MARS_GALE_MS_LOCAL_V1"
PRESET_START = (5123.0, 2190.0)
PRESET_END = (5523.0, 2883.0)  # obj-gediz-vallis-mammoth-lakes
PRESET_CONSTRAINTS = RoutePlanningConstraints(
    max_slope_deg=15.0, speed_m_per_min=20.0, avoid_unknown=True
)
MAX_DEMO_STEPS = 5000
DEFAULT_SPEED_FACTOR = 120.0
MAX_SPEED_FACTOR = 600.0


# --- schemas ----------------------------------------------------------------


class DeviationSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at_fraction: float = Field(default=0.4, gt=0, lt=1, description="Fracción de la ruta.")
    side: Literal["left", "right"] = "left"
    angle_deg: float = Field(default=60.0, gt=0, le=90)


class SimulationCreateSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region_id: str | None = Field(default=None, min_length=1)
    start: PositionSchema | None = None
    end: PositionSchema | None = None
    constraints: RouteConstraintsSchema | None = None
    speed_factor: float = Field(default=DEFAULT_SPEED_FACTOR, gt=0, le=MAX_SPEED_FACTOR)
    deviation: DeviationSchema | None = Field(
        default_factory=DeviationSchema,
        description="Desvío automático; null para caminar sin desviarse.",
    )


class SimulationStepSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dt_s: float = Field(default=1.0, gt=0, le=60, description="Segundos reales a avanzar.")


class SimulationEventSchema(BaseModel):
    t_s: float
    event_type: str
    message: str
    x_m: float
    y_m: float


class SimulationThresholdsSchema(BaseModel):
    warn_m: float
    reroute_m: float


class SimulationStateSchema(BaseModel):
    sim_id: str
    simulated: Literal[True] = True
    status: Literal["following", "drifting", "arrived", "stopped"]
    action: Literal["none", "warn", "rerouted", "arrived", "stop"]
    message: str
    t_s: float = Field(description="Tiempo simulado transcurrido (s).")
    speed_factor: float
    position: PositionSchema
    heading_deg: float
    progress_m: float
    remaining_m: float | None
    eta_min: float | None
    on_route: bool
    deviation_m: float
    thresholds: SimulationThresholdsSchema
    destination: PositionSchema
    route: RouteResultSchema
    original_route_id: str
    route_version: int
    reroute_count: int
    log: list[SimulationEventSchema]


class SimulationFrameSchema(BaseModel):
    t_s: float
    x_m: float
    y_m: float
    z_m: float
    status: str
    action: str
    deviation_m: float
    route_version: int


class SimulationDemoSchema(BaseModel):
    simulated: Literal[True] = True
    frames: list[SimulationFrameSchema]
    final: SimulationStateSchema


# --- dependencies -----------------------------------------------------------


def get_simulation_registry(request: Request) -> SimulationRegistry:
    registry = getattr(request.app.state, "simulation_registry", None)
    if registry is None:
        registry = SimulationRegistry()
        request.app.state.simulation_registry = registry
    return registry


TerrainDep = Annotated[TerrainRepository, Depends(get_terrain_repository)]
RegistryDep = Annotated[SimulationRegistry, Depends(get_simulation_registry)]


# --- endpoints --------------------------------------------------------------


@simulation_router.post("", response_model=SimulationStateSchema, status_code=201)
def create_simulation(
    terrain: TerrainDep,
    registry: RegistryDep,
    payload: SimulationCreateSchema | None = None,
) -> SimulationStateSchema:
    """Crea una caminata simulada; sin cuerpo usa el escenario preestablecido."""
    simulation = _build(terrain, payload or SimulationCreateSchema())
    registry.add(simulation)
    return _state(simulation)


@simulation_router.get("/demo", response_model=SimulationDemoSchema)
def run_demo(
    terrain: TerrainDep,
    dt_s: Annotated[float, Query(gt=0, le=60)] = 1.0,
    speed_factor: Annotated[float, Query(gt=0, le=MAX_SPEED_FACTOR)] = DEFAULT_SPEED_FACTOR,
) -> SimulationDemoSchema:
    """Corre el escenario preestablecido de principio a fin y devuelve la línea de tiempo."""
    simulation = _build(terrain, SimulationCreateSchema(speed_factor=speed_factor))
    frames = [_frame(simulation)]
    for _ in range(MAX_DEMO_STEPS):
        if simulation.finished:
            break
        simulation.step(dt_s)
        frames.append(_frame(simulation))
    return SimulationDemoSchema(frames=frames, final=_state(simulation))


@simulation_router.get("/{sim_id}", response_model=SimulationStateSchema)
def get_simulation(sim_id: str, registry: RegistryDep) -> SimulationStateSchema:
    return _state(_require(registry, sim_id))


@simulation_router.post("/{sim_id}/step", response_model=SimulationStateSchema)
def step_simulation(
    sim_id: str,
    registry: RegistryDep,
    payload: SimulationStepSchema | None = None,
) -> SimulationStateSchema:
    """Avanza la caminata; el backend detecta el desvío y recalcula."""
    simulation = _require(registry, sim_id)
    with registry.lock:
        simulation.step((payload or SimulationStepSchema()).dt_s)
        return _state(simulation)


@simulation_router.delete("/{sim_id}", status_code=204)
def delete_simulation(sim_id: str, registry: RegistryDep) -> Response:
    if not registry.remove(sim_id):
        raise HTTPException(status_code=404, detail=f"Simulación no encontrada: {sim_id!r}.")
    return Response(status_code=204)


# --- helpers ----------------------------------------------------------------


def _build(terrain: TerrainRepository, payload: SimulationCreateSchema) -> EvaSimulation:
    region_id = payload.region_id or PRESET_REGION_ID
    is_preset_region = region_id == PRESET_REGION_ID
    if (payload.start is None or payload.end is None) and not is_preset_region:
        raise HTTPException(
            status_code=400,
            detail="Fuera de la región preestablecida hay que indicar start y end.",
        )
    preset_start = LocalPosition(*PRESET_START, PRESET_FRAME_ID)
    preset_end = LocalPosition(*PRESET_END, PRESET_FRAME_ID)
    start = _local(payload.start) if payload.start else preset_start
    end = _local(payload.end) if payload.end else preset_end
    constraints = (
        RoutePlanningConstraints(
            max_slope_deg=payload.constraints.max_slope_deg,
            speed_m_per_min=payload.constraints.speed_m_per_min,
            avoid_unknown=payload.constraints.avoid_unknown,
        )
        if payload.constraints
        else PRESET_CONSTRAINTS
    )
    deviation = (
        DeviationPlan(
            at_fraction=payload.deviation.at_fraction,
            side=payload.deviation.side,
            angle_deg=payload.deviation.angle_deg,
        )
        if payload.deviation
        else None
    )
    try:
        return EvaSimulation(
            sim_id=str(uuid4()),
            terrain_repository=terrain,
            region_id=region_id,
            start=start,
            end=end,
            constraints=constraints,
            speed_factor=payload.speed_factor,
            deviation=deviation,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Región desconocida: {region_id!r}.") from exc
    except (FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SimulationRouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _require(registry: SimulationRegistry, sim_id: str) -> EvaSimulation:
    simulation = registry.get(sim_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail=f"Simulación no encontrada: {sim_id!r}.")
    return simulation


def _local(position: PositionSchema) -> LocalPosition:
    return LocalPosition(position.x_m, position.y_m, position.frame_id)


def _frame(simulation: EvaSimulation) -> SimulationFrameSchema:
    return SimulationFrameSchema(
        t_s=round(simulation.t_s, 1),
        x_m=round(simulation.x_m, 2),
        y_m=round(simulation.y_m, 2),
        z_m=round(simulation.z_m, 2),
        status=simulation.status.value,
        action=simulation.last_action.value,
        deviation_m=round(simulation.deviation_m, 1),
        route_version=simulation.route_version,
    )


def _state(simulation: EvaSimulation) -> SimulationStateSchema:
    frame_id = simulation.destination.frame_id
    remaining, eta = simulation.remaining_m, simulation.eta_min
    return SimulationStateSchema(
        sim_id=simulation.sim_id,
        status=simulation.status.value,
        action=simulation.last_action.value,
        message=simulation.last_message,
        t_s=round(simulation.t_s, 1),
        speed_factor=simulation.speed_factor,
        position=PositionSchema(
            x_m=simulation.x_m, y_m=simulation.y_m, z_m=simulation.z_m, frame_id=frame_id
        ),
        heading_deg=round(simulation.heading_deg, 1),
        progress_m=round(simulation.progress_m, 1),
        remaining_m=None if remaining is None else round(remaining, 1),
        eta_min=None if eta is None else round(eta, 1),
        on_route=simulation.on_route,
        deviation_m=round(simulation.deviation_m, 1),
        thresholds=SimulationThresholdsSchema(
            warn_m=simulation.warn_m, reroute_m=simulation.reroute_m
        ),
        destination=PositionSchema(
            x_m=simulation.destination.x_m, y_m=simulation.destination.y_m, frame_id=frame_id
        ),
        route=_route_response(simulation.route),
        original_route_id=simulation.original_route_id,
        route_version=simulation.route_version,
        reroute_count=simulation.reroute_count,
        log=[
            SimulationEventSchema(
                t_s=e.t_s, event_type=e.event_type, message=e.message, x_m=e.x_m, y_m=e.y_m
            )
            for e in simulation.log
        ],
    )
