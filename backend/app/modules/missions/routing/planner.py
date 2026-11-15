"""Deterministic A* planner with hard safety constraints and operational costs."""

from dataclasses import dataclass
from heapq import heappop, heappush
from itertools import count
from math import atan2, degrees, hypot, inf

from app.modules.missions.routing.models import (
    InvalidRouteEndpointError,
    PlannedRoute,
    RouteNotFoundError,
    RoutePlanningConstraints,
    RouteWaypoint,
)
from app.modules.missions.terrain import (
    GridCell,
    LocalPosition,
    MissionHazardOverlay,
    RoutingTerrainSample,
    TraversalStatus,
)

_NEIGHBOR_OFFSETS = (
    (-1, 0),
    (1, 0),
    (0, -1),
    (0, 1),
    (-1, -1),
    (-1, 1),
    (1, -1),
    (1, 1),
)


@dataclass(frozen=True, slots=True)
class _Step:
    distance_m: float
    ascent_m: float
    slope_deg: float
    unknown_distance_m: float
    hazard_penalty_m: float
    operational_cost: float


class AStarRoutePlanner:
    """Find a safe route; distance is only the final component of operational cost."""

    def __init__(self, terrain: MissionHazardOverlay) -> None:
        self._terrain = terrain

    def plan(
        self,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints = RoutePlanningConstraints(),
    ) -> PlannedRoute:
        start_cell = self._require_endpoint("origen", start, constraints)
        end_cell = self._require_endpoint("destino", end, constraints)
        if start_cell == end_cell:
            return self._build_result((start_cell,), 1, constraints)

        sequence = count()
        frontier: list[tuple[float, int, GridCell]] = []
        heappush(frontier, (self._heuristic(start_cell, end_cell), next(sequence), start_cell))
        came_from: dict[GridCell, GridCell] = {}
        costs: dict[GridCell, float] = {start_cell: 0.0}
        closed: set[GridCell] = set()
        expanded_nodes = 0

        while frontier:
            _, _, current = heappop(frontier)
            if current in closed:
                continue
            closed.add(current)
            expanded_nodes += 1
            if current == end_cell:
                cells = self._reconstruct(came_from, start_cell, end_cell)
                return self._build_result(cells, expanded_nodes, constraints)

            current_sample = self._terrain.sample_cell(current)
            for neighbor in self._neighbors(current):
                if neighbor in closed:
                    continue
                neighbor_sample = self._terrain.sample_cell(neighbor)
                step = self._evaluate_step(
                    current,
                    current_sample,
                    neighbor,
                    neighbor_sample,
                    constraints,
                )
                if step is None:
                    continue

                new_cost = costs[current] + step.operational_cost
                if new_cost >= costs.get(neighbor, inf):
                    continue
                costs[neighbor] = new_cost
                came_from[neighbor] = current
                priority = new_cost + self._heuristic(neighbor, end_cell)
                heappush(frontier, (priority, next(sequence), neighbor))

        raise RouteNotFoundError("No existe una ruta que cumpla las restricciones solicitadas")

    def _require_endpoint(
        self,
        label: str,
        position: LocalPosition,
        constraints: RoutePlanningConstraints,
    ) -> GridCell:
        cell = self._terrain.position_to_cell(position)
        if cell is None:
            raise InvalidRouteEndpointError(f"El {label} está fuera de la región")
        sample = self._terrain.sample_cell(cell)
        if not self._is_usable(sample, constraints):
            reason = ", ".join(sample.restriction_codes) or sample.traversal_status
            raise InvalidRouteEndpointError(f"El {label} no es transitable: {reason}")
        return cell

    def _neighbors(self, cell: GridCell):
        for row_offset, column_offset in _NEIGHBOR_OFFSETS:
            row = cell.row + row_offset
            column = cell.column + column_offset
            if 0 <= row < self._terrain.height and 0 <= column < self._terrain.width:
                yield GridCell(row, column)

    def _evaluate_step(
        self,
        current: GridCell,
        current_sample: RoutingTerrainSample,
        neighbor: GridCell,
        neighbor_sample: RoutingTerrainSample,
        constraints: RoutePlanningConstraints,
    ) -> _Step | None:
        if not self._is_usable(neighbor_sample, constraints):
            return None
        if current.row != neighbor.row and current.column != neighbor.column:
            if not self._diagonal_clear(current, current_sample, neighbor, constraints):
                return None

        if current_sample.elevation_m is None or neighbor_sample.elevation_m is None:
            return None

        current_position = self._terrain.cell_position(current)
        neighbor_position = self._terrain.cell_position(neighbor)
        distance_m = hypot(
            neighbor_position.x_m - current_position.x_m,
            neighbor_position.y_m - current_position.y_m,
        )
        elevation_delta = neighbor_sample.elevation_m - current_sample.elevation_m
        slope_deg = degrees(atan2(abs(elevation_delta), distance_m))
        if slope_deg > constraints.max_slope_deg:
            return None

        ascent_m = max(elevation_delta, 0.0)
        unknown_distance_m = (
            distance_m if neighbor_sample.traversal_status is TraversalStatus.UNKNOWN else 0.0
        )
        multiplier = max(current_sample.cost_multiplier, neighbor_sample.cost_multiplier)
        hazard_penalty_m = distance_m * (multiplier - 1.0)
        operational_cost = distance_m * multiplier + ascent_m * constraints.ascent_cost_factor
        return _Step(
            distance_m=distance_m,
            ascent_m=ascent_m,
            slope_deg=slope_deg,
            unknown_distance_m=unknown_distance_m,
            hazard_penalty_m=hazard_penalty_m,
            operational_cost=operational_cost,
        )

    def _diagonal_clear(
        self,
        current: GridCell,
        current_sample: RoutingTerrainSample,
        neighbor: GridCell,
        constraints: RoutePlanningConstraints,
    ) -> bool:
        side_cells = (
            GridCell(current.row, neighbor.column),
            GridCell(neighbor.row, current.column),
        )
        for side_cell in side_cells:
            side_sample = self._terrain.sample_cell(side_cell)
            if not self._is_usable(side_sample, constraints):
                return False
            if current_sample.elevation_m is None or side_sample.elevation_m is None:
                return False
            current_position = self._terrain.cell_position(current)
            side_position = self._terrain.cell_position(side_cell)
            distance_m = hypot(
                side_position.x_m - current_position.x_m,
                side_position.y_m - current_position.y_m,
            )
            slope_deg = degrees(
                atan2(abs(side_sample.elevation_m - current_sample.elevation_m), distance_m)
            )
            if slope_deg > constraints.max_slope_deg:
                return False
        return True

    @staticmethod
    def _is_usable(sample: RoutingTerrainSample, constraints: RoutePlanningConstraints) -> bool:
        if sample.elevation_m is None or sample.traversal_status is TraversalStatus.BLOCKED:
            return False
        return not (
            constraints.avoid_unknown and sample.traversal_status is TraversalStatus.UNKNOWN
        )

    def _heuristic(self, current: GridCell, goal: GridCell) -> float:
        current_position = self._terrain.cell_position(current)
        goal_position = self._terrain.cell_position(goal)
        return hypot(
            goal_position.x_m - current_position.x_m,
            goal_position.y_m - current_position.y_m,
        )

    @staticmethod
    def _reconstruct(
        came_from: dict[GridCell, GridCell], start: GridCell, end: GridCell
    ) -> tuple[GridCell, ...]:
        path = [end]
        current = end
        while current != start:
            current = came_from[current]
            path.append(current)
        path.reverse()
        return tuple(path)

    def _build_result(
        self,
        cells: tuple[GridCell, ...],
        expanded_nodes: int,
        constraints: RoutePlanningConstraints,
    ) -> PlannedRoute:
        samples = tuple(self._terrain.sample_cell(cell) for cell in cells)
        points_list: list[RouteWaypoint] = []
        for cell, sample in zip(cells, samples, strict=True):
            if sample.elevation_m is None:
                raise RuntimeError("La ruta reconstruida contiene una elevación desconocida")
            position = self._terrain.cell_position(cell)
            points_list.append(
                RouteWaypoint(
                    x_m=position.x_m,
                    y_m=position.y_m,
                    z_m=sample.elevation_m,
                    frame_id=self._terrain.frame_id,
                )
            )
        points = tuple(points_list)

        distance_m = 0.0
        ascent_m = 0.0
        max_slope_deg = 0.0
        unknown_distance_m = 0.0
        hazard_penalty_m = 0.0
        for index in range(1, len(cells)):
            step = self._evaluate_step(
                cells[index - 1],
                samples[index - 1],
                cells[index],
                samples[index],
                constraints,
            )
            if step is None:
                raise RuntimeError("La ruta reconstruida contiene un paso inválido")
            distance_m += step.distance_m
            ascent_m += step.ascent_m
            max_slope_deg = max(max_slope_deg, step.slope_deg)
            unknown_distance_m += step.unknown_distance_m
            hazard_penalty_m += step.hazard_penalty_m

        return PlannedRoute(
            region_id=self._terrain.region_id,
            frame_id=self._terrain.frame_id,
            terrain_version=self._terrain.terrain_version,
            terrain_view_version=self._terrain.version,
            cells=cells,
            path=points,
            distance_m=distance_m,
            duration_min=distance_m / constraints.speed_m_per_min,
            ascent_m=ascent_m,
            max_slope_deg=max_slope_deg,
            unknown_distance_m=unknown_distance_m,
            hazard_penalty_m=hazard_penalty_m,
            expanded_nodes=expanded_nodes,
            assumptions=(
                f"Velocidad constante: {constraints.speed_m_per_min:g} m/min",
                f"Pendiente máxima: {constraints.max_slope_deg:g}°",
                f"Factor provisional de costo por ascenso: {constraints.ascent_cost_factor:g}",
                "Los extremos se ajustan al centro de la celda de terreno que los contiene",
                "Oxígeno, radiación, polvo y fatiga se evalúan fuera del buscador",
            ),
        )
