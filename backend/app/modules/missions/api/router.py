"""HTTP route-computation endpoint for Backend 2."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.api.schemas import (
    MissionPlanRequestSchema,
    MissionPlanResponseSchema,
    RouteRequestSchema,
    RouteResultSchema,
)
from app.modules.missions.persistence import MissionRepository, StoredMission
from app.modules.missions.planning import (
    MissionPlanner,
    MissionPlanningRequest,
    ObjectiveRepository,
)
from app.modules.missions.planning.persistence import mission_create_from_plan
from app.modules.missions.resources import SupportResources
from app.modules.missions.routing import (
    InvalidRouteEndpointError,
    RoutePlanningConstraints,
)
from app.modules.missions.routing.service import RouteApplicationService
from app.modules.missions.terrain import FrameMismatchError, LocalPosition

missions_router = APIRouter(tags=["Missions"])


def get_terrain_repository(request: Request) -> TerrainRepository:
    repository = getattr(request.app.state, "terrain_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="El terreno no está cargado.")
    return repository


TerrainDep = Annotated[TerrainRepository, Depends(get_terrain_repository)]


def get_objective_repository(request: Request) -> ObjectiveRepository:
    repository = getattr(request.app.state, "objective_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="El catálogo científico no está cargado.")
    return repository


def get_mission_repository(request: Request) -> MissionRepository:
    repository = getattr(request.app.state, "mission_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="La persistencia de misiones no está lista.")
    return repository


ObjectiveDep = Annotated[ObjectiveRepository, Depends(get_objective_repository)]
MissionDep = Annotated[MissionRepository, Depends(get_mission_repository)]


@missions_router.post("/routes/compute", response_model=RouteResultSchema)
def compute_route(payload: RouteRequestSchema, repository: TerrainDep) -> RouteResultSchema:
    service = RouteApplicationService(repository)
    constraints = RoutePlanningConstraints(
        max_slope_deg=payload.constraints.max_slope_deg,
        speed_m_per_min=payload.constraints.speed_m_per_min,
        avoid_unknown=payload.constraints.avoid_unknown,
    )
    start = LocalPosition(payload.start.x_m, payload.start.y_m, payload.start.frame_id)
    end = LocalPosition(payload.end.x_m, payload.end.y_m, payload.end.frame_id)

    try:
        result = service.compute(payload.region_id, start, end, constraints)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Región desconocida: {payload.region_id!r}.",
        ) from exc
    except (FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    route = result.route
    return RouteResultSchema(
        route_id=result.route_id,
        region_id=result.region_id,
        frame_id=result.frame_id,
        terrain_version=result.terrain_version,
        path=(
            [
                {
                    "x_m": point.x_m,
                    "y_m": point.y_m,
                    "z_m": point.z_m,
                    "frame_id": point.frame_id,
                }
                for point in route.path
            ]
            if route is not None
            else []
        ),
        distance_m=route.distance_m if route is not None else None,
        duration_min=route.duration_min if route is not None else None,
        ascent_m=route.ascent_m if route is not None else None,
        max_slope_deg=route.max_slope_deg if route is not None else None,
        status=result.status.value,
        unknown_segments=result.unknown_segments,
        warnings=list(result.warnings),
        evidence_ids=list(result.evidence_ids),
        assumptions=list(result.assumptions),
    )


@missions_router.post("/missions/plan", response_model=MissionPlanResponseSchema, status_code=201)
def plan_mission(
    payload: MissionPlanRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    request = MissionPlanningRequest(
        region_id=payload.region_id,
        base_position=LocalPosition(
            payload.base_position.x_m,
            payload.base_position.y_m,
            payload.base_position.frame_id,
        ),
        objective_ids=tuple(payload.objective_ids),
        constraints=RoutePlanningConstraints(
            max_slope_deg=payload.constraints.max_slope_deg,
            speed_m_per_min=payload.constraints.speed_m_per_min,
            avoid_unknown=payload.constraints.avoid_unknown,
        ),
        resources=SupportResources(
            payload.resources.oxygen_available_min,
            payload.resources.return_reserve_min,
        ),
        activity_durations_min=tuple(payload.activity_durations_min.items()),
    )
    try:
        plan = MissionPlanner(terrain, objectives).plan(request)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stored = missions.create(mission_create_from_plan(plan))
    return _mission_response(stored)


@missions_router.get("/missions/{mission_id}", response_model=MissionPlanResponseSchema)
def get_mission(mission_id: str, missions: MissionDep) -> MissionPlanResponseSchema:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    return _mission_response(stored)


def _mission_response(stored: StoredMission) -> MissionPlanResponseSchema:
    return MissionPlanResponseSchema.model_validate(
        {
            "mission_id": stored.mission_id,
            "mission_version": stored.current_version,
            "region_id": stored.region_id,
            "frame_id": stored.frame_id,
            "terrain_version": stored.terrain_version,
            "lifecycle_status": stored.lifecycle_status.value,
            "viability_status": stored.viability_status.value,
            **stored.snapshot,
        }
    )
