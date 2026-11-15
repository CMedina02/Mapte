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
    objective_ids: list[str]
    next_objective_id: str | None
    legs: list[dict]
    resources: dict
    resource_evaluation: dict
    alerts: list[str]
    decision_log: list[dict]
    evidence_ids: list[str]
