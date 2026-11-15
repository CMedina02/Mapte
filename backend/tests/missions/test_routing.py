from dataclasses import replace

import pytest

from app.modules.catalog.domain import (
    DataQuality,
    InMemoryTerrainRepository,
    LocalExtentM,
    TerrainDataset,
    TerrainGridData,
    TerrainQualityZone,
    VerticalReferenceSpec,
    build_synthetic_terrain,
)
from app.modules.missions.routing import (
    AStarRoutePlanner,
    InvalidRouteEndpointError,
    RouteNotFoundError,
    RoutePlanningConstraints,
)
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    GridCell,
    HazardEffect,
    LocalPosition,
    MissionHazardOverlay,
)

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"


def build_planner(
    elevations: tuple[tuple[float | None, ...], ...],
    *,
    blocked: set[GridCell] | None = None,
    unknown_extent: LocalExtentM | None = None,
    reports: tuple[EnvironmentalHazardReport, ...] = (),
) -> AStarRoutePlanner:
    height = len(elevations)
    width = len(elevations[0])
    source = build_synthetic_terrain(
        region_id=REGION_ID,
        frame_id=FRAME_ID,
        width_px=width,
        height_px=height,
        pixel_size_m=10,
        terrain_version="routing-test-v1",
    )
    quality_zones = ()
    if unknown_extent is not None:
        quality_zones = (
            TerrainQualityZone(
                zone_id="unknown-test-zone",
                quality=DataQuality.UNKNOWN,
                extent_m=unknown_extent,
                reason="Zona desconocida de prueba",
            ),
        )
    metadata = replace(
        source.metadata,
        vertical=VerticalReferenceSpec(
            vertical_datum="test",
            elevation_min_m=-5000,
            elevation_max_m=0,
        ),
        quality_zones=quality_zones,
    )
    flat_elevations = [
        float("nan") if value is None else value for row in elevations for value in row
    ]
    blocked_mask = [
        GridCell(row, column) in (blocked or set())
        for row in range(height)
        for column in range(width)
    ]
    terrain = TerrainGridData(
        metadata=metadata,
        elevations_m=flat_elevations,
        blocked_mask=blocked_mask,
    )
    repository = InMemoryTerrainRepository((TerrainDataset(metadata, terrain),))
    overlay = MissionHazardOverlay(repository, REGION_ID, reports)
    return AStarRoutePlanner(overlay)


def position(row: int, column: int, *, height: int = 3) -> LocalPosition:
    return LocalPosition(
        x_m=5 + column * 10,
        y_m=(height * 10 - 5) - row * 10,
        frame_id=FRAME_ID,
    )


def flat_grid(width: int = 5, height: int = 3) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(-3500.0 for _ in range(width)) for _ in range(height))


def test_planner_returns_3d_metrics_and_traceable_versions() -> None:
    route = build_planner(flat_grid()).plan(position(1, 0), position(1, 4))

    assert route.cells == tuple(GridCell(1, column) for column in range(5))
    assert route.distance_m == pytest.approx(40)
    assert route.duration_min == pytest.approx(2)
    assert route.ascent_m == 0
    assert route.max_slope_deg == 0
    assert all(point.z_m == -3500 for point in route.path)
    assert route.region_id == REGION_ID
    assert route.frame_id == FRAME_ID
    assert route.terrain_version == "routing-test-v1"


def test_planner_detours_around_blocked_and_nodata_cells() -> None:
    blocked_route = build_planner(flat_grid(), blocked={GridCell(1, 2)}).plan(
        position(1, 0), position(1, 4)
    )
    assert GridCell(1, 2) not in blocked_route.cells
    assert blocked_route.distance_m > 40

    elevations = [list(row) for row in flat_grid()]
    elevations[1][2] = None
    nodata_route = build_planner(tuple(tuple(row) for row in elevations)).plan(
        position(1, 0), position(1, 4)
    )
    assert GridCell(1, 2) not in nodata_route.cells


def test_planner_rejects_steep_edges_and_uses_lower_slope_route() -> None:
    elevations = [list(row) for row in flat_grid()]
    elevations[1][2] = -3490
    route = build_planner(tuple(tuple(row) for row in elevations)).plan(
        position(1, 0), position(1, 4)
    )

    assert GridCell(1, 2) not in route.cells
    assert route.max_slope_deg <= 15


def test_planner_avoids_dynamic_high_cost_hazard() -> None:
    report = EnvironmentalHazardReport(
        report_id="loose-sand",
        mission_version=2,
        position=position(1, 2),
        hazard_code="LOOSE_SAND",
        effect=HazardEffect.HIGH_COST,
        affected_radius_m=0,
        cost_multiplier=10,
    )
    route = build_planner(flat_grid(), reports=(report,)).plan(position(1, 0), position(1, 4))

    assert GridCell(1, 2) not in route.cells
    assert route.hazard_penalty_m == 0


def test_unknown_is_blocked_by_default_and_measured_when_allowed() -> None:
    planner = build_planner(
        flat_grid(),
        unknown_extent=LocalExtentM(20, 30, 10, 20),
    )
    avoided = planner.plan(position(1, 0), position(1, 4))
    assert GridCell(1, 2) not in avoided.cells

    allowed = planner.plan(
        position(1, 0),
        position(1, 4),
        RoutePlanningConstraints(avoid_unknown=False),
    )
    assert GridCell(1, 2) in allowed.cells
    assert allowed.unknown_distance_m > 0


def test_planner_rejects_invalid_endpoints_and_reports_no_safe_route() -> None:
    planner = build_planner(flat_grid(width=3), blocked={GridCell(1, 1)})
    with pytest.raises(InvalidRouteEndpointError, match="fuera de la región"):
        planner.plan(LocalPosition(-1, 15, FRAME_ID), position(1, 2))
    with pytest.raises(ValueError, match="frame_id"):
        planner.plan(LocalPosition(5, 15, "OTHER_FRAME"), position(1, 2))

    wall = {GridCell(row, 1) for row in range(3)}
    with pytest.raises(RouteNotFoundError):
        build_planner(flat_grid(width=3), blocked=wall).plan(position(1, 0), position(1, 2))


def test_diagonal_route_cannot_cut_between_blocked_cells() -> None:
    planner = build_planner(
        flat_grid(width=2, height=2),
        blocked={GridCell(0, 1), GridCell(1, 0)},
    )
    with pytest.raises(RouteNotFoundError):
        planner.plan(position(0, 0, height=2), position(1, 1, height=2))
