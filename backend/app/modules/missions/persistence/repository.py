"""Persistence boundary owned by the missions domain."""

from typing import Protocol

from app.modules.missions.persistence.models import (
    MissionCreate,
    MissionUpdate,
    StoredMission,
    StoredMissionEvent,
)


class MissionAlreadyExistsError(ValueError):
    """The mission identifier is already persisted."""


class MissionNotFoundError(LookupError):
    """The requested mission does not exist."""


class MissionVersionConflictError(RuntimeError):
    """The mission changed after the caller read it."""


class MissionRepository(Protocol):
    def create(self, draft: MissionCreate) -> StoredMission: ...

    def get(self, mission_id: str, version: int | None = None) -> StoredMission | None: ...

    def update(self, mission_id: str, change: MissionUpdate) -> StoredMission: ...

    def list_events(self, mission_id: str) -> tuple[StoredMissionEvent, ...]: ...
