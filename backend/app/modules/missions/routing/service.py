"""Application service that classifies constrained route-search outcomes."""

from dataclasses import dataclass, replace
from enum import StrEnum
from uuid import uuid4

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.routing.models import (
    InvalidRouteEndpointError,
    PlannedRoute,
    RouteNotFoundError,
    RoutePlanningConstraints,
)
from app.modules.missions.routing.planner import AStarRoutePlanner
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    LocalPosition,
    MissionHazardOverlay,
    TraversalStatus,
)


class RouteOutcomeStatus(StrEnum):
    VIABLE = "viable"
    NOT_VIABLE = "not_viable"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class RouteComputation:
    route_id: str
    region_id: str
    frame_id: str
    terrain_version: str
    status: RouteOutcomeStatus
    route: PlannedRoute | None
    unknown_segments: int
    warnings: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    assumptions: tuple[str, ...]


class RouteApplicationService:
    def __init__(
        self,
        terrain_repository: TerrainRepository,
        reports: tuple[EnvironmentalHazardReport, ...] = (),
    ) -> None:
        self._repository = terrain_repository
        self._reports = reports

    def compute(
        self,
        region_id: str,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints,
    ) -> RouteComputation:
        metadata = self._repository.get_metadata(region_id)
        terrain = MissionHazardOverlay(self._repository, region_id, self._reports)
        planner = AStarRoutePlanner(terrain)

        route: PlannedRoute | None = None
        strict_failure: InvalidRouteEndpointError | RouteNotFoundError | None = None
        try:
            route = planner.plan(start, end, constraints)
        except (InvalidRouteEndpointError, RouteNotFoundError) as exc:
            strict_failure = exc

        used_unknown_fallback = False
        if route is None and constraints.avoid_unknown:
            try:
                route = planner.plan(start, end, replace(constraints, avoid_unknown=False))
                used_unknown_fallback = True
            except (InvalidRouteEndpointError, RouteNotFoundError):
                pass

        if route is None:
            if isinstance(strict_failure, InvalidRouteEndpointError):
                raise strict_failure
            return RouteComputation(
                route_id=str(uuid4()),
                region_id=region_id,
                frame_id=metadata.sector.frame_id,
                terrain_version=metadata.consistency.terrain_version,
                status=RouteOutcomeStatus.NOT_VIABLE,
                route=None,
                unknown_segments=0,
                warnings=(
                    "NO_ROUTE_WITHIN_CONSTRAINTS",
                    "STATIC_HAZARDS_NOT_AVAILABLE",
                ),
                evidence_ids=metadata.consistency.evidence_ids,
                assumptions=(
                    "No se encontró una ruta ni siquiera permitiendo datos de calidad desconocida",
                    "Los peligros estáticos del catálogo aún no están publicados",
                ),
            )

        unknown_segments = self._count_unknown_segments(terrain, route)
        status = (
            RouteOutcomeStatus.UNKNOWN
            if used_unknown_fallback or unknown_segments > 0
            else RouteOutcomeStatus.VIABLE
        )
        warnings = ["STATIC_HAZARDS_NOT_AVAILABLE"]
        if status is RouteOutcomeStatus.UNKNOWN:
            warnings.append("ROUTE_CROSSES_UNKNOWN_TERRAIN")
        if self._endpoints_were_snapped(start, end, route):
            warnings.append("ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS")

        return RouteComputation(
            route_id=str(uuid4()),
            region_id=region_id,
            frame_id=route.frame_id,
            terrain_version=route.terrain_version,
            status=status,
            route=route,
            unknown_segments=unknown_segments,
            warnings=tuple(warnings),
            evidence_ids=metadata.consistency.evidence_ids,
            assumptions=(
                *route.assumptions,
                "Los peligros estáticos del catálogo aún no están publicados",
            ),
        )

    @staticmethod
    def _count_unknown_segments(terrain: MissionHazardOverlay, route: PlannedRoute) -> int:
        segments = 0
        inside_unknown = False
        for cell in route.cells:
            is_unknown = terrain.sample_cell(cell).traversal_status is TraversalStatus.UNKNOWN
            if is_unknown and not inside_unknown:
                segments += 1
            inside_unknown = is_unknown
        return segments

    @staticmethod
    def _endpoints_were_snapped(
        start: LocalPosition, end: LocalPosition, route: PlannedRoute
    ) -> bool:
        return start != route.start or end != route.end
