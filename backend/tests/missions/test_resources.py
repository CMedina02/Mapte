import pytest

from app.modules.missions.resources import (
    OperationalSegment,
    OperationalSegmentKind,
    OperationalSegmentStatus,
    ResourceEvaluationStatus,
    ResourceEvaluator,
    SupportResources,
)


def segment(
    segment_id: str,
    kind: OperationalSegmentKind,
    duration_min: float | None,
    status: OperationalSegmentStatus = OperationalSegmentStatus.VIABLE,
) -> OperationalSegment:
    return OperationalSegment(segment_id, kind, status, duration_min)


def round_trip() -> tuple[OperationalSegment, ...]:
    return (
        segment("outbound", OperationalSegmentKind.OUTBOUND_TRAVEL, 30),
        segment("science", OperationalSegmentKind.ACTIVITY, 20),
        segment("return", OperationalSegmentKind.RETURN_TRAVEL, 40),
    )


def test_resources_include_outbound_activity_return_and_reserve() -> None:
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=180, return_reserve_min=60),
        round_trip(),
    )

    assert result.status is ResourceEvaluationStatus.VIABLE
    assert result.known_consumption_min == 90
    assert result.projected_consumption_min == 90
    assert result.oxygen_remaining_min == 90
    assert result.reserve_margin_min == 30
    assert result.reason_codes == ()


def test_exact_reserve_boundary_is_viable() -> None:
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=150, return_reserve_min=60),
        round_trip(),
    )

    assert result.status is ResourceEvaluationStatus.VIABLE
    assert result.reserve_margin_min == 0


def test_insufficient_reserve_is_not_viable() -> None:
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=149, return_reserve_min=60),
        round_trip(),
    )

    assert result.status is ResourceEvaluationStatus.NOT_VIABLE
    assert result.reserve_margin_min == -1
    assert result.reason_codes == ("INSUFFICIENT_RETURN_RESERVE",)


def test_unknown_activity_duration_never_defaults_to_zero() -> None:
    segments = (
        segment("outbound", OperationalSegmentKind.OUTBOUND_TRAVEL, 30),
        segment(
            "science",
            OperationalSegmentKind.ACTIVITY,
            None,
            OperationalSegmentStatus.UNKNOWN,
        ),
        segment("return", OperationalSegmentKind.RETURN_TRAVEL, 40),
    )
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=500, return_reserve_min=60),
        segments,
    )

    assert result.status is ResourceEvaluationStatus.UNKNOWN
    assert result.known_consumption_min == 70
    assert result.projected_consumption_min is None
    assert result.oxygen_remaining_min is None
    assert result.reserve_margin_min is None
    assert result.reason_codes == ("DURATION_UNKNOWN", "SEGMENT_STATUS_UNKNOWN")


def test_known_duration_on_unknown_route_keeps_metrics_but_not_viability() -> None:
    segments = (
        segment(
            "outbound",
            OperationalSegmentKind.OUTBOUND_TRAVEL,
            30,
            OperationalSegmentStatus.UNKNOWN,
        ),
        segment("return", OperationalSegmentKind.RETURN_TRAVEL, 40),
    )
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=180, return_reserve_min=60),
        segments,
    )

    assert result.status is ResourceEvaluationStatus.UNKNOWN
    assert result.projected_consumption_min == 70
    assert result.reserve_margin_min == 50
    assert result.reason_codes == ("SEGMENT_STATUS_UNKNOWN",)


def test_non_viable_route_dominates_available_resources() -> None:
    segments = (
        segment(
            "outbound",
            OperationalSegmentKind.OUTBOUND_TRAVEL,
            None,
            OperationalSegmentStatus.NOT_VIABLE,
        ),
        segment("return", OperationalSegmentKind.RETURN_TRAVEL, 20),
    )
    result = ResourceEvaluator().evaluate(
        SupportResources(oxygen_available_min=1000, return_reserve_min=0),
        segments,
    )

    assert result.status is ResourceEvaluationStatus.NOT_VIABLE
    assert "SEGMENT_NOT_VIABLE" in result.reason_codes


def test_reducing_available_support_cannot_improve_viability() -> None:
    statuses = [
        ResourceEvaluator().evaluate(SupportResources(available, 60), round_trip()).status
        for available in (180, 150, 149, 100)
    ]

    assert statuses == [
        ResourceEvaluationStatus.VIABLE,
        ResourceEvaluationStatus.VIABLE,
        ResourceEvaluationStatus.NOT_VIABLE,
        ResourceEvaluationStatus.NOT_VIABLE,
    ]


def test_resource_inputs_reject_invalid_or_ambiguous_values() -> None:
    with pytest.raises(ValueError, match="no negativo"):
        SupportResources(-1, 0)
    with pytest.raises(ValueError, match="duración conocida"):
        segment("activity", OperationalSegmentKind.ACTIVITY, None)
    with pytest.raises(ValueError, match="al menos un segmento"):
        ResourceEvaluator().evaluate(SupportResources(100, 20), ())
    with pytest.raises(ValueError, match="no pueden repetirse"):
        ResourceEvaluator().evaluate(
            SupportResources(100, 20),
            (
                segment("same", OperationalSegmentKind.OUTBOUND_TRAVEL, 10),
                segment("same", OperationalSegmentKind.RETURN_TRAVEL, 10),
            ),
        )
