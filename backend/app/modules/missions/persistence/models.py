"""Stable records stored for mission traceability and multi-view projections."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

JsonObject = dict[str, Any]


class MissionLifecycleStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ABORTED = "aborted"


class StoredViabilityStatus(StrEnum):
    VIABLE = "viable"
    NOT_VIABLE = "not_viable"
    UNKNOWN = "unknown"


class StoredRouteKind(StrEnum):
    ORIGINAL = "original"
    ACTIVE = "active"
    RETURN = "return"
    ALTERNATIVE = "alternative"


@dataclass(frozen=True, slots=True)
class RouteDraft:
    route_id: str
    kind: StoredRouteKind
    status: StoredViabilityStatus
    path: JsonObject
    metrics: JsonObject


@dataclass(frozen=True, slots=True)
class MissionEventDraft:
    event_id: str
    event_type: str
    payload: JsonObject


@dataclass(frozen=True, slots=True)
class MissionCreate:
    mission_id: str
    region_id: str
    frame_id: str
    terrain_version: str
    lifecycle_status: MissionLifecycleStatus
    viability_status: StoredViabilityStatus
    snapshot: JsonObject
    routes: tuple[RouteDraft, ...] = ()
    events: tuple[MissionEventDraft, ...] = ()


@dataclass(frozen=True, slots=True)
class MissionUpdate:
    expected_version: int
    lifecycle_status: MissionLifecycleStatus
    viability_status: StoredViabilityStatus
    snapshot: JsonObject
    routes: tuple[RouteDraft, ...] = ()
    events: tuple[MissionEventDraft, ...] = ()


@dataclass(frozen=True, slots=True)
class StoredRoute:
    route_id: str
    mission_id: str
    mission_version: int
    kind: StoredRouteKind
    terrain_version: str
    status: StoredViabilityStatus
    path: JsonObject
    metrics: JsonObject
    created_at: str


@dataclass(frozen=True, slots=True)
class StoredMissionEvent:
    event_id: str
    mission_id: str
    mission_version: int
    event_type: str
    payload: JsonObject
    created_at: str


@dataclass(frozen=True, slots=True)
class StoredMission:
    mission_id: str
    region_id: str
    frame_id: str
    terrain_version: str
    current_version: int
    lifecycle_status: MissionLifecycleStatus
    viability_status: StoredViabilityStatus
    created_at: str
    updated_at: str
    snapshot: JsonObject
    routes: tuple[StoredRoute, ...] = field(default_factory=tuple)
