"""Pure domain models for constrained route planning."""

from dataclasses import dataclass
from math import isfinite

from app.modules.missions.terrain import GridCell, LocalPosition


class InvalidRouteEndpointError(ValueError):
    """A route endpoint is outside the usable terrain or in the wrong frame."""


class RouteNotFoundError(ValueError):
    """No route satisfies the requested safety constraints."""


class RouteSearchLimitError(ValueError):
    """The search hit its expansion budget before proving a route exists or not."""

    def __init__(self, message: str, expanded_nodes: int) -> None:
        super().__init__(message)
        self.expanded_nodes = expanded_nodes


@dataclass(frozen=True, slots=True)
class RoutePlanningConstraints:
    max_slope_deg: float = 15.0
    speed_m_per_min: float = 20.0
    avoid_unknown: bool = True
    ascent_cost_factor: float = 1.0

    def __post_init__(self) -> None:
        if not isfinite(self.max_slope_deg) or not 0 <= self.max_slope_deg < 90:
            raise ValueError("max_slope_deg must be finite and between 0 and 90")
        if not isfinite(self.speed_m_per_min) or self.speed_m_per_min <= 0:
            raise ValueError("speed_m_per_min must be positive and finite")
        if not isfinite(self.ascent_cost_factor) or self.ascent_cost_factor < 0:
            raise ValueError("ascent_cost_factor must be finite and non-negative")


@dataclass(frozen=True, slots=True)
class RouteWaypoint:
    x_m: float
    y_m: float
    z_m: float
    frame_id: str


@dataclass(frozen=True, slots=True)
class PlannedRoute:
    region_id: str
    frame_id: str
    terrain_version: str
    terrain_view_version: str
    cells: tuple[GridCell, ...]
    path: tuple[RouteWaypoint, ...]
    distance_m: float
    duration_min: float
    ascent_m: float
    max_slope_deg: float
    unknown_distance_m: float
    hazard_penalty_m: float
    expanded_nodes: int
    assumptions: tuple[str, ...]

    @property
    def start(self) -> LocalPosition:
        point = self.path[0]
        return LocalPosition(point.x_m, point.y_m, point.frame_id)

    @property
    def end(self) -> LocalPosition:
        point = self.path[-1]
        return LocalPosition(point.x_m, point.y_m, point.frame_id)
