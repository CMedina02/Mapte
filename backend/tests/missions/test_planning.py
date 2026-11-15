from dataclasses import replace

import pytest
from fastapi import HTTPException

from app.modules.catalog.domain import (
    InMemoryTerrainRepository,
    TerrainDataset,
    TerrainGridData,
    VerticalReferenceSpec,
    build_synthetic_terrain,
)
from app.modules.catalog.infrastructure.science_loader import load_science_catalog
from app.modules.catalog.infrastructure.terrain_loader import load_catalog
from app.modules.missions.api.router import (
    change_mission_status,
    evaluate_contingency,
    get_mission,
    get_mission_events,
    get_mission_package,
    plan_mission,
    report_hazard_and_replan,
    submit_observation,
    update_mission_progress,
)
from app.modules.missions.api.schemas import (
    ContingencyRequestSchema,
    MissionPlanRequestSchema,
    MissionProgressRequestSchema,
    MissionReplanRequestSchema,
    MissionStatusRequestSchema,
    ObservationRequestSchema,
)
from app.modules.missions.observations import decide_observation
from app.modules.missions.persistence import (
    MissionLifecycleStatus,
    MissionUpdate,
    SQLiteMissionRepository,
    StoredRouteKind,
)
from app.modules.missions.planning import (
    InMemoryObjectiveRepository,
    MissionObjective,
    MissionPlanner,
    MissionPlanningRequest,
    MissionPlanViability,
    UnknownObjectiveError,
    objective_repository_from_catalogs,
)
from app.modules.missions.planning.persistence import mission_create_from_plan
from app.modules.missions.resources import SupportResources
from app.modules.missions.routing import RoutePlanningConstraints
from app.modules.missions.terrain import GridCell, LocalPosition
from tests.catalog._region_fixture import write_region

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"


def position(row: int, column: int) -> LocalPosition:
    return LocalPosition(5 + column * 10, 25 - row * 10, FRAME_ID)


def terrain_repository(*, blocked: set[GridCell] | None = None) -> InMemoryTerrainRepository:
    source = build_synthetic_terrain(
        region_id=REGION_ID,
        frame_id=FRAME_ID,
        width_px=3,
        height_px=3,
        pixel_size_m=10,
        terrain_version="planning-test-v1",
    )
    metadata = replace(
        source.metadata,
        vertical=VerticalReferenceSpec("test", -5000, 0),
    )
    blocked_mask = [
        GridCell(row, column) in (blocked or set()) for row in range(3) for column in range(3)
    ]
    grid = TerrainGridData(
        metadata=metadata,
        elevations_m=[-3500.0] * 9,
        blocked_mask=blocked_mask,
    )
    return InMemoryTerrainRepository((TerrainDataset(metadata, grid),))


def objectives() -> InMemoryObjectiveRepository:
    return InMemoryObjectiveRepository(
        (
            MissionObjective(
                objective_id="obj-a",
                region_id=REGION_ID,
                title="Objetivo A",
                position=position(0, 2),
                activities=("Fotografía",),
                evidence_ids=("ev-a",),
                possible_findings=("HEMATITE_DETECTED",),
            ),
            MissionObjective(
                objective_id="obj-b",
                region_id=REGION_ID,
                title="Objetivo B",
                position=position(1, 2),
                activities=("Muestreo",),
                evidence_ids=("ev-b",),
                possible_findings=("CLAY_MINERALS_DETECTED",),
            ),
        )
    )


def request(
    *,
    available_min: float = 200,
    durations: tuple[tuple[str, float], ...] = (("obj-a", 10), ("obj-b", 20)),
) -> MissionPlanningRequest:
    return MissionPlanningRequest(
        region_id=REGION_ID,
        base_position=position(1, 0),
        objective_ids=("obj-a", "obj-b"),
        constraints=RoutePlanningConstraints(speed_m_per_min=10),
        resources=SupportResources(available_min, 30),
        activity_durations_min=durations,
    )


def planner(*, blocked: set[GridCell] | None = None) -> MissionPlanner:
    return MissionPlanner(terrain_repository(blocked=blocked), objectives())


