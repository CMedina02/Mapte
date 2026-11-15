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
