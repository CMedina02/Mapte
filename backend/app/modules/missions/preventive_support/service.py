"""Deterministic comparison of direct return and preventive rendezvous options."""

from dataclasses import dataclass, replace
from enum import StrEnum
from math import hypot

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.resources import (
    OperationalSegment,
    OperationalSegmentKind,
    OperationalSegmentStatus,
    ResourceEvaluation,
    ResourceEvaluationStatus,
    ResourceEvaluator,
    SupportResources,
)
from app.modules.missions.routing import (
    RouteApplicationService,
    RouteComputation,
    RouteOutcomeStatus,
    RoutePlanningConstraints,
)
from app.modules.missions.terrain import EnvironmentalHazardReport, LocalPosition


class SupportOptionKind(StrEnum):
    DIRECT_RETURN = "direct_return"
    RENDEZVOUS = "rendezvous"


@dataclass(frozen=True, slots=True)
class PreventiveSupportOption:
    option_id: str
    kind: SupportOptionKind
    support_position: LocalPosition
    crew_route: RouteComputation
    vehicle_route: RouteComputation | None
    intervention_time_min: float | None
    total_distance_m: float | None
    resource_evaluation: ResourceEvaluation


@dataclass(frozen=True, slots=True)
class PreventiveSupportAnalysis:
    options: tuple[PreventiveSupportOption, ...]
    recommended_option_id: str | None
    warnings: tuple[str, ...]
    assumptions: tuple[str, ...]