def test_planner_preserves_requested_order_and_returns_to_base() -> None:
    plan = planner().plan(request())

    assert plan.viability is MissionPlanViability.VIABLE
    assert plan.version == 1
    assert plan.objective_ids == ("obj-a", "obj-b")
    assert plan.next_objective_id == "obj-a"
    assert [(leg.start_label, leg.end_label) for leg in plan.legs] == [
        ("base", "obj-a"),
        ("obj-a", "obj-b"),
        ("obj-b", "base"),
    ]
    assert plan.resource_evaluation.projected_consumption_min == pytest.approx(
        sum(leg.route.route.duration_min for leg in plan.legs if leg.route.route) + 30
    )
    assert plan.evidence_ids == ("ev-a", "ev-b", "ev-synthetic-terrain-gale-ms")
    assert "Orden solicitado conservado" in plan.decision_log[0].message


def test_missing_activity_duration_makes_plan_unknown() -> None:
    plan = planner().plan(request(durations=(("obj-a", 10),)))

    assert plan.viability is MissionPlanViability.UNKNOWN
    assert "DURATION_UNKNOWN" in plan.resource_evaluation.reason_codes
    assert "MISSION_UNKNOWN" in plan.alerts


def test_insufficient_support_makes_plan_not_viable() -> None:
    plan = planner().plan(request(available_min=40))

    assert plan.viability is MissionPlanViability.NOT_VIABLE
    assert "INSUFFICIENT_RETURN_RESERVE" in plan.resource_evaluation.reason_codes
    assert "MISSION_NOT_VIABLE" in plan.alerts


def test_unreachable_leg_makes_plan_not_viable() -> None:
    wall = {GridCell(row, 1) for row in range(3)}
    plan = planner(blocked=wall).plan(request())

    assert plan.viability is MissionPlanViability.NOT_VIABLE
    assert any(leg.route.status.value == "not_viable" for leg in plan.legs)
    assert "SEGMENT_NOT_VIABLE" in plan.resource_evaluation.reason_codes


def test_unknown_objective_and_invalid_request_are_rejected() -> None:
    invalid_objective = replace(request(), objective_ids=("missing",), activity_durations_min=())
    with pytest.raises(UnknownObjectiveError):
        planner().plan(invalid_objective)

    with pytest.raises(ValueError, match="duplicados"):
        replace(request(), objective_ids=("obj-a", "obj-a"))
    with pytest.raises(ValueError, match="no solicitados"):
        replace(request(), activity_durations_min=(("other", 10),))


def test_computed_plan_is_ready_for_versioned_persistence(tmp_path) -> None:
    plan = planner().plan(request())
    repository = SQLiteMissionRepository(tmp_path / "mapte.sqlite3")

    stored = repository.create(mission_create_from_plan(plan))

    assert stored.mission_id == plan.mission_id
    assert stored.snapshot["next_objective_id"] == "obj-a"
    assert len(stored.snapshot["legs"]) == 3
    return_route = next(route for route in stored.routes if route.kind is StoredRouteKind.RETURN)
    assert return_route.terrain_version == "planning-test-v1"


