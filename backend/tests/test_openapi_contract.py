import json
from pathlib import Path

from app.main import create_app
from app.modules.catalog.api.schemas import (
    ObjectivesResponse,
    PhotosResponse,
    RegionManifestResponse,
    RegionsResponse,
)
from app.modules.missions.api.schemas import (
    ContingencyRequestSchema,
    MissionPackageResponseSchema,
    MissionPlanRequestSchema,
    MissionPlanResponseSchema,
    ObservationRequestSchema,
    PreventiveSupportRequestSchema,
    PreventiveSupportResponseSchema,
    RouteRequestSchema,
    RouteResultSchema,
)


def test_shared_openapi_is_exact_application_contract() -> None:
    contract_path = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"
    stored = json.loads(contract_path.read_text(encoding="utf-8"))

    assert stored == create_app().openapi()
    assert "/api/v1/missions/{mission_id}/preventive-support-options" in stored["paths"]
    assert "PreventiveSupportResponseSchema" in stored["components"]["schemas"]


def test_mission_contract_examples_validate_against_backend_schemas() -> None:
    examples = Path(__file__).resolve().parents[2] / "contracts" / "examples"
    schemas = {
        "regions.json": RegionsResponse,
        "region_manifest.json": RegionManifestResponse,
        "objectives.json": ObjectivesResponse,
        "photos.json": PhotosResponse,
        "route_request.json": RouteRequestSchema,
        "route_response.json": RouteResultSchema,
        "mission_plan_request.json": MissionPlanRequestSchema,
        "mission_plan_response.json": MissionPlanResponseSchema,
        "observation_request.json": ObservationRequestSchema,
        "observation_response.json": MissionPlanResponseSchema,
        "contingency_request.json": ContingencyRequestSchema,
        "contingency_response.json": MissionPlanResponseSchema,
        "mission_package.json": MissionPackageResponseSchema,
        "preventive_support_request.json": PreventiveSupportRequestSchema,
        "preventive_support_response.json": PreventiveSupportResponseSchema,
    }

    for name, schema in schemas.items():
        schema.model_validate(json.loads((examples / name).read_text()))