class PreventiveSupportOptimizer:
    """Compare options without mutating the mission or claiming operational safety."""

    def __init__(
        self,
        terrain: TerrainRepository,
        reports: tuple[EnvironmentalHazardReport, ...] = (),
    ) -> None:
        self._routing = RouteApplicationService(terrain, reports)
        self._resources = ResourceEvaluator()

    def analyze(
        self,
        *,
        region_id: str,
        crew_position: LocalPosition,
        return_position: LocalPosition,
        vehicle_position: LocalPosition,
        candidate_positions: tuple[LocalPosition, ...],
        crew_constraints: RoutePlanningConstraints,
        vehicle_speed_m_per_min: float,
        resources: SupportResources,
    ) -> PreventiveSupportAnalysis:
        vehicle_constraints = replace(
            crew_constraints,
            speed_m_per_min=vehicle_speed_m_per_min,
        )
        direct_route = self._routing.compute(
            region_id, crew_position, return_position, crew_constraints
        )
        options = [
            self._option(
                option_id="direct-return",
                kind=SupportOptionKind.DIRECT_RETURN,
                position=return_position,
                crew_route=direct_route,
                vehicle_route=None,
                resources=resources,
            )
        ]
        for index, candidate in enumerate(candidate_positions, start=1):
            crew_route = self._routing.compute(
                region_id, crew_position, candidate, crew_constraints
            )
            vehicle_route = self._routing.compute(
                region_id, vehicle_position, candidate, vehicle_constraints
            )
            options.append(
                self._option(
                    option_id=f"rendezvous-{index}",
                    kind=SupportOptionKind.RENDEZVOUS,
                    position=candidate,
                    crew_route=crew_route,
                    vehicle_route=vehicle_route,
                    resources=resources,
                )
            )

        eligible = [
            option
            for option in options
            if option.resource_evaluation.status is not ResourceEvaluationStatus.NOT_VIABLE
        ]
        recommended = min(eligible, key=self._score).option_id if eligible else None
        warnings = ["SIMULATED_DECISION_SUPPORT_ONLY"]
        if recommended is None:
            warnings.append("NO_OPTION_PRESERVES_MODELED_RESERVE")
        elif (
            next(
                option for option in options if option.option_id == recommended
            ).resource_evaluation.status
            is ResourceEvaluationStatus.UNKNOWN
        ):
            warnings.append("RECOMMENDED_OPTION_HAS_UNKNOWN_DATA")
        return PreventiveSupportAnalysis(
            options=tuple(options),
            recommended_option_id=recommended,
            warnings=tuple(warnings),
            assumptions=(
                "The rendezvous point is limited to the mission's current route",
                "The vehicle and crew use the same slope limit and NoData policy",
                "Vehicle speed is an independent simulated parameter",
                "Consumption until intervention uses the longest arrival time, "
                "including waiting",
                "Vehicle failures, communications, physiology "
                "and consumable transfer are not modeled",
            ),
        )

    def _option(
        self,
        *,
        option_id: str,
        kind: SupportOptionKind,
        position: LocalPosition,
        crew_route: RouteComputation,
        vehicle_route: RouteComputation | None,
        resources: SupportResources,
    ) -> PreventiveSupportOption:
        routes = (crew_route,) if vehicle_route is None else (crew_route, vehicle_route)
        durations = [route.route.duration_min if route.route else None for route in routes]
        intervention_time = None if any(value is None for value in durations) else max(durations)
        statuses = [route.status for route in routes]
        segment_status = (
            OperationalSegmentStatus.NOT_VIABLE
            if RouteOutcomeStatus.NOT_VIABLE in statuses
            else OperationalSegmentStatus.UNKNOWN
            if RouteOutcomeStatus.UNKNOWN in statuses
            else OperationalSegmentStatus.VIABLE
        )
        evaluation = self._resources.evaluate(
            resources,
            (
                OperationalSegment(
                    segment_id=option_id,
                    kind=(
                        OperationalSegmentKind.RETURN_TRAVEL
                        if kind is SupportOptionKind.DIRECT_RETURN
                        else OperationalSegmentKind.OTHER
                    ),
                    status=segment_status,
                    duration_min=intervention_time,
                ),
            ),
        )
        distances = [route.route.distance_m if route.route else None for route in routes]
        total_distance = None if any(value is None for value in distances) else sum(distances)
        return PreventiveSupportOption(
            option_id=option_id,
            kind=kind,
            support_position=position,
            crew_route=crew_route,
            vehicle_route=vehicle_route,
            intervention_time_min=intervention_time,
            total_distance_m=total_distance,
            resource_evaluation=evaluation,
        )

    @staticmethod
    def _score(option: PreventiveSupportOption) -> tuple[int, float, float, str]:
        status_rank = {
            ResourceEvaluationStatus.VIABLE: 0,
            ResourceEvaluationStatus.UNKNOWN: 1,
            ResourceEvaluationStatus.NOT_VIABLE: 2,
        }
        return (
            status_rank[option.resource_evaluation.status],
            option.intervention_time_min
            if option.intervention_time_min is not None
            else float("inf"),
            option.total_distance_m if option.total_distance_m is not None else float("inf"),
            option.option_id,
        )


def sample_route_positions(
    points: tuple[LocalPosition, ...], max_candidates: int
) -> tuple[LocalPosition, ...]:
    """Select deterministic, approximately equidistant positions along a polyline."""
    if max_candidates < 1 or not points:
        return ()
    ordered = [points[0]]
    for point in points[1:]:
        if point != ordered[-1]:
            ordered.append(point)
    if len(ordered) <= max_candidates:
        return tuple(dict.fromkeys(ordered))
    cumulative = [0.0]
    for previous, current in zip(ordered, ordered[1:], strict=False):
        cumulative.append(
            cumulative[-1] + hypot(current.x_m - previous.x_m, current.y_m - previous.y_m)
        )
    total = cumulative[-1]
    if total == 0:
        return (ordered[0],)
    selected: list[LocalPosition] = []
    closed_route = ordered[0] == ordered[-1]
    for index in range(max_candidates):
        target = (
            total * (index + 1) / (max_candidates + 1)
            if closed_route
            else total * index / (max_candidates - 1)
        )
        nearest = min(range(len(ordered)), key=lambda item: (abs(cumulative[item] - target), item))
        if ordered[nearest] not in selected:
            selected.append(ordered[nearest])
    return tuple(selected)
