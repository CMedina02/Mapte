"""Domain models for reproducible multi-objective mission planning."""

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite

from app.modules.missions.resources import ResourceEvaluation, SupportResources
from app.modules.missions.routing import (
    RouteComputation,
    RoutePlanningConstraints,
)
from app.modules.missions.terrain import LocalPosition


class MissionPlanViability(StrEnum):
    VIABLE = "viable"
    NOT_VIABLE = "not_viable"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class MissionObjective:
    objective_id: str
    region_id: str
    title: str
    position: LocalPosition
    activities: tuple[str, ...]
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.objective_id.strip() or not self.region_id.strip() or not self.title.strip():
            raise ValueError("objective_id, region_id y title no pueden estar vacíos")


@dataclass(frozen=True, slots=True)
class MissionPlanningRequest:
    region_id: str
    base_position: LocalPosition
    objective_ids: tuple[str, ...]
    constraints: RoutePlanningConstraints
    resources: SupportResources
    activity_durations_min: tuple[tuple[str, float], ...] = ()
    return_position: LocalPosition | None = None

    def __post_init__(self) -> None:
        if not self.region_id.strip():
            raise ValueError("region_id no puede estar vacío")
        if len(self.objective_ids) != len(set(self.objective_ids)):
            raise ValueError("objective_ids no puede contener duplicados")
        duration_ids = [objective_id for objective_id, _ in self.activity_durations_min]
        if len(duration_ids) != len(set(duration_ids)):
            raise ValueError("activity_durations_min contiene objective_id duplicados")
        unknown_ids = set(duration_ids).difference(self.objective_ids)
        if unknown_ids:
            raise ValueError(f"Hay duraciones para objetivos no solicitados: {sorted(unknown_ids)}")
        for objective_id, duration_min in self.activity_durations_min:
            if not objective_id.strip() or not isfinite(duration_min) or duration_min < 0:
                raise ValueError("Las duraciones requieren ID válido y minutos no negativos")
        if self.return_position and self.return_position.frame_id != self.base_position.frame_id:
            raise ValueError("return_position debe usar el mismo frame_id que base_position")

    def activity_duration_for(self, objective_id: str) -> float | None:
        return dict(self.activity_durations_min).get(objective_id)


@dataclass(frozen=True, slots=True)
class MissionLeg:
    leg_id: str
    start_label: str
    end_label: str
    route: RouteComputation


@dataclass(frozen=True, slots=True)
class MissionDecision:
    event_type: str
    message: str
    evidence_ids: tuple[str, ...]
    simulated: bool = True


@dataclass(frozen=True, slots=True)
class MissionPlan:
    mission_id: str
    region_id: str
    version: int
    start_position: LocalPosition
    return_position: LocalPosition
    objective_ids: tuple[str, ...]
    next_objective_id: str | None
    legs: tuple[MissionLeg, ...]
    resources: SupportResources
    resource_evaluation: ResourceEvaluation
    viability: MissionPlanViability
    alerts: tuple[str, ...]
    decision_log: tuple[MissionDecision, ...]
    evidence_ids: tuple[str, ...]
