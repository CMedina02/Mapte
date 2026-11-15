"""HTTP route-computation endpoint for Backend 2."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.api.schemas import RouteRequestSchema, RouteResultSchema
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
