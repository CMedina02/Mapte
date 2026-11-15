"""Domain models for simulated EVA support-time evaluation."""

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite


class ResourceEvaluationStatus(StrEnum):
    VIABLE = "viable"
    NOT_VIABLE = "not_viable"
    UNKNOWN = "unknown"


class OperationalSegmentKind(StrEnum):
    OUTBOUND_TRAVEL = "outbound_travel"
    ACTIVITY = "activity"
    RETURN_TRAVEL = "return_travel"
    OTHER = "other"


class OperationalSegmentStatus(StrEnum):
    VIABLE = "viable"
    NOT_VIABLE = "not_viable"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class SupportResources:
    """Simulated remaining EVA support expressed as equivalent minutes."""

    oxygen_available_min: float
    return_reserve_min: float

    def __post_init__(self) -> None:
        for name, value in (
            ("oxygen_available_min", self.oxygen_available_min),
            ("return_reserve_min", self.return_reserve_min),
        ):
            if not isfinite(value) or value < 0:
                raise ValueError(f"{name} debe ser finito y no negativo")


@dataclass(frozen=True, slots=True)
class OperationalSegment:
    segment_id: str
    kind: OperationalSegmentKind
    status: OperationalSegmentStatus
    duration_min: float | None

    def __post_init__(self) -> None:
        if not self.segment_id.strip():
            raise ValueError("segment_id no puede estar vacío")
        if self.duration_min is not None and (
            not isfinite(self.duration_min) or self.duration_min < 0
        ):
            raise ValueError("duration_min debe ser finito, no negativo o None")
        if self.status is OperationalSegmentStatus.VIABLE and self.duration_min is None:
            raise ValueError("Un segmento viable requiere una duración conocida")


@dataclass(frozen=True, slots=True)
class ResourceEvaluation:
    status: ResourceEvaluationStatus
    known_consumption_min: float
    projected_consumption_min: float | None
    oxygen_remaining_min: float | None
    reserve_margin_min: float | None
    reason_codes: tuple[str, ...]
    warnings: tuple[str, ...]
    assumptions: tuple[str, ...]
