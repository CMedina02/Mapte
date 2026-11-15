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
    RouteSearchLimitError,
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


# Rutas repetidas (panel y visor piden la misma, replanes, tramos de regreso) se sirven de caché
_ROUTE_CACHE_LIMIT = 256
_LIMIT_ASSUMPTION = "La búsqueda alcanzó su límite de cálculo sin confirmar si existe una ruta"
_NO_ROUTE_ASSUMPTION = (
    "No se encontró una ruta ni siquiera permitiendo datos de calidad desconocida"
)


class RouteApplicationService:
    def __init__(
        self,
        terrain_repository: TerrainRepository,
        reports: tuple[EnvironmentalHazardReport, ...] = (),
    ) -> None:
        self._repository = terrain_repository
        self._reports = reports
        self._overlays: dict[str, MissionHazardOverlay] = {}

    def _overlay(self, region_id: str) -> MissionHazardOverlay:
        # Una vista por región y servicio: un plan calcula varios tramos sobre los mismos reportes
        overlay = self._overlays.get(region_id)
        if overlay is None:
            overlay = MissionHazardOverlay(self._repository, region_id, self._reports)
            self._overlays[region_id] = overlay
        return overlay

    def compute(
        self,
        region_id: str,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints,
    ) -> RouteComputation:
        terrain = self._overlay(region_id)
        cache = terrain.route_cache()
        key = (
            terrain.version,
            start.x_m,
            start.y_m,
            start.frame_id,
            end.x_m,
            end.y_m,
            end.frame_id,
            constraints,
        )
        cached = cache.get(key)
        if cached is not None:
            cache.move_to_end(key)
            return replace(cached, route_id=str(uuid4()))
        result = self._compute(region_id, terrain, start, end, constraints)
        cache[key] = result
        if len(cache) > _ROUTE_CACHE_LIMIT:
            cache.popitem(last=False)
        return result

    def _compute(
        self,
        region_id: str,
        terrain: MissionHazardOverlay,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints,
    ) -> RouteComputation:
        metadata = self._repository.get_metadata(region_id)
        planner = AStarRoutePlanner(terrain)

        route: PlannedRoute | None = None
        strict_failure: Exception | None = None
        try:
            route = planner.plan(start, end, constraints)
        except (InvalidRouteEndpointError, RouteNotFoundError, RouteSearchLimitError) as exc:
            strict_failure = exc
        limit_reached = isinstance(strict_failure, RouteSearchLimitError)

        used_unknown_fallback = False
        if route is None and constraints.avoid_unknown and not limit_reached:
            try:
                route = planner.plan(start, end, replace(constraints, avoid_unknown=False))
                used_unknown_fallback = True
            except (InvalidRouteEndpointError, RouteNotFoundError):
                pass
            except RouteSearchLimitError:
                limit_reached = True

        if route is None:
            if isinstance(strict_failure, InvalidRouteEndpointError):
                raise strict_failure
            # Tope de búsqueda: no se probó que no exista ruta → desconocido, nunca "no viable"
            return RouteComputation(
                route_id=str(uuid4()),
                region_id=region_id,
                frame_id=metadata.sector.frame_id,
                terrain_version=metadata.consistency.terrain_version,
                status=RouteOutcomeStatus.UNKNOWN
                if limit_reached
                else RouteOutcomeStatus.NOT_VIABLE,
                route=None,
                unknown_segments=0,
                warnings=(
                    "ROUTE_SEARCH_LIMIT_REACHED"
                    if limit_reached
                    else "NO_ROUTE_WITHIN_CONSTRAINTS",
                    *self._hazard_warnings(terrain),
                ),
                evidence_ids=metadata.consistency.evidence_ids,
                assumptions=(
                    _LIMIT_ASSUMPTION if limit_reached else _NO_ROUTE_ASSUMPTION,
                    self._hazard_assumption(terrain),
                ),
            )

        unknown_segments = self._count_unknown_segments(terrain, route)
        status = (
            RouteOutcomeStatus.UNKNOWN
            if used_unknown_fallback or unknown_segments > 0
            else RouteOutcomeStatus.VIABLE
        )
        warnings = list(self._hazard_warnings(terrain))
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
                self._hazard_assumption(terrain),
            ),
        )

    @staticmethod
    def _hazard_warnings(terrain: MissionHazardOverlay) -> tuple[str, ...]:
        return () if terrain.has_static_hazards else ("STATIC_HAZARDS_NOT_AVAILABLE",)

    @staticmethod
    def _hazard_assumption(terrain: MissionHazardOverlay) -> str:
        return (
            "Zonas de exclusión del catálogo bloqueadas; zonas de precaución con costo mayor"
            if terrain.has_static_hazards
            else "Los peligros estáticos del catálogo aún no están publicados"
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
