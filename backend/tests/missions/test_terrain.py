import pytest

from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    FrameMismatchError,
    GridCell,
    GridGeometry,
    HazardEffect,
    LocalPosition,
    MissionHazardOverlay,
    SyntheticTerrainProvider,
    TerrainDataStatus,
    TerrainRestriction,
    TraversalStatus,
)

FRAME_ID = "MARS_GALE_MT_SHARP_LOCAL_TEST_V1"


def geometry() -> GridGeometry:
    return GridGeometry(
        frame_id=FRAME_ID,
        width=3,
        height=2,
        cell_size_m=10,
        upper_left_x_m=-15,
        upper_left_y_m=10,
    )


def provider() -> SyntheticTerrainProvider:
    return SyntheticTerrainProvider(
        geometry=geometry(),
        elevations_m=((100.0, None, 102.0), (99.0, 100.0, 101.0)),
        restrictions={
            GridCell(1, 2): (
                TerrainRestriction(
                    code="DUNE_EXCLUSION",
                    traversal_status=TraversalStatus.BLOCKED,
                ),
            )
        },
    )


def test_geometry_converts_between_local_positions_and_cells() -> None:
    grid = geometry()

    assert grid.min_x_m == -15
    assert grid.max_x_m == 15
    assert grid.min_y_m == -10
    assert grid.max_y_m == 10
    assert grid.world_to_cell(LocalPosition(-10, 5, FRAME_ID)) == GridCell(0, 0)
    assert grid.world_to_cell(LocalPosition(14.999, -9.999, FRAME_ID)) == GridCell(1, 2)
    assert grid.cell_center(GridCell(1, 2)) == LocalPosition(10, -5, FRAME_ID)

    assert grid.world_to_cell(LocalPosition(15, 0, FRAME_ID)) is None
    assert grid.world_to_cell(LocalPosition(0, -10, FRAME_ID)) is None
    with pytest.raises(FrameMismatchError):
        grid.world_to_cell(LocalPosition(0, 0, "OTHER_FRAME"))


def test_synthetic_provider_preserves_valid_nodata_blocked_and_outside() -> None:
    terrain = provider()

    valid = terrain.sample_cell(GridCell(0, 0))
    assert valid.elevation_m == 100
    assert valid.data_status is TerrainDataStatus.VALID
    assert valid.traversal_status is TraversalStatus.TRAVERSABLE

    nodata = terrain.sample_cell(GridCell(0, 1))
    assert nodata.elevation_m is None
    assert nodata.data_status is TerrainDataStatus.NODATA
    assert nodata.traversal_status is TraversalStatus.UNKNOWN

    blocked = terrain.sample_cell(GridCell(1, 2))
    assert blocked.elevation_m == 101
    assert blocked.traversal_status is TraversalStatus.BLOCKED
    assert blocked.restriction_codes == ("DUNE_EXCLUSION",)

    outside = terrain.sample_cell(GridCell(20, 20))
    assert outside.data_status is TerrainDataStatus.OUTSIDE
    assert outside.traversal_status is TraversalStatus.UNKNOWN


def test_synthetic_provider_rejects_malformed_grids_and_restrictions() -> None:
    with pytest.raises(ValueError, match="filas"):
        SyntheticTerrainProvider(geometry=geometry(), elevations_m=((1.0, 2.0, 3.0),))
    with pytest.raises(ValueError, match="geometry.width"):
        SyntheticTerrainProvider(geometry=geometry(), elevations_m=((1.0, 2.0), (3.0, 4.0)))
    with pytest.raises(ValueError, match="fuera de la cuadrícula"):
        SyntheticTerrainProvider(
            geometry=geometry(),
            elevations_m=((1.0, 2.0, 3.0), (4.0, 5.0, 6.0)),
            restrictions={
                GridCell(9, 9): (TerrainRestriction("INVALID", TraversalStatus.BLOCKED),)
            },
        )


def test_hazard_overlay_blocks_cells_without_mutating_base_terrain() -> None:
    base = provider()
    report = EnvironmentalHazardReport(
        report_id="report-001",
        mission_version=2,
        position=LocalPosition(-10, 5, FRAME_ID),
        hazard_code="ROCKFALL",
        effect=HazardEffect.BLOCKED,
        affected_radius_m=0,
    )
    effective = MissionHazardOverlay(base, (report,))

    assert base.sample_cell(GridCell(0, 0)).traversal_status is TraversalStatus.TRAVERSABLE
    affected = effective.sample_cell(GridCell(0, 0))
    assert affected.traversal_status is TraversalStatus.BLOCKED
    assert affected.restriction_codes == ("ASTRONAUT_REPORT:ROCKFALL:report-001",)
    assert effective.sample_cell(GridCell(1, 0)).traversal_status is TraversalStatus.TRAVERSABLE


def test_hazard_overlay_supports_unknown_and_high_cost_effects() -> None:
    base = provider()
    reports = (
        EnvironmentalHazardReport(
            report_id="report-unknown",
            mission_version=2,
            position=LocalPosition(0, -5, FRAME_ID),
            hazard_code="UNKNOWN_HAZARD",
            effect=HazardEffect.UNKNOWN,
            affected_radius_m=0,
        ),
        EnvironmentalHazardReport(
            report_id="report-sand",
            mission_version=2,
            position=LocalPosition(-10, -5, FRAME_ID),
            hazard_code="LOOSE_SAND",
            effect=HazardEffect.HIGH_COST,
            affected_radius_m=0,
            cost_multiplier=3,
        ),
    )
    effective = MissionHazardOverlay(base, reports)

    assert effective.sample_cell(GridCell(1, 1)).traversal_status is TraversalStatus.UNKNOWN
    sand = effective.sample_cell(GridCell(1, 0))
    assert sand.traversal_status is TraversalStatus.TRAVERSABLE
    assert sand.cost_multiplier == 3


def test_hazard_overlay_rejects_wrong_frame_and_outside_reports() -> None:
    base = provider()
    with pytest.raises(FrameMismatchError):
        MissionHazardOverlay(
            base,
            (
                EnvironmentalHazardReport(
                    report_id="wrong-frame",
                    mission_version=1,
                    position=LocalPosition(0, 0, "OTHER_FRAME"),
                    hazard_code="ROCKFALL",
                    effect=HazardEffect.BLOCKED,
                    affected_radius_m=1,
                ),
            ),
        )

    with pytest.raises(ValueError, match="fuera de la región"):
        MissionHazardOverlay(
            base,
            (
                EnvironmentalHazardReport(
                    report_id="outside",
                    mission_version=1,
                    position=LocalPosition(100, 100, FRAME_ID),
                    hazard_code="ROCKFALL",
                    effect=HazardEffect.BLOCKED,
                    affected_radius_m=1,
                ),
            ),
        )