def test_plan_and_get_api_functions_share_persisted_mission(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "mapte.sqlite3")
    payload = MissionPlanRequestSchema.model_validate(
        {
            "region_id": REGION_ID,
            "base_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
            "objective_ids": ["obj-a", "obj-b"],
            "constraints": {
                "max_slope_deg": 15,
                "speed_m_per_min": 10,
                "avoid_unknown": True,
            },
            "resources": {"oxygen_available_min": 200, "return_reserve_min": 30},
            "activity_durations_min": {"obj-a": 10, "obj-b": 20},
        }
    )

    created = plan_mission(payload, terrain_repository(), objectives(), repository)
    restored = get_mission(created.mission_id, repository)

    assert created.mission_version == 1
    assert restored == created
    assert restored.viability_status == "viable"

    replanned = report_hazard_and_replan(
        created.mission_id,
        MissionReplanRequestSchema.model_validate(
            {
                "expected_version": 1,
                "current_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "completed_objective_ids": [],
                "report": {
                    "hazard_code": "LOOSE_ROCKS",
                    "position": {"x_m": 15, "y_m": 15, "frame_id": FRAME_ID},
                    "effect": "blocked",
                    "affected_radius_m": 0,
                },
                "constraints": {
                    "max_slope_deg": 15,
                    "speed_m_per_min": 10,
                    "avoid_unknown": True,
                },
                "resources": {"oxygen_available_min": 180, "return_reserve_min": 30},
                "activity_durations_min": {"obj-a": 10, "obj-b": 20},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )

    assert replanned.mission_version == 2
    assert replanned.hazard_reports[0]["hazard_code"] == "LOOSE_ROCKS"
    original = repository.get(created.mission_id, version=1)
    assert original is not None
    assert original.snapshot["hazard_reports"] == []

    second_replan = report_hazard_and_replan(
        created.mission_id,
        MissionReplanRequestSchema.model_validate(
            {
                "expected_version": 2,
                "current_position": {"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                "completed_objective_ids": ["obj-a"],
                "report": {
                    "hazard_code": "SOFT_SOIL",
                    "position": {"x_m": 15, "y_m": 5, "frame_id": FRAME_ID},
                    "effect": "high_cost",
                    "affected_radius_m": 0,
                    "cost_multiplier": 3,
                },
                "constraints": {
                    "max_slope_deg": 15,
                    "speed_m_per_min": 10,
                    "avoid_unknown": True,
                },
                "resources": {"oxygen_available_min": 150, "return_reserve_min": 30},
                "activity_durations_min": {"obj-b": 20},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )

    assert second_replan.mission_version == 3
    assert [item["hazard_code"] for item in second_replan.hazard_reports] == [
        "LOOSE_ROCKS",
        "SOFT_SOIL",
    ]

    started = change_mission_status(
        created.mission_id,
        MissionStatusRequestSchema(expected_version=3, action="start"),
        terrain_repository(),
        objectives(),
        repository,
    )
    progressed = update_mission_progress(
        created.mission_id,
        MissionProgressRequestSchema.model_validate(
            {
                "expected_version": 4,
                "current_position": {"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                "completed_objective_ids": ["obj-a"],
                "resources": {"oxygen_available_min": 120, "return_reserve_min": 30},
            }
        ),
        repository,
    )
    contingency = evaluate_contingency(
        created.mission_id,
        ContingencyRequestSchema(
            mission_version=5,
            contingency_type="oxygen_reduced",
            position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
            oxygen_available_min=100,
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    aborted = change_mission_status(
        created.mission_id,
        MissionStatusRequestSchema.model_validate(
            {
                "expected_version": 6,
                "action": "abort",
                "current_position": {"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                "resources": {"oxygen_available_min": 100, "return_reserve_min": 30},
                "constraints": {
                    "max_slope_deg": 15,
                    "speed_m_per_min": 10,
                    "avoid_unknown": True,
                },
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    events = get_mission_events(created.mission_id, repository)

    assert started.lifecycle_status == "active"
    assert progressed.viability_status == "unknown"
    assert progressed.next_objective_id == "obj-b"
    assert contingency.hazard_reports == second_replan.hazard_reports
    contingency_event = next(
        event for event in events.events if event.event_type == "contingency_evaluated"
    )
    assert contingency_event.payload["hazard_report_ids"] == [
        item["report_id"] for item in second_replan.hazard_reports
    ]
    assert aborted.lifecycle_status == "aborted"
    assert aborted.legs[-1]["end_label"] == "base"
    assert events.events[-1].event_type == "mission_aborted"


def test_active_mission_can_complete_after_all_objectives(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "complete.sqlite3")
    created = plan_mission(
        MissionPlanRequestSchema.model_validate(
            {
                "region_id": REGION_ID,
                "base_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "objective_ids": ["obj-a", "obj-b"],
                "constraints": {
                    "max_slope_deg": 15,
                    "speed_m_per_min": 10,
                    "avoid_unknown": True,
                },
                "resources": {"oxygen_available_min": 200, "return_reserve_min": 30},
                "activity_durations_min": {"obj-a": 10, "obj-b": 20},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    change_mission_status(
        created.mission_id,
        MissionStatusRequestSchema(expected_version=1, action="start"),
        terrain_repository(),
        objectives(),
        repository,
    )
    with pytest.raises(HTTPException) as invalid:
        submit_observation(
            created.mission_id,
            ObservationRequestSchema(
                mission_version=2,
                objective_id="obj-a",
                finding_code="INVENTED_BY_FREE_TEXT",
            ),
            objectives(),
            repository,
        )
    assert invalid.value.status_code == 400
    observed = submit_observation(
        created.mission_id,
        ObservationRequestSchema(
            mission_version=2,
            objective_id="obj-a",
            finding_code="HEMATITE_DETECTED",
            notes="Hallazgo simulado",
        ),
        objectives(),
        repository,
    )
    with pytest.raises(HTTPException) as stale:
        submit_observation(
            created.mission_id,
            ObservationRequestSchema(
                mission_version=2,
                objective_id="obj-a",
                finding_code="HEMATITE_DETECTED",
            ),
            objectives(),
            repository,
        )
    assert stale.value.status_code == 409
    update_mission_progress(
        created.mission_id,
        MissionProgressRequestSchema.model_validate(
            {
                "expected_version": 3,
                "current_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "completed_objective_ids": ["obj-a", "obj-b"],
                "resources": {"oxygen_available_min": 100, "return_reserve_min": 30},
            }
        ),
        repository,
    )
    completed = change_mission_status(
        created.mission_id,
        MissionStatusRequestSchema(expected_version=4, action="complete"),
        terrain_repository(),
        objectives(),
        repository,
    )

    assert observed.next_objective_id == "obj-b"
    assert observed.completed_objective_ids == ["obj-a"]
    assert observed.viability_status == "unknown"
    assert completed.mission_version == 5
    assert completed.lifecycle_status == "completed"


def test_oxygen_contingency_reuses_mission_safety_model_and_is_audited(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "contingency.sqlite3")
    created = plan_mission(
        MissionPlanRequestSchema.model_validate(
            {
                "region_id": REGION_ID,
                "base_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "objective_ids": ["obj-a"],
                "constraints": {
                    "max_slope_deg": 15,
                    "speed_m_per_min": 10,
                    "avoid_unknown": True,
                },
                "resources": {"oxygen_available_min": 200, "return_reserve_min": 30},
                "activity_durations_min": {"obj-a": 10},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    started = change_mission_status(
        created.mission_id,
        MissionStatusRequestSchema(expected_version=1, action="start"),
        terrain_repository(),
        objectives(),
        repository,
    )

    contingency = evaluate_contingency(
        created.mission_id,
        ContingencyRequestSchema(
            mission_version=started.mission_version,
            contingency_type="oxygen_reduced",
            position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
            oxygen_available_min=31,
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    events = get_mission_events(created.mission_id, repository)

    assert contingency.mission_version == 3
    assert contingency.lifecycle_status == "active"
    assert contingency.viability_status == "not_viable"
    assert contingency.next_objective_id is None
    assert contingency.routing_constraints is not None
    assert contingency.routing_constraints.speed_m_per_min == 10
    assert contingency.resources["oxygen_available_min"] == 31
    assert contingency.resource_evaluation["reserve_margin_min"] < 0
    assert [(leg["start_label"], leg["end_label"]) for leg in contingency.legs] == [
        ("current_position", "base")
    ]
    assert "OXYGEN_REDUCED" in contingency.alerts
    assert events.events[-1].event_type == "contingency_evaluated"
    assert events.events[-1].payload["return_status"] == "not_viable"
    assert events.events[-1].payload["assumptions"]
    historical = repository.get(created.mission_id, version=2)
    assert historical is not None
    assert historical.snapshot["next_objective_id"] == "obj-a"
    with pytest.raises(HTTPException) as stale:
        evaluate_contingency(
            created.mission_id,
            ContingencyRequestSchema(
                mission_version=started.mission_version,
                contingency_type="oxygen_reduced",
                position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                oxygen_available_min=30,
            ),
            terrain_repository(),
            objectives(),
            repository,
        )
    assert stale.value.status_code == 409
    assert repository.get(created.mission_id).current_version == 3


def test_contingency_rejects_unmodeled_or_invalid_scenarios_without_new_version(
    tmp_path,
) -> None:
    repository = SQLiteMissionRepository(tmp_path / "invalid-contingency.sqlite3")
    created = repository.create(mission_create_from_plan(planner().plan(request())))
    repository.update(
        created.mission_id,
        MissionUpdate(
            expected_version=1,
            lifecycle_status=MissionLifecycleStatus.ACTIVE,
            viability_status=created.viability_status,
            snapshot=created.snapshot,
        ),
    )

    for contingency_type, oxygen, expected_status in (
        ("rover_unavailable", 100, 400),
        ("oxygen_reduced", 200, 400),
    ):
        with pytest.raises(HTTPException) as invalid:
            evaluate_contingency(
                created.mission_id,
                ContingencyRequestSchema(
                    mission_version=2,
                    contingency_type=contingency_type,
                    position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                    oxygen_available_min=oxygen,
                ),
                terrain_repository(),
                objectives(),
                repository,
            )
        assert invalid.value.status_code == expected_status
        assert repository.get(created.mission_id).current_version == 2

    legacy_snapshot = {
        key: value
        for key, value in created.snapshot.items()
        if key != "routing_constraints"
    }
    repository.update(
        created.mission_id,
        MissionUpdate(
            expected_version=2,
            lifecycle_status=MissionLifecycleStatus.ACTIVE,
            viability_status=created.viability_status,
            snapshot=legacy_snapshot,
        ),
    )
    with pytest.raises(HTTPException) as missing_constraints:
        evaluate_contingency(
            created.mission_id,
            ContingencyRequestSchema(
                mission_version=3,
                contingency_type="oxygen_reduced",
                position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
                oxygen_available_min=100,
            ),
            terrain_repository(),
            objectives(),
            repository,
        )
    assert missing_constraints.value.status_code == 409
    assert repository.get(created.mission_id).current_version == 3


def test_mission_package_is_self_contained_and_reports_sync_assets(
    tmp_path, monkeypatch
) -> None:
    write_region(tmp_path)
    catalog_store = load_catalog(tmp_path, [REGION_ID])
    science = load_science_catalog(REGION_ID)
    assert science is not None
    monkeypatch.setattr(
        "app.modules.catalog.api.router._science_catalog",
        lambda _region: science,
    )
    repository = SQLiteMissionRepository(tmp_path / "package.sqlite3")
    draft = mission_create_from_plan(planner().plan(request()))
    selected_id = science.objectives[0].objective_id
    stored = repository.create(
        replace(
            draft,
            snapshot={
                **draft.snapshot,
                "objective_ids": [selected_id],
                "completed_objective_ids": [],
                "next_objective_id": selected_id,
            },
        )
    )

    package = get_mission_package(stored.mission_id, catalog_store, repository)

    assert package.package_version == "1.0"
    assert package.mission.mission_version == stored.current_version
    assert [item.objective_id for item in package.objectives] == [selected_id]
    assert package.photos
    assert {item.objective_id for item in package.photos} == {selected_id}
    assert package.region_manifest.evidence
    assert package.package_status == "ready_to_sync"
    assert package.missing_assets == []
    assert package.sync.mission_version == stored.current_version
    assert package.sync.requires_network is True
    assert package.sync.remote_asset_count == len(package.photos)
    assert package.region_manifest.terrain.heightmap_url in package.offline_assets
    assert all(item.image_url in package.offline_assets for item in package.photos)
    assert package.generated_at.tzinfo is not None

    science_objectives = objective_repository_from_catalogs((science,))
    started = change_mission_status(
        stored.mission_id,
        MissionStatusRequestSchema(expected_version=1, action="start"),
        terrain_repository(),
        science_objectives,
        repository,
    )
    finding_code = science.objectives[0].possible_findings[0]
    observed = submit_observation(
        stored.mission_id,
        ObservationRequestSchema(
            mission_version=started.mission_version,
            objective_id=selected_id,
            finding_code=finding_code,
        ),
        science_objectives,
        repository,
    )
    returned = evaluate_contingency(
        stored.mission_id,
        ContingencyRequestSchema(
            mission_version=observed.mission_version,
            contingency_type="oxygen_reduced",
            position={"x_m": 25, "y_m": 25, "frame_id": FRAME_ID},
            oxygen_available_min=100,
        ),
        terrain_repository(),
        science_objectives,
        repository,
    )
    updated_package = get_mission_package(stored.mission_id, catalog_store, repository)
    assert updated_package.mission.mission_version == returned.mission_version
    assert updated_package.sync.mission_version == returned.mission_version
    assert updated_package.mission.completed_objective_ids == [selected_id]
    assert updated_package.mission.next_objective_id is None
    assert updated_package.mission.legs[-1]["end_label"] == "base"

    texture_path = catalog_store.get(REGION_ID).asset_files()["imagery.png"]
    texture_path.unlink()
    incomplete = get_mission_package(stored.mission_id, catalog_store, repository)
    assert incomplete.package_status == "incomplete"
    assert incomplete.sync.missing_asset_count == 1
    assert incomplete.region_manifest.terrain.texture_url in incomplete.missing_assets
    assert incomplete.region_manifest.terrain.texture_url not in incomplete.offline_assets

    inconsistent = repository.create(mission_create_from_plan(planner().plan(request())))
    with pytest.raises(HTTPException) as missing_objective:
        get_mission_package(inconsistent.mission_id, catalog_store, repository)
    assert missing_objective.value.status_code == 503


def test_observation_rules_cover_every_real_catalog_finding() -> None:
    catalog = load_science_catalog(REGION_ID)
    assert catalog is not None
    repository = objective_repository_from_catalogs((catalog,))

    for source in catalog.objectives:
        objective = repository.get_objective(REGION_ID, source.objective_id)
        assert objective is not None
        for finding_code in source.possible_findings:
            assert decide_observation(objective, finding_code).finding_code == finding_code
