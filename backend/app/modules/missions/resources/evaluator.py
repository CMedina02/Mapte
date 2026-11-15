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
            raise ValueError("Se requiere al menos un segmento operativo")
        segment_ids = [segment.segment_id for segment in segments]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("Los segment_id no pueden repetirse")

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
            warnings.append("No se conocen todas las duraciones operativas")
        if has_unknown_status:
            reasons.append("SEGMENT_STATUS_UNKNOWN")
            warnings.append("Al menos un segmento depende de información incierta")
        if reserve_margin is not None and reserve_margin < 0:
            reasons.append("INSUFFICIENT_RETURN_RESERVE")
            warnings.append("El soporte restante no conserva la reserva de retorno requerida")

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
                "oxygen_available_min representa minutos simulados de soporte EVA restante",
                "El consumo provisional es 1 minuto de soporte por minuto transcurrido",
                "return_reserve_min es el margen mínimo que debe permanecer al volver a la base",
                "No se modelan todavía fisiología, radiación, polvo, temperatura "
                "ni carga del traje",
            ),
        )
