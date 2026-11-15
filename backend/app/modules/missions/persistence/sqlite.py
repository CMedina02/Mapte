"""SQLite mission repository with immutable snapshots and optimistic locking."""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.modules.missions.persistence.models import (
    MissionCreate,
    MissionEventDraft,
    MissionLifecycleStatus,
    MissionUpdate,
    RouteDraft,
    StoredMission,
    StoredMissionEvent,
    StoredRoute,
    StoredRouteKind,
    StoredViabilityStatus,
)
from app.modules.missions.persistence.repository import (
    MissionAlreadyExistsError,
    MissionNotFoundError,
    MissionVersionConflictError,
)

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS missions (
    mission_id TEXT PRIMARY KEY,
    region_id TEXT NOT NULL,
    frame_id TEXT NOT NULL,
    terrain_version TEXT NOT NULL,
    current_version INTEGER NOT NULL CHECK (current_version >= 1),
    lifecycle_status TEXT NOT NULL,
    viability_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_versions (
    mission_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    lifecycle_status TEXT NOT NULL,
    viability_status TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (mission_id, version),
    FOREIGN KEY (mission_id) REFERENCES missions(mission_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS routes (
    route_id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    mission_version INTEGER NOT NULL,
    route_kind TEXT NOT NULL,
    terrain_version TEXT NOT NULL,
    status TEXT NOT NULL,
    path_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (mission_id, mission_version)
        REFERENCES mission_versions(mission_id, version) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS mission_events (
    event_id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    mission_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (mission_id, mission_version)
        REFERENCES mission_versions(mission_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_routes_mission_version
    ON routes(mission_id, mission_version);
CREATE INDEX IF NOT EXISTS idx_events_mission_version
    ON mission_events(mission_id, mission_version);

CREATE TRIGGER IF NOT EXISTS prevent_mission_version_update
BEFORE UPDATE ON mission_versions BEGIN
    SELECT RAISE(ABORT, 'mission versions are immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_mission_version_delete
BEFORE DELETE ON mission_versions BEGIN
    SELECT RAISE(ABORT, 'mission versions are immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_route_update
BEFORE UPDATE ON routes BEGIN
    SELECT RAISE(ABORT, 'routes are immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_route_delete
BEFORE DELETE ON routes BEGIN
    SELECT RAISE(ABORT, 'routes are immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_mission_event_update
BEFORE UPDATE ON mission_events BEGIN
    SELECT RAISE(ABORT, 'mission events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_mission_event_delete
BEFORE DELETE ON mission_events BEGIN
    SELECT RAISE(ABORT, 'mission events are immutable');
END;
"""


class SQLiteMissionRepository:
    def __init__(self, database_path: Path | str) -> None:
        self.database_path = Path(database_path).resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def create(self, draft: MissionCreate) -> StoredMission:
        self._validate_create(draft)
        now = _utc_now()
        snapshot_json = _encode_json(draft.snapshot)
        with self._transaction() as connection:
            try:
                connection.execute(
                    """
                    INSERT INTO missions (
                        mission_id, region_id, frame_id, terrain_version, current_version,
                        lifecycle_status, viability_status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (
                        draft.mission_id,
                        draft.region_id,
                        draft.frame_id,
                        draft.terrain_version,
                        draft.lifecycle_status.value,
                        draft.viability_status.value,
                        now,
                        now,
                    ),
                )
                connection.execute(
                    """INSERT INTO mission_versions (
                        mission_id, version, lifecycle_status, viability_status,
                        snapshot_json, created_at
                    ) VALUES (?, 1, ?, ?, ?, ?)""",
                    (
                        draft.mission_id,
                        draft.lifecycle_status.value,
                        draft.viability_status.value,
                        snapshot_json,
                        now,
                    ),
                )
                self._insert_routes(
                    connection, draft.mission_id, 1, draft.terrain_version, draft.routes, now
                )
                self._insert_events(connection, draft.mission_id, 1, draft.events, now)
            except sqlite3.IntegrityError as error:
                raise MissionAlreadyExistsError(
                    f"Could not create mission {draft.mission_id!r}; the identifier already exists"
                ) from error
        return self._required(draft.mission_id)

    def get(self, mission_id: str, version: int | None = None) -> StoredMission | None:
        with self._connection() as connection:
            mission = connection.execute(
                "SELECT * FROM missions WHERE mission_id = ?", (mission_id,)
            ).fetchone()
            if mission is None:
                return None
            selected_version = mission["current_version"] if version is None else version
            version_row = connection.execute(
                """SELECT * FROM mission_versions
                WHERE mission_id = ? AND version = ?""",
                (mission_id, selected_version),
            ).fetchone()
            if version_row is None:
                return None
            routes = connection.execute(
                """SELECT * FROM routes WHERE mission_id = ? AND mission_version = ?
                ORDER BY rowid""",
                (mission_id, selected_version),
            ).fetchall()
        return self._to_mission(mission, version_row, routes)

    def update(self, mission_id: str, change: MissionUpdate) -> StoredMission:
        if change.expected_version < 1:
            raise ValueError("expected_version must be at least 1")
        now = _utc_now()
        snapshot_json = _encode_json(change.snapshot)
        with self._transaction() as connection:
            mission = connection.execute(
                "SELECT current_version, terrain_version FROM missions WHERE mission_id = ?",
                (mission_id,),
            ).fetchone()
            if mission is None:
                raise MissionNotFoundError(f"Mission not found: {mission_id!r}")
            if mission["current_version"] != change.expected_version:
                raise MissionVersionConflictError(
                    f"The mission is at version {mission['current_version']}; "
                    f"expected {change.expected_version}"
                )
            new_version = change.expected_version + 1
            connection.execute(
                """INSERT INTO mission_versions (
                    mission_id, version, lifecycle_status, viability_status,
                    snapshot_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    mission_id,
                    new_version,
                    change.lifecycle_status.value,
                    change.viability_status.value,
                    snapshot_json,
                    now,
                ),
            )
            self._insert_routes(
                connection,
                mission_id,
                new_version,
                mission["terrain_version"],
                change.routes,
                now,
            )
            self._insert_events(connection, mission_id, new_version, change.events, now)
            updated = connection.execute(
                """UPDATE missions SET current_version = ?, lifecycle_status = ?,
                viability_status = ?, updated_at = ?
                WHERE mission_id = ? AND current_version = ?""",
                (
                    new_version,
                    change.lifecycle_status.value,
                    change.viability_status.value,
                    now,
                    mission_id,
                    change.expected_version,
                ),
            )
            if updated.rowcount != 1:
                raise MissionVersionConflictError("The mission changed during the update")
        return self._required(mission_id)

    def list_events(self, mission_id: str) -> tuple[StoredMissionEvent, ...]:
        with self._connection() as connection:
            exists = connection.execute(
                "SELECT 1 FROM missions WHERE mission_id = ?", (mission_id,)
            ).fetchone()
            if exists is None:
                raise MissionNotFoundError(f"Mission not found: {mission_id!r}")
            rows = connection.execute(
                """SELECT * FROM mission_events WHERE mission_id = ?
                ORDER BY mission_version, rowid""",
                (mission_id,),
            ).fetchall()
        return tuple(
            StoredMissionEvent(
                event_id=row["event_id"],
                mission_id=row["mission_id"],
                mission_version=row["mission_version"],
                event_type=row["event_type"],
                payload=_decode_json(row["payload_json"]),
                created_at=row["created_at"],
            )
            for row in rows
        )

    def _initialize(self) -> None:
        with self._connection() as connection:
            current = connection.execute("PRAGMA user_version").fetchone()[0]
            if current > SCHEMA_VERSION:
                raise RuntimeError(
                    f"The database uses schema {current}; "
                    f"this application supports up to {SCHEMA_VERSION}"
                )
            connection.executescript(SCHEMA)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
            except Exception:
                connection.rollback()
                raise
            else:
                connection.commit()

    def _required(self, mission_id: str) -> StoredMission:
        mission = self.get(mission_id)
        if mission is None:
            raise MissionNotFoundError(f"Mission not found: {mission_id!r}")
        return mission

    @staticmethod
    def _insert_routes(
        connection: sqlite3.Connection,
        mission_id: str,
        version: int,
        terrain_version: str,
        routes: tuple[RouteDraft, ...],
        created_at: str,
    ) -> None:
        connection.executemany(
            """INSERT INTO routes (
                route_id, mission_id, mission_version, route_kind, terrain_version,
                status, path_json, metrics_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    route.route_id,
                    mission_id,
                    version,
                    route.kind.value,
                    terrain_version,
                    route.status.value,
                    _encode_json(route.path),
                    _encode_json(route.metrics),
                    created_at,
                )
                for route in routes
            ],
        )

    @staticmethod
    def _insert_events(
        connection: sqlite3.Connection,
        mission_id: str,
        version: int,
        events: tuple[MissionEventDraft, ...],
        created_at: str,
    ) -> None:
        connection.executemany(
            """INSERT INTO mission_events (
                event_id, mission_id, mission_version, event_type, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (
                    event.event_id,
                    mission_id,
                    version,
                    event.event_type,
                    _encode_json(event.payload),
                    created_at,
                )
                for event in events
            ],
        )

    @staticmethod
    def _to_mission(
        row: sqlite3.Row,
        version_row: sqlite3.Row,
        route_rows: list[sqlite3.Row],
    ) -> StoredMission:
        routes = tuple(
            StoredRoute(
                route_id=route["route_id"],
                mission_id=route["mission_id"],
                mission_version=route["mission_version"],
                kind=StoredRouteKind(route["route_kind"]),
                terrain_version=route["terrain_version"],
                status=StoredViabilityStatus(route["status"]),
                path=_decode_json(route["path_json"]),
                metrics=_decode_json(route["metrics_json"]),
                created_at=route["created_at"],
            )
            for route in route_rows
        )
        return StoredMission(
            mission_id=row["mission_id"],
            region_id=row["region_id"],
            frame_id=row["frame_id"],
            terrain_version=row["terrain_version"],
            current_version=version_row["version"],
            lifecycle_status=MissionLifecycleStatus(version_row["lifecycle_status"]),
            viability_status=StoredViabilityStatus(version_row["viability_status"]),
            created_at=row["created_at"],
            updated_at=version_row["created_at"],
            snapshot=_decode_json(version_row["snapshot_json"]),
            routes=routes,
        )

    @staticmethod
    def _validate_create(draft: MissionCreate) -> None:
        required = (draft.mission_id, draft.region_id, draft.frame_id, draft.terrain_version)
        if any(not value.strip() for value in required):
            raise ValueError(
                "Mission, region, frame and terrain identifiers are required"
            )


def _encode_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _decode_json(value: str) -> dict[str, Any]:
    decoded = json.loads(value)
    if not isinstance(decoded, dict):
        raise RuntimeError("The persisted record does not contain a JSON object")
    return decoded


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()
