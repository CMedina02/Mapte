"""Deterministic A* planner with hard safety constraints and operational costs."""

from dataclasses import dataclass, replace
from heapq import heappop, heappush
from itertools import count
from math import atan2, ceil, degrees, hypot, inf, radians, tan

from app.modules.missions.routing.coarse import coarse_grid
from app.modules.missions.routing.models import (
    InvalidRouteEndpointError,
    PlannedRoute,
    RouteNotFoundError,
    RoutePlanningConstraints,
    RouteSearchLimitError,
    RouteWaypoint,
)
from app.modules.missions.terrain import (
    GridCell,
    LocalPosition,
    MissionHazardOverlay,
    RoutingTerrainSample,
    TraversalStatus,
)
from app.modules.missions.terrain.hazards import (
    GRID_BLOCKED,
    GRID_TRAVERSABLE,
    GRID_UNKNOWN,
    RoutingGrid,
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

# Agotar el límite deja la ruta sin confirmar.
MAX_EXPANDED_NODES = 1_500_000
# Cerca del umbral de pendiente, usa atan2.
_SLOPE_EPS = 1e-9
# Búsqueda en dos niveles: solo para rutas de al menos esta longitud en línea recta
TWO_LEVEL_MIN_M = 600.0
# Semiancho del pasillo fino alrededor del trazo grueso
CORRIDOR_RADIUS_M = 200.0
# El A* ponderado puede aumentar el costo de la ruta dentro del corredor.
CORRIDOR_WEIGHT = 1.05


@dataclass(frozen=True, slots=True)
class _Step:
    distance_m: float
    ascent_m: float
    slope_deg: float
    unknown_distance_m: float
    hazard_penalty_m: float
    operational_cost: float


def _astar(
    grid: RoutingGrid,
    px: float,
    py: float,
    start: int,
    goal: int,
    constraints: RoutePlanningConstraints,
    closed: bytearray | None = None,
    weight: float = 1.0,
) -> tuple[list[int], int]:
    """A* sobre la rejilla precalculada con índices planos (sin objetos por celda).

    Mismo costo, mismas restricciones y mismo desempate (prioridad, orden de llegada) que la
    evaluación por celda de _evaluate_step, que sigue validando la ruta final en _build_result.
    La heurística suma al octil el ascenso neto mínimo hasta el destino: es admisible y
    consistente (todo camino sube al menos el desnivel neto y cada paso cobra su ascenso), así
    que la ruta sigue siendo la de menor costo, pero se exploran muchas menos celdas.
    """
    width, height = grid.width, grid.height
    elevations = grid.elevations
    status = grid.status
    multipliers = grid.multipliers
    avoid_unknown = constraints.avoid_unknown
    ascent_factor = constraints.ascent_cost_factor
    max_slope = constraints.max_slope_deg
    tan_slope = tan(radians(max_slope))
    diagonal = hypot(px, py)

    # (desplazamiento plano, fila, columna, distancia, desnivel máximo, es diagonal)
    neighbors = []
    for dr, dc in _NEIGHBOR_OFFSETS:
        distance = hypot(dc * px, dr * py)
        neighbors.append((dr * width + dc, dr, dc, distance, tan_slope * distance, bool(dr and dc)))
    max_dz_x = tan_slope * px  # lado de una diagonal en la misma fila
    max_dz_y = tan_slope * py  # lado de una diagonal en la misma columna

    def too_steep(dz: float, max_dz: float, distance: float) -> bool:
        dz = abs(dz)
        if dz <= max_dz * (1 - _SLOPE_EPS):
            return False
        if dz > max_dz * (1 + _SLOPE_EPS):
            return True
        return degrees(atan2(dz, distance)) > max_slope  # caso límite: la regla exacta

    def blocked(index: int) -> bool:
        value = status[index]
        return value == GRID_BLOCKED or (avoid_unknown and value == GRID_UNKNOWN)

    goal_row, goal_col = divmod(goal, width)
    goal_z = elevations[goal]

    def heuristic(index: int, row: int, col: int) -> float:
        rows = abs(goal_row - row)
        cols = abs(goal_col - col)
        diagonal_steps = rows if rows < cols else cols
        straight = abs(rows - cols) * (py if rows > cols else px)
        climb = goal_z - elevations[index]
        return diagonal_steps * diagonal + straight + (climb * ascent_factor if climb > 0 else 0.0)

    sequence = count()
    frontier: list[tuple[float, int, int]] = [
        (heuristic(start, *divmod(start, width)), next(sequence), start)
    ]
    costs: dict[int, float] = {start: 0.0}
    came_from: dict[int, int] = {}
    # Las celdas fuera del corredor empiezan marcadas como cerradas.
    if closed is None:
        closed = bytearray(width * height)
    expanded_nodes = 0
    push, pop = heappush, heappop

    while frontier:
        _, _, current = pop(frontier)
        if closed[current]:
            continue
        closed[current] = 1
        expanded_nodes += 1
        if current == goal:
            path = [goal]
            while path[-1] != start:
                path.append(came_from[path[-1]])
            path.reverse()
            return path, expanded_nodes
        if expanded_nodes >= MAX_EXPANDED_NODES:
            raise RouteSearchLimitError(
                "Search limit reached before confirming the result",
                expanded_nodes=expanded_nodes,
            )

        row, col = divmod(current, width)
        z = elevations[current]
        base_cost = costs[current]
        current_multiplier = multipliers[current]
        for offset, dr, dc, distance, max_dz, is_diagonal in neighbors:
            nrow = row + dr
            ncol = col + dc
            if nrow < 0 or nrow >= height or ncol < 0 or ncol >= width:
                continue
            neighbor = current + offset
            if closed[neighbor] or blocked(neighbor):
                continue
            dz = elevations[neighbor] - z
            if too_steep(dz, max_dz, distance):
                continue
            if is_diagonal:
                side_h = current + dc
                side_v = current + dr * width
                if blocked(side_h) or blocked(side_v):
                    continue
                if too_steep(elevations[side_h] - z, max_dz_x, px):
                    continue
                if too_steep(elevations[side_v] - z, max_dz_y, py):
                    continue
            neighbor_multiplier = multipliers[neighbor]
            multiplier = (
                neighbor_multiplier
                if neighbor_multiplier > current_multiplier
                else current_multiplier
            )
            new_cost = base_cost + distance * multiplier + (dz * ascent_factor if dz > 0 else 0.0)
            if new_cost >= costs.get(neighbor, inf):
                continue
            costs[neighbor] = new_cost
            came_from[neighbor] = current
            push(
                frontier,
                (new_cost + weight * heuristic(neighbor, nrow, ncol), next(sequence), neighbor),
            )

    raise RouteNotFoundError("No route satisfies the requested constraints")


class AStarRoutePlanner:
    """Find a safe route; distance is only the final component of operational cost."""

    def __init__(self, terrain: MissionHazardOverlay, *, exact: bool = False) -> None:
        self._terrain = terrain
        self._exact = exact  # True: siempre la búsqueda fina completa (óptimo global)

    def plan(
        self,
        start: LocalPosition,
        end: LocalPosition,
        constraints: RoutePlanningConstraints = RoutePlanningConstraints(),
    ) -> PlannedRoute:
        start_cell = self._require_endpoint("start", start, constraints)
        end_cell = self._require_endpoint("destination", end, constraints)
        if start_cell == end_cell:
            return self._build_result((start_cell,), 1, constraints)

        indices, expanded_nodes = self._search(start_cell, end_cell, constraints)
        width = self._terrain.width
        cells = tuple(GridCell(index // width, index % width) for index in indices)
        return self._build_result(cells, expanded_nodes, constraints)

    def _search(
        self,
        start_cell: GridCell,
        end_cell: GridCell,
        constraints: RoutePlanningConstraints,
    ) -> tuple[list[int], int]:
        """Búsqueda en dos niveles para rutas largas; exacta para cortas o si se pide.

        1) A* en la rejilla gruesa (20 m, 25 veces menos celdas) para el trazo general.
        2) A* fino (4 m) solo en un pasillo de CORRIDOR_RADIUS_M alrededor de ese trazo.
        Si cualquiera falla, se hace la búsqueda fina completa: nunca se declara "sin ruta" por el
        atajo. Con el pasillo y CORRIDOR_WEIGHT la ruta puede costar algo más que la óptima global
        (las pruebas acotan la diferencia); exact=True da siempre el óptimo.
        """
        grid = self._terrain.routing_grid()
        px = self._terrain.pixel_size_x_m
        py = self._terrain.pixel_size_y_m
        width = grid.width
        start = start_cell.row * width + start_cell.column
        goal = end_cell.row * width + end_cell.column
        span_m = hypot(
            (end_cell.column - start_cell.column) * px, (end_cell.row - start_cell.row) * py
        )
        if self._exact or span_m < TWO_LEVEL_MIN_M:
            return _astar(grid, px, py, start, goal, constraints)

        coarse_expanded = 0
        try:
            corridor, coarse_expanded = self._corridor(grid, start_cell, end_cell, constraints)
            path, expanded = _astar(
                grid, px, py, start, goal, constraints, closed=corridor, weight=CORRIDOR_WEIGHT
            )
            return path, coarse_expanded + expanded
        except (RouteNotFoundError, RouteSearchLimitError):
            path, expanded = _astar(grid, px, py, start, goal, constraints)
            return path, coarse_expanded + expanded

    def _corridor(
        self,
        grid: RoutingGrid,
        start_cell: GridCell,
        end_cell: GridCell,
        constraints: RoutePlanningConstraints,
    ) -> tuple[bytearray, int]:
        """Trazo en la rejilla gruesa → máscara 'closed' de la fina con solo el pasillo abierto."""
        coarse = coarse_grid(grid)
        k = coarse.factor
        level = coarse.strict if constraints.avoid_unknown else coarse.loose
        cw, ch = level.width, level.height
        c_start = (start_cell.row // k) * cw + start_cell.column // k
        c_goal = (end_cell.row // k) * cw + end_cell.column // k
        status = bytearray(level.status)
        status[c_start] = status[c_goal] = GRID_TRAVERSABLE
        level = replace(level, status=status)
        coarse_constraints = replace(constraints, avoid_unknown=False)
        path, expanded = _astar(
            level,
            self._terrain.pixel_size_x_m * k,
            self._terrain.pixel_size_y_m * k,
            c_start,
            c_goal,
            coarse_constraints,
        )

        radius = max(1, ceil(CORRIDOR_RADIUS_M / (self._terrain.pixel_size_x_m * k)))
        open_blocks = bytearray(cw * ch)
        one_row = b"\x01" * (2 * radius + 1)
        for index in path:
            row, col = divmod(index, cw)
            c0, c1 = max(col - radius, 0), min(col + radius, cw - 1)
            for r in range(max(row - radius, 0), min(row + radius, ch - 1) + 1):
                open_blocks[r * cw + c0 : r * cw + c1 + 1] = one_row[: c1 - c0 + 1]

        width, height = grid.width, grid.height
        closed = bytearray(b"\x01") * (width * height)
        for crow in range(ch):
            row_bytes = open_blocks[crow * cw : (crow + 1) * cw]
            col = row_bytes.find(1)
            while col != -1:
                stop = row_bytes.find(0, col)
                stop = cw if stop == -1 else stop
                x0, x1 = col * k, min(stop * k, width)
                zeros = bytes(x1 - x0)
                for fine_row in range(crow * k, min(crow * k + k, height)):
                    closed[fine_row * width + x0 : fine_row * width + x1] = zeros
                col = row_bytes.find(1, stop)
        return closed, expanded

    def _require_endpoint(
        self,
        label: str,
        position: LocalPosition,
        constraints: RoutePlanningConstraints,
    ) -> GridCell:
        cell = self._terrain.position_to_cell(position)
        if cell is None:
            raise InvalidRouteEndpointError(f"The {label} is outside the region")
        sample = self._terrain.sample_cell(cell)
        if not self._is_usable(sample, constraints):
            reason = ", ".join(sample.restriction_codes) or sample.traversal_status
            raise InvalidRouteEndpointError(f"The {label} is not traversable: {reason}")
        return cell

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

        distance_m = hypot(
            (neighbor.column - current.column) * self._terrain.pixel_size_x_m,
            (neighbor.row - current.row) * self._terrain.pixel_size_y_m,
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
            distance_m = hypot(
                (side_cell.column - current.column) * self._terrain.pixel_size_x_m,
                (side_cell.row - current.row) * self._terrain.pixel_size_y_m,
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
                raise RuntimeError("The reconstructed route contains an unknown elevation")
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
                raise RuntimeError("The reconstructed route contains an invalid step")
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
                f"Constant speed: {constraints.speed_m_per_min:g} m/min",
                f"Maximum slope: {constraints.max_slope_deg:g}°",
                f"Provisional ascent cost factor: {constraints.ascent_cost_factor:g}",
                "Endpoints are snapped to the center of the terrain cell containing them",
                "Oxygen, radiation, dust and fatigue are evaluated outside the search",
            ),
        )
