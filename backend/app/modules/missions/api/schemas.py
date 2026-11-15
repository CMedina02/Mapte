"""HTTP schemas for route computation."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.catalog.api.schemas import PositionSchema


class RouteConstraintsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_slope_deg: float = Field(ge=0, lt=90)
    speed_m_per_min: float = Field(gt=0)
    avoid_unknown: bool


class RouteRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region_id: str = Field(min_length=1)
    start: PositionSchema
    end: PositionSchema
    constraints: RouteConstraintsSchema


class RouteResultSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route_id: str = Field(min_length=1)
    region_id: str = Field(min_length=1)
    frame_id: str = Field(min_length=1)
    terrain_version: str = Field(min_length=1)
    path: list[PositionSchema]
    distance_m: float | None = Field(default=None, ge=0)
    duration_min: float | None = Field(default=None, ge=0)
    ascent_m: float | None = Field(default=None, ge=0)
    max_slope_deg: float | None = Field(default=None, ge=0)
    status: Literal["viable", "not_viable", "unknown"]
    unknown_segments: int = Field(ge=0)
    warnings: list[str]
    evidence_ids: list[str]
    assumptions: list[str]
    sample_only: bool = False


class MissionResourcesSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    oxygen_available_min: float = Field(ge=0)
    return_reserve_min: float = Field(ge=0)


class MissionPlanRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region_id: str = Field(min_length=1)
    base_position: PositionSchema
    objective_ids: list[str] = Field(min_length=1)
    constraints: RouteConstraintsSchema
    resources: MissionResourcesSchema
    activity_durations_min: dict[str, float] = Field(default_factory=dict)


class MissionPlanResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_id: str
    mission_version: int = Field(ge=1)
    region_id: str
    frame_id: str
    terrain_version: str
    lifecycle_status: Literal["draft", "active", "completed", "aborted"]
    viability_status: Literal["viable", "not_viable", "unknown"]
    start_position: PositionSchema
    current_position: PositionSchema | None = None
    return_position: PositionSchema
    objective_ids: list[str]
    completed_objective_ids: list[str] = Field(default_factory=list)
    next_objective_id: str | None
    legs: list[dict]
    resources: dict
    resource_evaluation: dict
    alerts: list[str]
    decision_log: list[dict]
    evidence_ids: list[str]
    hazard_reports: list[dict] = Field(default_factory=list)


class HazardReportSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hazard_code: str = Field(min_length=1)
    position: PositionSchema
    effect: Literal["blocked", "unknown", "high_cost"]
    affected_radius_m: float = Field(ge=0)
    cost_multiplier: float = Field(default=1, ge=1)


class MissionReplanRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    current_position: PositionSchema
    completed_objective_ids: list[str] = Field(default_factory=list)
    report: HazardReportSchema
    constraints: RouteConstraintsSchema
    resources: MissionResourcesSchema
    activity_durations_min: dict[str, float] = Field(default_factory=dict)


class MissionProgressRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    current_position: PositionSchema
    completed_objective_ids: list[str]
    resources: MissionResourcesSchema


class MissionStatusRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    action: Literal["start", "complete", "abort"]
    current_position: PositionSchema | None = None
    resources: MissionResourcesSchema | None = None
    constraints: RouteConstraintsSchema | None = None


class MissionEventSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    mission_id: str
    mission_version: int
    event_type: str
    payload: dict
    created_at: str


class MissionEventsResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[MissionEventSchema]


class ObservationRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_version: int = Field(ge=1)
    objective_id: str = Field(min_length=1)
    finding_code: str = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=1000)
