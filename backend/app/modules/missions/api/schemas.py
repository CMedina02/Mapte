"""HTTP schemas for route computation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.catalog.api.schemas import (
    ObjectiveSchema,
    PhotoSchema,
    PositionSchema,
    RegionManifestResponse,
)


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


class MissionRouteMetricsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    distance_m: float | None = Field(default=None, ge=0)
    duration_min: float | None = Field(default=None, ge=0)
    ascent_m: float | None = Field(default=None, ge=0)
    max_slope_deg: float | None = Field(default=None, ge=0)
    unknown_segments: int = Field(ge=0)


class MissionLegSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    leg_id: str = Field(min_length=1)
    route_id: str = Field(min_length=1)
    start_label: str = Field(min_length=1)
    end_label: str = Field(min_length=1)
    status: Literal["viable", "not_viable", "unknown"]
    path: list[PositionSchema]
    metrics: MissionRouteMetricsSchema
    warnings: list[str]
    assumptions: list[str]


class MissionResourceEvaluationSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["viable", "not_viable", "unknown"]
    known_consumption_min: float = Field(ge=0)
    projected_consumption_min: float | None = Field(default=None, ge=0)
    oxygen_remaining_min: float | None = None
    reserve_margin_min: float | None = None
    reason_codes: list[str]
    warnings: list[str]
    assumptions: list[str]


class MissionDecisionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: str = Field(min_length=1)
    message: str = Field(min_length=1)
    evidence_ids: list[str]
    simulated: bool


class MissionHazardReportSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_id: str = Field(min_length=1)
    mission_version: int = Field(ge=1)
    position: PositionSchema
    hazard_code: str = Field(min_length=1)
    effect: Literal["blocked", "unknown", "high_cost"]
    affected_radius_m: float = Field(ge=0)
    cost_multiplier: float = Field(ge=1)


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
    legs: list[MissionLegSchema]
    routing_constraints: RouteConstraintsSchema | None = None
    resources: MissionResourcesSchema
    resource_evaluation: MissionResourceEvaluationSchema
    alerts: list[str]
    decision_log: list[MissionDecisionSchema]
    evidence_ids: list[str]
    hazard_reports: list[MissionHazardReportSchema] = Field(default_factory=list)


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


class MissionAdvanceRequestSchema(BaseModel):
    """Recalcular los objetivos pendientes desde donde está el astronauta."""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    current_position: PositionSchema
    # Parada desde la que se sale (objetivo recién completado); por defecto, el último completado
    from_label: str | None = None
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


class ContingencyRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_version: int = Field(ge=1)
    contingency_type: Literal["oxygen_reduced", "rover_unavailable"]
    position: PositionSchema
    oxygen_available_min: float = Field(ge=0)


class PreventiveSupportRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_version: int = Field(ge=1)
    crew_position: PositionSchema
    support_vehicle_position: PositionSchema
    oxygen_available_min: float = Field(ge=0)
    vehicle_speed_m_per_min: float = Field(gt=0)
    max_candidates: int = Field(default=7, ge=2, le=12)


class PreventiveSupportOptionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: str = Field(min_length=1)
    kind: Literal["direct_return", "rendezvous"]
    support_position: PositionSchema
    crew_route: RouteResultSchema
    vehicle_route: RouteResultSchema | None
    intervention_time_min: float | None = Field(default=None, ge=0)
    total_distance_m: float | None = Field(default=None, ge=0)
    resource_evaluation: MissionResourceEvaluationSchema


class PreventiveSupportResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_id: str = Field(min_length=1)
    mission_version: int = Field(ge=1)
    terrain_version: str = Field(min_length=1)
    options: list[PreventiveSupportOptionSchema]
    recommended_option_id: str | None
    warnings: list[str]
    assumptions: list[str]
    generated_at: datetime


class MissionPackageSyncSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_version: int = Field(ge=1)
    requires_network: bool
    remote_asset_count: int = Field(ge=0)
    missing_asset_count: int = Field(ge=0)


class MissionPackageResponseSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_version: Literal["1.0"] = "1.0"
    mission: MissionPlanResponseSchema
    region_manifest: RegionManifestResponse
    objectives: list[ObjectiveSchema]
    photos: list[PhotoSchema]
    offline_assets: list[str]
    missing_assets: list[str]
    package_status: Literal["ready_to_sync", "incomplete"]
    sync: MissionPackageSyncSchema
    generated_at: datetime
    sample_only: bool = False
