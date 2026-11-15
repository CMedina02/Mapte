import sqlite3

import pytest

from app.modules.missions.persistence import (
    MissionCreate,
    MissionEventDraft,
    MissionLifecycleStatus,
    MissionNotFoundError,
    MissionUpdate,
    MissionVersionConflictError,
    RouteDraft,
    SQLiteMissionRepository,
    StoredRouteKind,
    StoredViabilityStatus,
)


def route(route_id: str, *, distance_m: float = 100) -> RouteDraft:
    return RouteDraft(
        route_id=route_id,
        kind=StoredRouteKind.ACTIVE,
        status=StoredViabilityStatus.VIABLE,
        path={"frame_id": "MARS_GALE_MS_LOCAL_V1", "points": [{"x_m": 1, "y_m": 2}]},
        metrics={"distance_m": distance_m},
    )


def mission() -> MissionCreate:
    return MissionCreate(
        mission_id="mission-1",
        region_id="mc23-gale-mount-sharp",
        frame_id="MARS_GALE_MS_LOCAL_V1",
        terrain_version="gale-ms-v1",
        lifecycle_status=MissionLifecycleStatus.DRAFT,
        viability_status=StoredViabilityStatus.UNKNOWN,
        snapshot={"next_objective_id": "obj-a", "alerts": ["DURATION_UNKNOWN"]},
        routes=(route("route-v1"),),
        events=(MissionEventDraft("event-created", "plan_created", {"source": "planner"}),),
    )


def test_create_and_reopen_preserves_mission_routes_and_events(tmp_path) -> None:
    database = tmp_path / "runtime" / "mapte.sqlite3"
    created = SQLiteMissionRepository(database).create(mission())
    reopened = SQLiteMissionRepository(database)

    restored = reopened.get("mission-1")

    assert created.current_version == 1
    assert restored is not None
    assert restored.snapshot == mission().snapshot
    assert restored.routes[0].terrain_version == "gale-ms-v1"
    assert restored.routes[0].metrics == {"distance_m": 100}
    assert reopened.list_events("mission-1")[0].event_type == "plan_created"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_update_keeps_immutable_history_and_rejects_stale_writer(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "mapte.sqlite3")
    repository.create(mission())
    updated = repository.update(
        "mission-1",
        MissionUpdate(
            expected_version=1,
            lifecycle_status=MissionLifecycleStatus.ACTIVE,
            viability_status=StoredViabilityStatus.VIABLE,
            snapshot={"next_objective_id": "obj-b", "alerts": []},
            routes=(route("route-v2", distance_m=140),),
            events=(MissionEventDraft("event-started", "mission_started", {}),),
        ),
    )

    historical = repository.get("mission-1", version=1)

    assert updated.current_version == 2
    assert updated.lifecycle_status is MissionLifecycleStatus.ACTIVE
    assert updated.snapshot["next_objective_id"] == "obj-b"
    assert historical is not None
    assert historical.current_version == 1
    assert historical.lifecycle_status is MissionLifecycleStatus.DRAFT
    assert historical.viability_status is StoredViabilityStatus.UNKNOWN
    assert historical.snapshot["next_objective_id"] == "obj-a"
    assert historical.routes[0].route_id == "route-v1"
    with pytest.raises(MissionVersionConflictError):
        repository.update(
            "mission-1",
            MissionUpdate(
                expected_version=1,
                lifecycle_status=MissionLifecycleStatus.ABORTED,
                viability_status=StoredViabilityStatus.NOT_VIABLE,
                snapshot={"reason": "stale"},
            ),
        )
    assert repository.get("mission-1").current_version == 2


def test_failed_update_is_atomic(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "mapte.sqlite3")
    repository.create(mission())

    with pytest.raises(sqlite3.IntegrityError):
        repository.update(
            "mission-1",
            MissionUpdate(
                expected_version=1,
                lifecycle_status=MissionLifecycleStatus.ACTIVE,
                viability_status=StoredViabilityStatus.VIABLE,
                snapshot={"must_not_survive": True},
                routes=(route("route-v1"),),
            ),
        )

    restored = repository.get("mission-1")
    assert restored is not None
    assert restored.current_version == 1
    assert restored.snapshot == mission().snapshot
    assert repository.get("mission-1", version=2) is None


def test_history_cannot_be_overwritten_or_deleted(tmp_path) -> None:
    database = tmp_path / "mapte.sqlite3"
    repository = SQLiteMissionRepository(database)
    repository.create(mission())

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE mission_versions SET snapshot_json = '{}' WHERE mission_id = ?",
                ("mission-1",),
            )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("DELETE FROM routes WHERE route_id = ?", ("route-v1",))
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE mission_events SET event_type = 'changed' WHERE event_id = ?",
                ("event-created",),
            )


def test_missing_mission_events_and_update_are_explicit(tmp_path) -> None:
    repository = SQLiteMissionRepository(tmp_path / "mapte.sqlite3")

    assert repository.get("missing") is None
    with pytest.raises(MissionNotFoundError):
        repository.list_events("missing")
    with pytest.raises(MissionNotFoundError):
        repository.update(
            "missing",
            MissionUpdate(
                expected_version=1,
                lifecycle_status=MissionLifecycleStatus.ACTIVE,
                viability_status=StoredViabilityStatus.UNKNOWN,
                snapshot={},
            ),
        )
