from dataclasses import replace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import register_error_handlers
from app.main import create_app
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
from app.modules.catalog.infrastructure.terrain_loader import load_catalog
from app.modules.missions.api import missions_router
from tests.catalog._region_fixture import FRAME_ID, REGION_ID, write_region


def repository(
    *, blocked_columns: set[int] | None = None, unknown_columns: set[int] | None = None
) -> InMemoryTerrainRepository:
    dataset = build_synthetic_terrain(
        region_id=REGION_ID,
        frame_id=FRAME_ID,
        width_px=3,
        height_px=3,
        pixel_size_m=10,
        terrain_version="api-test-v1",
    )
    zones = tuple(
        TerrainQualityZone(
            zone_id=f"unknown-column-{column}",
            quality=DataQuality.UNKNOWN,
            extent_m=LocalExtentM(column * 10, (column + 1) * 10, 0, 30),
            reason="Zona desconocida de prueba",
        )
        for column in sorted(unknown_columns or set())
    )
    metadata = replace(
        dataset.metadata,
        vertical=VerticalReferenceSpec(
            vertical_datum="test",
            elevation_min_m=-5000,
            elevation_max_m=0,
        ),
        quality_zones=zones,
    )
    blocked_mask = [
        column in (blocked_columns or set()) for _row in range(3) for column in range(3)
    ]
    grid = TerrainGridData(
        metadata=metadata,
        elevations_m=[-3500.0] * 9,
        blocked_mask=blocked_mask,
    )
    return InMemoryTerrainRepository((TerrainDataset(metadata, grid),))


def make_client(terrain_repository=None) -> TestClient:
    application = FastAPI()
    register_error_handlers(application)
    if terrain_repository is not None:
        application.state.terrain_repository = terrain_repository
    application.include_router(missions_router, prefix="/api/v1")
    return TestClient(application)


def payload(*, frame_id: str = FRAME_ID, avoid_unknown: bool = True) -> dict:
    return {
        "region_id": REGION_ID,
        "start": {"x_m": 5, "y_m": 15, "frame_id": frame_id},
        "end": {"x_m": 25, "y_m": 15, "frame_id": frame_id},
        "constraints": {
            "max_slope_deg": 15,
            "speed_m_per_min": 20,
            "avoid_unknown": avoid_unknown,
        },
    }


def test_route_endpoint_returns_viable_3d_traceable_route() -> None:
    response = make_client(repository()).post("/api/v1/routes/compute", json=payload())

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "viable"
    assert result["region_id"] == REGION_ID
    assert result["frame_id"] == FRAME_ID
    assert result["terrain_version"] == "api-test-v1"
    assert result["path"][0]["z_m"] is not None
    assert result["distance_m"] == 20
    assert result["unknown_segments"] == 0
    assert "STATIC_HAZARDS_NOT_AVAILABLE" in result["warnings"]


def test_route_endpoint_distinguishes_unknown_from_not_viable() -> None:
    unknown = make_client(repository(unknown_columns={1})).post(
        "/api/v1/routes/compute", json=payload()
    )
    assert unknown.status_code == 200
    assert unknown.json()["status"] == "unknown"
    assert unknown.json()["unknown_segments"] == 1
    assert "ROUTE_CROSSES_UNKNOWN_TERRAIN" in unknown.json()["warnings"]

    not_viable = make_client(repository(blocked_columns={1})).post(
        "/api/v1/routes/compute", json=payload()
    )
    assert not_viable.status_code == 200
    assert not_viable.json()["status"] == "not_viable"
    assert not_viable.json()["path"] == []
    assert not_viable.json()["distance_m"] is None


def test_route_endpoint_reports_client_and_availability_errors() -> None:
    wrong_frame = make_client(repository()).post(
        "/api/v1/routes/compute", json=payload(frame_id="OTHER_FRAME")
    )
    assert wrong_frame.status_code == 400
    assert "frame_id" in wrong_frame.json()["error"]["message"]

    unknown_region_payload = payload()
    unknown_region_payload["region_id"] = "unknown-region"
    unknown_region = make_client(repository()).post(
        "/api/v1/routes/compute", json=unknown_region_payload
    )
    assert unknown_region.status_code == 404

    unavailable = make_client().post("/api/v1/routes/compute", json=payload())
    assert unavailable.status_code == 503


def test_main_app_loads_one_store_for_catalog_and_routes(tmp_path) -> None:
    write_region(tmp_path)
    store = load_catalog(tmp_path, [REGION_ID])

    with TestClient(create_app(store)) as client:
        assert client.get("/api/v1/regions").status_code == 200
        request = payload()
        request["start"] = {"x_m": 50, "y_m": 350, "frame_id": FRAME_ID}
        request["end"] = {"x_m": 50, "y_m": 50, "frame_id": FRAME_ID}
        response = client.post("/api/v1/routes/compute", json=request)

    assert response.status_code == 200
    assert response.json()["status"] == "viable"
