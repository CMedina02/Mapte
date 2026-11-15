"""Simulated EVA walk: follow the A* route, deviate on purpose and reroute.

Everything here is a demonstration. The walk, the deviation and the timing are
synthetic; only the terrain, the hazard zones and the route planner are the
real ones used by missions.
"""

from bisect import bisect_right
from dataclasses import dataclass, field
from enum import StrEnum
from math import atan2, cos, degrees, hypot, radians, sin

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.routing import (
    InvalidRouteEndpointError,
    RouteApplicationService,
    RouteComputation,
    RouteOutcomeStatus,
    RoutePlanningConstraints,
)
from app.modules.missions.terrain import (
    LocalPosition,
    MissionHazardOverlay,
    TraversalStatus,
)

WARN_DEVIATION_M = 30.0
REROUTE_DEVIATION_M = 60.0
_DRIFT_SUBSTEP_M = 2.0
_EPS = 1e-6


class SimulationStatus(StrEnum):
    FOLLOWING = "following"
    DRIFTING = "drifting"
    ARRIVED = "arrived"
    STOPPED = "stopped"


class SimulationAction(StrEnum):
    NONE = "none"
    WARN = "warn"
    REROUTED = "rerouted"
    ARRIVED = "arrived"
    STOP = "stop"


_ACTION_PRIORITY = {
    SimulationAction.NONE: 0,
    SimulationAction.WARN: 1,
    SimulationAction.REROUTED: 2,
    SimulationAction.ARRIVED: 3,
    SimulationAction.STOP: 4,
}


class SimulationRouteError(ValueError):
    """The initial route cannot be walked, so the simulation does not start."""


@dataclass(frozen=True, slots=True)
class DeviationPlan:
    """Where and how the astronaut leaves the route (only once per simulation)."""

    at_fraction: float = 0.4
    side: str = "left"  # "left" | "right", relative to the walking direction
    angle_deg: float = 60.0

    def __post_init__(self) -> None:
        if not 0 < self.at_fraction < 1:
            raise ValueError("at_fraction must be between 0 and 1")
        if self.side not in ("left", "right"):
            raise ValueError("side debe ser 'left' o 'right'")
        if not 0 < self.angle_deg <= 90:
            raise ValueError("angle_deg must be between 0 and 90")


@dataclass(frozen=True, slots=True)
class SimulationEvent:
    t_s: float
    event_type: str
    message: str
    x_m: float
    y_m: float


@dataclass(frozen=True, slots=True)
class StepOutcome:
    action: SimulationAction
    message: str


@dataclass(slots=True)
class _Path:
    points: list[tuple[float, float, float]]
    cumulative_m: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        total = 0.0
        self.cumulative_m = [0.0]
        for (x0, y0, _), (x1, y1, _) in zip(self.points, self.points[1:], strict=False):
            total += hypot(x1 - x0, y1 - y0)
            self.cumulative_m.append(total)

    @property
    def length_m(self) -> float:
        return self.cumulative_m[-1]

    def at(self, distance_m: float) -> tuple[float, float, float, float]:
        """Interpolated (x, y, z, heading_deg) at a distance along the path."""
        if len(self.points) == 1:
            x, y, z = self.points[0]
            return x, y, z, 0.0
        s = min(max(distance_m, 0.0), self.length_m)
        i = min(bisect_right(self.cumulative_m, s) - 1, len(self.points) - 2)
        (x0, y0, z0), (x1, y1, z1) = self.points[i], self.points[i + 1]
        seg = self.cumulative_m[i + 1] - self.cumulative_m[i]
        u = 0.0 if seg <= 0 else (s - self.cumulative_m[i]) / seg
        heading = _bearing(x1 - x0, y1 - y0)
        return x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u, heading

    def distance_to(self, x: float, y: float) -> float:
        if len(self.points) == 1:
            return hypot(x - self.points[0][0], y - self.points[0][1])
        best = float("inf")
        for (x0, y0, _), (x1, y1, _) in zip(self.points, self.points[1:], strict=False):
            dx, dy = x1 - x0, y1 - y0
            seg2 = dx * dx + dy * dy
            u = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / seg2))
            best = min(best, hypot(x - (x0 + dx * u), y - (y0 + dy * u)))
        return best


def _bearing(dx: float, dy: float) -> float:
    """Compass bearing in degrees: 0 = +y (north), 90 = +x (east)."""
    return degrees(atan2(dx, dy)) % 360


