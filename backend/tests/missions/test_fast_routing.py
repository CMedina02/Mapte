"""El A* rápido (rejilla precalculada) debe decidir igual que la regla por celda (sample_cell)."""

import random
from dataclasses import replace
from heapq import heappop, heappush
from math import inf
from pathlib import Path

import pytest

from app.modules.catalog.infrastructure.terrain_loader import load_catalog
from app.modules.missions.routing import planner as planner_module
from app.modules.missions.routing.models import RoutePlanningConstraints
from app.modules.missions.routing.planner import AStarRoutePlanner
from app.modules.missions.routing.service import RouteApplicationService, RouteOutcomeStatus
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    GridCell,
    LocalPosition,
    MissionHazardOverlay,
    TraversalStatus,
)
from app.modules.missions.terrain.hazards import (
    GRID_BLOCKED,
    GRID_TRAVERSABLE,
    GRID_UNKNOWN,
    HazardEffect,
)

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"
DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "regions"

pytestmark = pytest.mark.skipif(
    not (DATA_ROOT / REGION_ID / "derived" / "terrain.json").exists(),
    reason="Requiere el terreno real de Monte Sharp",
)


@pytest.fixture(scope="module")
def repository():
    return load_catalog(DATA_ROOT, [REGION_ID]).terrain_repository


def _status(sample) -> int:
    return {
        TraversalStatus.TRAVERSABLE: GRID_TRAVERSABLE,
        TraversalStatus.UNKNOWN: GRID_UNKNOWN,
        TraversalStatus.BLOCKED: GRID_BLOCKED,
    }[sample.traversal_status]


def _assert_grid_matches(overlay: MissionHazardOverlay, cells) -> None:
    grid = overlay.routing_grid()
    for cell in cells:
        sample = overlay.sample_cell(cell)
        index = cell.row * grid.width + cell.column
        assert grid.status[index] == _status(sample), cell
        if sample.traversal_status is not TraversalStatus.BLOCKED:
            assert grid.multipliers[index] == pytest.approx(sample.cost_multiplier), cell


def test_grid_matches_per_cell_rules_including_zones_and_reports(repository):
    report = EnvironmentalHazardReport(
        report_id="r1",
        mission_version=1,
        position=LocalPosition(4500, 4500, FRAME_ID),
        hazard_code="ROCKFALL",
        effect=HazardEffect.HIGH_COST,
        affected_radius_m=150,
        cost_multiplier=4,
    )
    overlay = MissionHazardOverlay(repository, REGION_ID, (report,))
    rng = random.Random(7)
    cells = [GridCell(rng.randrange(2500), rng.randrange(2500)) for _ in range(4000)]
    # celdas dentro y alrededor de las dunas (exclusión), del boxwork (precaución) y del reporte
    for x, y in [(5400, 5350), (5080, 5450), (5540, 4520), (4500, 4500), (4640, 4500)]:
        cell = overlay.position_to_cell(LocalPosition(x, y, FRAME_ID))
        cells += [
            GridCell(cell.row + dr, cell.column + dc) for dr in range(-3, 4) for dc in range(-3, 4)
        ]
    _assert_grid_matches(overlay, cells)


def _route_cost(planner: AStarRoutePlanner, cells, constraints) -> float:
    terrain = planner._terrain
    total = 0.0
    for a, b in zip(cells, cells[1:], strict=False):
        step = planner._evaluate_step(
            a, terrain.sample_cell(a), b, terrain.sample_cell(b), constraints
        )
        assert step is not None
        total += step.operational_cost
    return total


def _reference_cost(overlay, planner, start, end, constraints, margin=80) -> float:
    """Dijkstra con la regla por celda (_evaluate_step) en una ventana: costo de referencia."""
    rows = range(min(start.row, end.row) - margin, max(start.row, end.row) + margin + 1)
    cols = range(min(start.column, end.column) - margin, max(start.column, end.column) + margin + 1)
    costs = {start: 0.0}
    frontier = [(0.0, start.row, start.column)]
    done = set()
    while frontier:
        cost, row, col = heappop(frontier)
        current = GridCell(row, col)
        if current in done:
            continue
        done.add(current)
        if current == end:
            return cost
        sample = overlay.sample_cell(current)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if not (dr or dc) or row + dr not in rows or col + dc not in cols:
                    continue
                neighbor = GridCell(row + dr, col + dc)
                step = planner._evaluate_step(
                    current, sample, neighbor, overlay.sample_cell(neighbor), constraints
                )
                if step is None:
                    continue
                new_cost = cost + step.operational_cost
                if new_cost < costs.get(neighbor, inf):
                    costs[neighbor] = new_cost
                    heappush(frontier, (new_cost, neighbor.row, neighbor.column))
    return inf


@pytest.mark.parametrize(
    ("start_xy", "end_xy", "slope", "avoid_unknown"),
    [
        ((5523.3, 2882.8), (5300.0, 3200.0), 15, True),
        ((4950.0, 5350.0), (5900.0, 5350.0), 25, False),  # rodea las dunas (exclusión)
        ((5400.0, 4250.0), (5650.0, 4800.0), 20, True),  # cruza el boxwork (precaución)
    ],
)
def test_fast_search_finds_the_least_cost_route(repository, start_xy, end_xy, slope, avoid_unknown):
    overlay = MissionHazardOverlay(repository, REGION_ID)
    planner = AStarRoutePlanner(overlay)
    constraints = RoutePlanningConstraints(max_slope_deg=slope, avoid_unknown=avoid_unknown)
    start = LocalPosition(*start_xy, FRAME_ID)
    end = LocalPosition(*end_xy, FRAME_ID)

    route = planner.plan(start, end, constraints)
    reference = _reference_cost(
        overlay,
        planner,
        overlay.position_to_cell(start),
        overlay.position_to_cell(end),
        constraints,
    )
    assert _route_cost(planner, route.cells, constraints) == pytest.approx(reference, rel=1e-9)


def test_search_limit_reports_unknown_not_not_viable(repository, monkeypatch):
    monkeypatch.setattr(planner_module, "MAX_EXPANDED_NODES", 50)
    service = RouteApplicationService(repository)
    result = service.compute(
        REGION_ID,
        LocalPosition(5523.3, 2882.8, FRAME_ID),
        LocalPosition(4034.4, 6417.9, FRAME_ID),
        RoutePlanningConstraints(max_slope_deg=15, avoid_unknown=True),
    )
    assert result.status is RouteOutcomeStatus.UNKNOWN
    assert result.route is None
    assert "ROUTE_SEARCH_LIMIT_REACHED" in result.warnings


def test_repeated_route_is_served_from_cache(repository):
    service = RouteApplicationService(repository)
    args = (
        REGION_ID,
        LocalPosition(5523.3, 2882.8, FRAME_ID),
        LocalPosition(5300.0, 3200.0, FRAME_ID),
        RoutePlanningConstraints(max_slope_deg=15),
    )
    first = service.compute(*args)
    second = RouteApplicationService(repository).compute(*args)
    assert second.route is first.route  # mismo resultado, sin volver a buscar
    assert second.route_id != first.route_id
    other = service.compute(*args[:3], replace(args[3], max_slope_deg=14))
    assert other.route is not first.route
