"""Al terminar un objetivo, la misión se recalcula desde ahí hacia los pendientes."""

import pytest
from fastapi import HTTPException

from app.modules.missions.api.router import (
    change_mission_status,
    plan_mission,
    replan_from_current_position,
    submit_observation,
)
from app.modules.missions.api.schemas import (
    MissionAdvanceRequestSchema,
    MissionPlanRequestSchema,
    MissionStatusRequestSchema,
    ObservationRequestSchema,
)
from app.modules.missions.persistence import SQLiteMissionRepository
from tests.missions.test_planning import FRAME_ID, REGION_ID, objectives, terrain_repository


def _planned_and_started(repository):
    created = plan_mission(
        MissionPlanRequestSchema.model_validate(
            {
                "region_id": REGION_ID,
                "base_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "objective_ids": ["obj-a", "obj-b"],
                "constraints": {"max_slope_deg": 15, "speed_m_per_min": 10, "avoid_unknown": True},
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
    return created


def test_replan_after_finding_continues_from_the_completed_objective(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "replan.sqlite3")
    created = _planned_and_started(repository)
    at_a = created.legs[0].path[-1]
    submit_observation(
        created.mission_id,
        ObservationRequestSchema(
            mission_version=2, objective_id="obj-a", finding_code="HEMATITE_DETECTED"
        ),
        objectives(),
        repository,
    )

    replanned = replan_from_current_position(
        created.mission_id,
        MissionAdvanceRequestSchema.model_validate(
            {
                "expected_version": 3,
                "current_position": {"x_m": at_a.x_m, "y_m": at_a.y_m, "frame_id": FRAME_ID},
                "resources": {"oxygen_available_min": 150, "return_reserve_min": 30},
                "activity_durations_min": {"obj-b": 20},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )

    # Sale de A (no de la base) hacia B y vuelve; base y objetivos originales se conservan
    assert [(leg.start_label, leg.end_label) for leg in replanned.legs] == [
        ("obj-a", "obj-b"),
        ("obj-b", "base"),
    ]
    assert replanned.objective_ids == ["obj-a", "obj-b"]
    assert replanned.completed_objective_ids == ["obj-a"]
    assert replanned.next_objective_id == "obj-b"
    assert replanned.start_position == created.start_position
    assert (replanned.current_position.x_m, replanned.current_position.y_m) == (at_a.x_m, at_a.y_m)
    assert replanned.resources.oxygen_available_min == 150
    assert replanned.viability_status == "viable"
    assert "RESOURCE_READING_REQUIRED_AFTER_OBSERVATION" not in replanned.alerts
    assert replanned.decision_log[-1].event_type == "route_recalculated"


def test_replan_requires_active_mission_and_current_version(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "replan-guard.sqlite3")
    created = plan_mission(
        MissionPlanRequestSchema.model_validate(
            {
                "region_id": REGION_ID,
                "base_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
                "objective_ids": ["obj-a"],
                "constraints": {"max_slope_deg": 15, "speed_m_per_min": 10, "avoid_unknown": True},
                "resources": {"oxygen_available_min": 200, "return_reserve_min": 30},
                "activity_durations_min": {"obj-a": 10},
            }
        ),
        terrain_repository(),
        objectives(),
        repository,
    )
    body = {
        "current_position": {"x_m": 5, "y_m": 15, "frame_id": FRAME_ID},
        "resources": {"oxygen_available_min": 200, "return_reserve_min": 30},
    }
    with pytest.raises(HTTPException) as draft:
        replan_from_current_position(
            created.mission_id,
            MissionAdvanceRequestSchema.model_validate({"expected_version": 1, **body}),
            terrain_repository(),
            objectives(),
            repository,
        )
    assert draft.value.status_code == 409


def test_finding_can_be_recorded_at_any_pending_objective(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "order.sqlite3")
    created = _planned_and_started(repository)

    # El plan va a obj-a primero, pero el astronauta fue directo a obj-b
    observed = submit_observation(
        created.mission_id,
        ObservationRequestSchema(
            mission_version=2, objective_id="obj-b", finding_code="CLAY_MINERALS_DETECTED"
        ),
        objectives(),
        repository,
    )
    assert observed.completed_objective_ids == ["obj-b"]
    assert observed.next_objective_id == "obj-a"

    with pytest.raises(HTTPException) as repeated:
        submit_observation(
            created.mission_id,
            ObservationRequestSchema(
                mission_version=3, objective_id="obj-b", finding_code="CLAY_MINERALS_DETECTED"
            ),
            objectives(),
            repository,
        )
    assert repeated.value.status_code == 409