class EvaSimulation:
    """One simulated walk. Not thread-safe: callers serialize ``step``."""

    def __init__(
        self,
        sim_id: str,
        terrain_repository: TerrainRepository,
        region_id: str,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints,
        speed_factor: float,
        deviation: DeviationPlan | None,
    ) -> None:
        if speed_factor <= 0:
            raise ValueError("speed_factor debe ser positivo")
        self.sim_id = sim_id
        self.region_id = region_id
        self.destination = end
        self.constraints = constraints
        self.speed_factor = speed_factor
        self.deviation = deviation
        self.warn_m = WARN_DEVIATION_M
        self.reroute_m = REROUTE_DEVIATION_M
        self._routes = RouteApplicationService(terrain_repository)
        self._terrain = MissionHazardOverlay(terrain_repository, region_id)

        computation = self._compute(start)  # InvalidRouteEndpointError -> caller (400)
        if computation is None:
            raise SimulationRouteError(
                "No viable route between start and destination with these constraints."
            )
        self.route = computation
        self.original_route_id = computation.route_id
        self.route_version = 1
        self.reroute_count = 0
        self._path = self._path_of(computation)
        self.progress_m = 0.0
        self.status = SimulationStatus.FOLLOWING
        self.t_s = 0.0
        x, y, z, heading = self._path.at(0.0)
        self.x_m, self.y_m, self.z_m, self.heading_deg = x, y, z, heading
        self._deviation_done = deviation is None
        self._warned = False
        self.last_action = SimulationAction.NONE
        self.last_message = "Route calculated. Start walking."
        self.log: list[SimulationEvent] = []
        self._record(
            "route_planned",
            f"A* route of {self._path.length_m:.0f} m to the destination.",
        )

    # --- public state -------------------------------------------------------

    @property
    def finished(self) -> bool:
        return self.status in (SimulationStatus.ARRIVED, SimulationStatus.STOPPED)

    @property
    def deviation_m(self) -> float:
        return self._path.distance_to(self.x_m, self.y_m)

    @property
    def on_route(self) -> bool:
        return self.deviation_m < self.warn_m

    @property
    def remaining_m(self) -> float | None:
        if self.status is SimulationStatus.DRIFTING:
            return None  # desconocida hasta que el backend recalcule
        if self.status is SimulationStatus.STOPPED:
            return None
        return max(self._path.length_m - self.progress_m, 0.0)

    @property
    def eta_min(self) -> float | None:
        remaining = self.remaining_m
        return None if remaining is None else remaining / self.constraints.speed_m_per_min

    # --- simulation ---------------------------------------------------------

    def step(self, dt_s: float) -> StepOutcome:
        """Advance ``dt_s`` real seconds (× speed_factor simulated seconds)."""
        if dt_s <= 0:
            raise ValueError("dt_s debe ser positivo")
        if self.finished:
            return StepOutcome(SimulationAction.NONE, self.last_message)

        sim_seconds = dt_s * self.speed_factor
        self.t_s += sim_seconds
        budget = self.constraints.speed_m_per_min / 60.0 * sim_seconds
        action, message = SimulationAction.NONE, "On route."

        def raise_to(new: SimulationAction, text: str) -> None:
            nonlocal action, message
            if _ACTION_PRIORITY[new] >= _ACTION_PRIORITY[action]:
                action, message = new, text

        while budget > _EPS and not self.finished:
            if self.status is SimulationStatus.FOLLOWING:
                budget = self._follow(budget, raise_to)
            else:
                budget = self._drift(budget, raise_to)

        if self.status is SimulationStatus.DRIFTING and action is SimulationAction.NONE:
            action, message = (
                (SimulationAction.WARN, self._off_route_text())
                if self._warned
                else (SimulationAction.NONE, "Leaving the route…")
            )
        self.last_action, self.last_message = action, message
        return StepOutcome(action, message)

    def _follow(self, budget: float, raise_to) -> float:
        total = self._path.length_m
        trigger = None
        if not self._deviation_done and self.deviation is not None:
            trigger = self.deviation.at_fraction * total
        limit = trigger if trigger is not None and trigger > self.progress_m else total
        move = min(budget, limit - self.progress_m)
        self.progress_m += max(move, 0.0)
        budget -= max(move, 0.0)
        self.x_m, self.y_m, self.z_m, self.heading_deg = self._path.at(self.progress_m)

        if self.progress_m >= total - _EPS:
            self.status = SimulationStatus.ARRIVED
            self._record("arrived", "You reached the destination.")
            raise_to(SimulationAction.ARRIVED, "You reached the destination.")
            return 0.0
        if trigger is not None and self.progress_m >= trigger - _EPS:
            assert self.deviation is not None
            turn = self.deviation.angle_deg * (-1 if self.deviation.side == "left" else 1)
            self.heading_deg = (self.heading_deg + turn) % 360
            self.status = SimulationStatus.DRIFTING
            self._deviation_done = True
            self._record(
                "deviation_started",
                f"The astronaut veers to the {'left' if turn < 0 else 'right'}.",
            )
        return budget

    def _drift(self, budget: float, raise_to) -> float:
        rad = radians(self.heading_deg)
        dx, dy = sin(rad), cos(rad)
        while budget > _EPS:
            move = min(budget, _DRIFT_SUBSTEP_M)
            nx, ny = self.x_m + dx * move, self.y_m + dy * move
            blocked = self._blocked_reason(nx, ny)
            if blocked is not None:
                self._record("hazard_ahead", blocked)
                return self._reroute(budget, raise_to, f"{blocked} Route recalculated.")
            self.x_m, self.y_m = nx, ny
            self.z_m = self._elevation(nx, ny, self.z_m)
            budget -= move
            deviation = self.deviation_m
            if deviation >= self.reroute_m:
                self._record("off_route", f"Off route ({deviation:.0f} m).")
                return self._reroute(
                    budget,
                    raise_to,
                    f"Off route ({deviation:.0f} m): recalculated from your position.",
                )
            if deviation >= self.warn_m and not self._warned:
                self._warned = True
                self._record("off_route_warning", self._off_route_text())
                raise_to(SimulationAction.WARN, self._off_route_text())
        return 0.0

    def _reroute(self, budget: float, raise_to, message: str) -> float:
        here = LocalPosition(self.x_m, self.y_m, self._terrain.frame_id)
        try:
            computation = self._compute(here)
        except InvalidRouteEndpointError:
            computation = None
        if computation is None:
            self.status = SimulationStatus.STOPPED
            text = "No safe route from your position. Stop and wait for instructions."
            self._record("stopped", text)
            raise_to(SimulationAction.STOP, text)
            return 0.0
        self.route = computation
        self.route_version += 1
        self.reroute_count += 1
        self._path = self._path_of(computation)
        self.progress_m = 0.0
        self.status = SimulationStatus.FOLLOWING
        self._warned = False
        self.x_m, self.y_m, self.z_m, self.heading_deg = self._path.at(0.0)
        self._record("rerouted", f"New route of {self._path.length_m:.0f} m to the destination.")
        raise_to(SimulationAction.REROUTED, message)
        return budget

    # --- helpers ------------------------------------------------------------

    def _compute(self, start: LocalPosition) -> RouteComputation | None:
        computation = self._routes.compute(
            self.region_id, start, self.destination, self.constraints
        )
        if computation.status is RouteOutcomeStatus.NOT_VIABLE or computation.route is None:
            return None
        return computation

    @staticmethod
    def _path_of(computation: RouteComputation) -> _Path:
        assert computation.route is not None
        return _Path([(p.x_m, p.y_m, p.z_m) for p in computation.route.path])

    def _sample(self, x: float, y: float):
        cell = self._terrain.position_to_cell(LocalPosition(x, y, self._terrain.frame_id))
        return None if cell is None else self._terrain.sample_cell(cell)

    def _blocked_reason(self, x: float, y: float) -> str | None:
        sample = self._sample(x, y)
        if sample is None or sample.elevation_m is None:
            return "No terrain data ahead."
        if sample.traversal_status is not TraversalStatus.BLOCKED:
            return None
        if any(code.startswith("STATIC_HAZARD:") for code in sample.restriction_codes):
            return "Exclusion zone ahead."
        return "Blocked terrain ahead."

    def _elevation(self, x: float, y: float, fallback: float) -> float:
        sample = self._sample(x, y)
        return fallback if sample is None or sample.elevation_m is None else sample.elevation_m

    def _off_route_text(self) -> str:
        return f"Off route ({self.deviation_m:.0f} m)."

    def _record(self, event_type: str, message: str) -> None:
        event = SimulationEvent(round(self.t_s, 1), event_type, message, self.x_m, self.y_m)
        self.log.append(event)
