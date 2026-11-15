"""HTTP route-computation endpoint for Backend 2."""

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.api.schemas import (
    MissionPlanRequestSchema,
    MissionPlanResponseSchema,
    MissionReplanRequestSchema,
    RouteRequestSchema,
    RouteResultSchema,
)
from app.modules.missions.persistence import (
    MissionEventDraft,
    MissionRepository,
    MissionUpdate,
    MissionVersionConflictError,
    StoredMission,
)
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
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    FrameMismatchError,
    HazardEffect,
    LocalPosition,
)

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


@missions_router.post(
    "/missions/{mission_id}/hazard-reports",
    response_model=MissionPlanResponseSchema,
)
def report_hazard_and_replan(
    mission_id: str,
    payload: MissionReplanRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    if payload.expected_version != stored.current_version:
        raise HTTPException(status_code=409, detail="La misión fue actualizada por otro cliente.")
    original_ids = tuple(stored.snapshot["objective_ids"])
    completed = tuple(dict.fromkeys(payload.completed_objective_ids))
    if not set(completed).issubset(original_ids):
        raise HTTPException(status_code=400, detail="Hay objetivos completados ajenos a la misión.")
    remaining = tuple(item for item in original_ids if item not in completed)
    report_id = str(uuid4())
    report = EnvironmentalHazardReport(
        report_id=report_id,
        mission_version=payload.expected_version,
        position=_local_position(payload.report.position),
        hazard_code=payload.report.hazard_code,
        effect=HazardEffect(payload.report.effect),
        affected_radius_m=payload.report.affected_radius_m,
        cost_multiplier=payload.report.cost_multiplier,
    )
    previous_reports = tuple(
        _hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", [])
    )
    return_position = _local_position_data(stored.snapshot["return_position"])
    request = MissionPlanningRequest(
        region_id=stored.region_id,
        base_position=_local_position(payload.current_position),
        return_position=return_position,
        objective_ids=remaining,
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
        plan = MissionPlanner(terrain, objectives, (*previous_reports, report)).plan(request)
        draft = mission_create_from_plan(plan)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    report_data = {
        "report_id": report_id,
        "mission_version": payload.expected_version,
        "position": _position_data(report.position),
        "hazard_code": report.hazard_code,
        "effect": report.effect.value,
        "affected_radius_m": report.affected_radius_m,
        "cost_multiplier": report.cost_multiplier,
    }
    snapshot = {
        **draft.snapshot,
        "objective_ids": list(original_ids),
        "completed_objective_ids": list(completed),
        "hazard_reports": [*stored.snapshot.get("hazard_reports", []), report_data],
    }
    try:
        updated = missions.update(
            mission_id,
            MissionUpdate(
                expected_version=payload.expected_version,
                lifecycle_status=stored.lifecycle_status,
                viability_status=draft.viability_status,
                snapshot=snapshot,
                routes=draft.routes,
                events=(
                    *draft.events,
                    MissionEventDraft(str(uuid4()), "hazard_reported", report_data),
                ),
            ),
        )
    except MissionVersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _mission_response(updated)


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


def _local_position(position) -> LocalPosition:
    return LocalPosition(position.x_m, position.y_m, position.frame_id)


def _local_position_data(position: dict) -> LocalPosition:
    return LocalPosition(position["x_m"], position["y_m"], position["frame_id"])


def _position_data(position: LocalPosition) -> dict:
    return {"x_m": position.x_m, "y_m": position.y_m, "frame_id": position.frame_id}


def _hazard_from_data(data: dict) -> EnvironmentalHazardReport:
    return EnvironmentalHazardReport(
        report_id=data["report_id"],
        mission_version=data["mission_version"],
        position=_local_position_data(data["position"]),
        hazard_code=data["hazard_code"],
        effect=HazardEffect(data["effect"]),
        affected_radius_m=data["affected_radius_m"],
        cost_multiplier=data["cost_multiplier"],
    )
