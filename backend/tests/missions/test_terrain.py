from dataclasses import replace

import pytest

from app.modules.catalog.domain import (
    DataQuality,
    InMemoryTerrainRepository,
    LocalExtentM,
    TerrainDataset,
    TerrainGridData,
    TerrainQualityZone,
    build_synthetic_terrain,
)
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    FrameMismatchError,
    GridCell,
    HazardEffect,
    LocalPosition,
    MissionHazardOverlay,
    TerrainDataStatus,
    TraversalStatus,
)

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"


def repository(*, with_unknown_zone: bool = False) -> InMemoryTerrainRepository:
    dataset = build_synthetic_terrain(
        region_id=REGION_ID,
        frame_id=FRAME_ID,
        width_px=4,
        height_px=4,
        pixel_size_m=10,
        terrain_version="gale-ms-test-v1",
    )
    if with_unknown_zone:
        metadata = replace(
            dataset.metadata,
            quality_zones=(
                TerrainQualityZone(
                    zone_id="east-artifacts",
                    quality=DataQuality.UNKNOWN,
                    extent_m=LocalExtentM(30, 40, 0, 40),
                    reason="Artefactos de rejilla del DEM",
                ),
            ),
        )
        grid_data = TerrainGridData(
            metadata=metadata,
            elevations_m=dataset.grid_data.elevations_m,
            blocked_mask=dataset.grid_data.blocked_mask,
        )
        dataset = TerrainDataset(metadata=metadata, grid_data=grid_data)
    return InMemoryTerrainRepository((dataset,))


def test_overlay_consumes_shared_repository_metadata() -> None:
    terrain = MissionHazardOverlay(repository(), REGION_ID)

    assert terrain.region_id == REGION_ID
    assert terrain.frame_id == FRAME_ID
    assert terrain.terrain_version == "gale-ms-test-v1"
    assert terrain.version == "gale-ms-test-v1+reports:none"


def test_catalog_nodata_blocked_unknown_and_outside_are_not_traversable() -> None:
    terrain = MissionHazardOverlay(repository(with_unknown_zone=True), REGION_ID)

    valid = terrain.sample_cell(GridCell(0, 0))
    assert valid.data_status is TerrainDataStatus.VALID
    assert valid.traversal_status is TraversalStatus.TRAVERSABLE

    nodata = terrain.sample_cell(GridCell(1, 1))
    assert nodata.elevation_m is None
    assert nodata.data_status is TerrainDataStatus.NODATA
    assert nodata.traversal_status is TraversalStatus.BLOCKED
    assert nodata.restriction_codes == ("TERRAIN:NODATA",)

    blocked = terrain.sample_cell(GridCell(2, 2))
    assert blocked.traversal_status is TraversalStatus.BLOCKED
    assert blocked.restriction_codes == ("TERRAIN:BLOCKED",)

    unknown = terrain.sample_cell(GridCell(0, 3))
    assert unknown.traversal_status is TraversalStatus.UNKNOWN
    assert unknown.restriction_codes == ("TERRAIN:DATA_QUALITY_UNKNOWN",)

    outside = terrain.sample_cell(GridCell(20, 20))
    assert outside.data_status is TerrainDataStatus.OUTSIDE
    assert outside.traversal_status is TraversalStatus.BLOCKED


def test_hazard_overlay_blocks_cells_without_mutating_base_terrain() -> None:
    base = repository()
    report = EnvironmentalHazardReport(
        report_id="report-001",
        mission_version=2,
        position=LocalPosition(5, 35, FRAME_ID),
        hazard_code="ROCKFALL",
        effect=HazardEffect.BLOCKED,
        affected_radius_m=0,
    )
    effective = MissionHazardOverlay(base, REGION_ID, (report,))

    assert base.get_terrain(REGION_ID).sample_at_index(0, 0).is_blocked is False
    affected = effective.sample_cell(GridCell(0, 0))
    assert affected.traversal_status is TraversalStatus.BLOCKED
    assert affected.restriction_codes == ("ASTRONAUT_REPORT:ROCKFALL:report-001",)
    assert effective.sample_cell(GridCell(0, 1)).traversal_status is TraversalStatus.TRAVERSABLE


def test_hazard_overlay_supports_unknown_and_high_cost_effects() -> None:
    reports = (
        EnvironmentalHazardReport(
            report_id="report-unknown",
            mission_version=2,
            position=LocalPosition(15, 35, FRAME_ID),
            hazard_code="UNKNOWN_HAZARD",
            effect=HazardEffect.UNKNOWN,
            affected_radius_m=0,
        ),
        EnvironmentalHazardReport(
            report_id="report-sand",
            mission_version=2,
            position=LocalPosition(5, 25, FRAME_ID),
            hazard_code="LOOSE_SAND",
            effect=HazardEffect.HIGH_COST,
            affected_radius_m=0,
            cost_multiplier=3,
        ),
    )
    effective = MissionHazardOverlay(repository(), REGION_ID, reports)

    assert effective.sample_cell(GridCell(0, 1)).traversal_status is TraversalStatus.UNKNOWN
    sand = effective.sample_cell(GridCell(1, 0))
    assert sand.traversal_status is TraversalStatus.TRAVERSABLE
    assert sand.cost_multiplier == 3


def test_hazard_overlay_rejects_wrong_frame_and_outside_reports() -> None:
    base = repository()
    with pytest.raises(FrameMismatchError):
        MissionHazardOverlay(
            base,
            REGION_ID,
            (
                EnvironmentalHazardReport(
                    report_id="wrong-frame",
                    mission_version=1,
                    position=LocalPosition(5, 35, "OTHER_FRAME"),
                    hazard_code="ROCKFALL",
                    effect=HazardEffect.BLOCKED,
                    affected_radius_m=1,
                ),
            ),
        )

    with pytest.raises(ValueError, match="fuera de la región"):
        MissionHazardOverlay(
            base,
            REGION_ID,
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
