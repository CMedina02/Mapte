"""Deterministic evaluator for simulated EVA support and return reserve."""

from collections.abc import Sequence

from app.modules.missions.resources.models import (
    OperationalSegment,
    OperationalSegmentStatus,
    ResourceEvaluation,
    ResourceEvaluationStatus,
    SupportResources,
)


class ResourceEvaluator:
    """Evaluate elapsed-time consumption without claiming a physiological model."""

    def evaluate(
        self,
        resources: SupportResources,
        segments: Sequence[OperationalSegment],
    ) -> ResourceEvaluation:
        if not segments:
            raise ValueError("At least one operational segment is required")
        segment_ids = [segment.segment_id for segment in segments]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("segment_id values cannot repeat")

        known_consumption = sum(
            segment.duration_min for segment in segments if segment.duration_min is not None
        )
        has_unknown_duration = any(segment.duration_min is None for segment in segments)
        has_unknown_status = any(
            segment.status is OperationalSegmentStatus.UNKNOWN for segment in segments
        )
        has_non_viable_segment = any(
            segment.status is OperationalSegmentStatus.NOT_VIABLE for segment in segments
        )

        projected_consumption = None if has_unknown_duration else known_consumption
        oxygen_remaining = (
            None
            if projected_consumption is None
            else resources.oxygen_available_min - projected_consumption
        )
        reserve_margin = (
            None if oxygen_remaining is None else oxygen_remaining - resources.return_reserve_min
        )

        reasons: list[str] = []
        warnings: list[str] = []
        if has_non_viable_segment:
            reasons.append("SEGMENT_NOT_VIABLE")
        if has_unknown_duration:
            reasons.append("DURATION_UNKNOWN")
            warnings.append("Not all operational durations are known")
        if has_unknown_status:
            reasons.append("SEGMENT_STATUS_UNKNOWN")
            warnings.append("At least one segment depends on uncertain information")
        if reserve_margin is not None and reserve_margin < 0:
            reasons.append("INSUFFICIENT_RETURN_RESERVE")
            warnings.append("Remaining support does not keep the required return reserve")

        if has_non_viable_segment or (reserve_margin is not None and reserve_margin < 0):
            status = ResourceEvaluationStatus.NOT_VIABLE
        elif has_unknown_duration or has_unknown_status:
            status = ResourceEvaluationStatus.UNKNOWN
        else:
            status = ResourceEvaluationStatus.VIABLE

        return ResourceEvaluation(
            status=status,
            known_consumption_min=known_consumption,
            projected_consumption_min=projected_consumption,
            oxygen_remaining_min=oxygen_remaining,
            reserve_margin_min=reserve_margin,
            reason_codes=tuple(reasons),
            warnings=tuple(warnings),
            assumptions=(
                "oxygen_available_min represents simulated minutes of remaining EVA support",
                "Provisional consumption is 1 minute of support per elapsed minute",
                "return_reserve_min is the minimum margin that must remain on return to base",
                "Physiology, radiation, dust, temperature "
                "and suit load are not modeled yet",
            ),
        )
