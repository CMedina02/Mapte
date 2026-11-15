"""Multi-leg mission planner composed from routing and resource services."""

from uuid import uuid4

from app.modules.catalog.domain import TerrainRepository
from app.modules.missions.planning.models import (
    MissionDecision,
    MissionLeg,
    MissionObjective,
    MissionPlan,
    MissionPlanningRequest,
    MissionPlanViability,
)
from app.modules.missions.planning.objectives import ObjectiveRepository
from app.modules.missions.resources import (
    OperationalSegment,
    OperationalSegmentKind,
    OperationalSegmentStatus,
    ResourceEvaluationStatus,
    ResourceEvaluator,
)
from app.modules.missions.routing import (
    RouteApplicationService,
    RouteOutcomeStatus,
)
from app.modules.missions.terrain import EnvironmentalHazardReport, LocalPosition


class UnknownObjectiveError(ValueError):
    """A requested objective does not exist in the selected region."""


class MissionPlanner:
    def __init__(
        self,
        terrain_repository: TerrainRepository,
        objective_repository: ObjectiveRepository,
        hazard_reports: tuple[EnvironmentalHazardReport, ...] = (),
    ) -> None:
        self._routes = RouteApplicationService(terrain_repository, hazard_reports)
        self._objectives = objective_repository
        self._resources = ResourceEvaluator()

    def plan(self, request: MissionPlanningRequest) -> MissionPlan:
        requested_objectives = self._resolve_objectives(request)
        objectives, legs, exclusions = self._plan_safe_prefix(request, requested_objectives)
        resource_segments = self._resource_segments(request, objectives, legs)
        evaluation = self._resources.evaluate(request.resources, resource_segments)
        viability = self._combine_viability(legs, evaluation.status)
        evidence_ids = tuple(
            dict.fromkeys(
                [evidence_id for objective in objectives for evidence_id in objective.evidence_ids]
                + [evidence_id for leg in legs for evidence_id in leg.route.evidence_ids]
            )
        )
        alerts = tuple(
            dict.fromkeys(
                [*self._alerts(legs, evaluation.reason_codes, viability)]
                + [f"OBJECTIVE_EXCLUDED:{objective_id}" for objective_id, _, _ in exclusions]
            )
        )
        ordered_titles = " → ".join(objective.title for objective in objectives) or "no objectives"
        decisions = [
            MissionDecision(
                event_type="plan_created",
                message=(
                    f"Safe order planned: base → {ordered_titles} → base. "
                    f"Model viability: {viability.value}."
                ),
                evidence_ids=evidence_ids,
            )
        ]
        decisions.extend(
            MissionDecision(
                event_type="objective_excluded",
                message=f"Objective {objective_id} excluded: {reason}.",
                evidence_ids=objective.evidence_ids,
            )
            for objective_id, reason, objective in exclusions
        )
        return MissionPlan(
            mission_id=str(uuid4()),
            region_id=request.region_id,
            version=1,
            start_position=request.base_position,
            return_position=request.return_position or request.base_position,
            objective_ids=tuple(objective.objective_id for objective in objectives),
            next_objective_id=objectives[0].objective_id if objectives else None,
            legs=legs,
            constraints=request.constraints,
            resources=request.resources,
            resource_evaluation=evaluation,
            viability=viability,
            alerts=alerts,
            decision_log=tuple(decisions),
            evidence_ids=evidence_ids,
        )

    def _plan_safe_prefix(
        self,
        request: MissionPlanningRequest,
        requested: tuple[MissionObjective, ...],
    ) -> tuple[
        tuple[MissionObjective, ...],
        tuple[MissionLeg, ...],
        tuple[tuple[str, str, MissionObjective], ...],
    ]:
        """Accept an ordered objective only when its full round trip is supportable."""
        accepted: list[MissionObjective] = []
        outbound_legs: list[MissionLeg] = []
        exclusions: list[tuple[str, str, MissionObjective]] = []
        current = request.base_position
        return_position = request.return_position or request.base_position
        return_leg: MissionLeg | None = None

        for objective_index, objective in enumerate(requested):
            start_label = accepted[-1].objective_id if accepted else "base"
            outbound = self._make_leg(
                request,
                len(outbound_legs) + 1,
                current,
                objective.position,
                start_label,
                objective.objective_id,
            )
            candidate_return = self._make_leg(
                request,
                len(outbound_legs) + 2,
                objective.position,
                return_position,
                objective.objective_id,
                "base",
            )
            candidate_objectives = (*accepted, objective)
            candidate_legs = (*outbound_legs, outbound, candidate_return)
            evaluation = self._resources.evaluate(
                request.resources,
                self._resource_segments(request, candidate_objectives, candidate_legs),
            )

            failed = next(
                (
                    leg
                    for leg in candidate_legs
                    if leg.route.status is RouteOutcomeStatus.NOT_VIABLE
                ),
                None,
            )
            uncertain = next(
                (leg for leg in candidate_legs if leg.route.status is RouteOutcomeStatus.UNKNOWN),
                None,
            )
            if failed is not None:
                reason = f"the route {failed.start_label}→{failed.end_label} is not viable"
            elif uncertain is not None:
                reason = (
                    f"the route search {uncertain.start_label}→{uncertain.end_label} "
                    "reached its computation limit"
                    if "ROUTE_SEARCH_LIMIT_REACHED" in uncertain.route.warnings
                    else f"the route {uncertain.start_label}→{uncertain.end_label} "
                    "depends on unknown terrain"
                )
            elif evaluation.status is ResourceEvaluationStatus.NOT_VIABLE:
                reason = "not enough resources left to complete the return and keep the reserve"
            elif evaluation.status is ResourceEvaluationStatus.UNKNOWN:
                reason = "consumption cannot be confirmed with the available data"
            else:
                accepted.append(objective)
                outbound_legs.append(outbound)
                return_leg = candidate_return
                current = objective.position
                continue

            exclusions.append((objective.objective_id, reason, objective))
            exclusions.extend(
                (
                    later.objective_id,
                    "skipped because it depends on an earlier excluded objective",
                    later,
                )
                for later in requested[objective_index + 1 :]
            )
            break

        if return_leg is None:
            return_leg = self._make_leg(
                request,
                1,
                request.base_position,
                return_position,
                "base",
                "base",
            )
        legs = (*outbound_legs, return_leg)
        normalized_legs = tuple(
            MissionLeg(
                leg_id=f"leg-{index}",
                start_label=leg.start_label,
                end_label=leg.end_label,
                route=leg.route,
            )
            for index, leg in enumerate(legs, start=1)
        )
        return tuple(accepted), normalized_legs, tuple(exclusions)

    def _make_leg(
        self,
        request: MissionPlanningRequest,
        index: int,
        start: LocalPosition,
        end: LocalPosition,
        start_label: str,
        end_label: str,
    ) -> MissionLeg:
        return MissionLeg(
            leg_id=f"leg-{index}",
            start_label=start_label,
            end_label=end_label,
            route=self._routes.compute(request.region_id, start, end, request.constraints),
        )

    def _resolve_objectives(self, request: MissionPlanningRequest) -> tuple[MissionObjective, ...]:
        resolved: list[MissionObjective] = []
        for objective_id in request.objective_ids:
            objective = self._objectives.get_objective(request.region_id, objective_id)
            if objective is None:
                raise UnknownObjectiveError(
                    f"Unknown objective in {request.region_id!r}: {objective_id!r}"
                )
            if objective.position.frame_id != request.base_position.frame_id:
                raise ValueError(
                    f"Objective {objective_id!r} uses a different frame_id than the base"
                )
            resolved.append(objective)
        return tuple(resolved)

    def _resource_segments(
        self,
        request: MissionPlanningRequest,
        objectives: tuple[MissionObjective, ...],
        legs: tuple[MissionLeg, ...],
    ) -> tuple[OperationalSegment, ...]:
        segments: list[OperationalSegment] = []
        for index, leg in enumerate(legs):
            if len(legs) == 1:
                kind = OperationalSegmentKind.RETURN_TRAVEL
            elif index == 0:
                kind = OperationalSegmentKind.OUTBOUND_TRAVEL
            elif index == len(legs) - 1:
                kind = OperationalSegmentKind.RETURN_TRAVEL
            else:
                kind = OperationalSegmentKind.OTHER
            segments.append(
                OperationalSegment(
                    segment_id=leg.leg_id,
                    kind=kind,
                    status=self._segment_status(leg.route.status),
                    duration_min=(leg.route.route.duration_min if leg.route.route else None),
                )
            )
            if index < len(objectives):
                objective = objectives[index]
                duration = request.activity_duration_for(objective.objective_id)
                segments.append(
                    OperationalSegment(
                        segment_id=f"activity:{objective.objective_id}",
                        kind=OperationalSegmentKind.ACTIVITY,
                        status=(
                            OperationalSegmentStatus.VIABLE
                            if duration is not None
                            else OperationalSegmentStatus.UNKNOWN
                        ),
                        duration_min=duration,
                    )
                )
        return tuple(segments)

    @staticmethod
    def _segment_status(status: RouteOutcomeStatus) -> OperationalSegmentStatus:
        return OperationalSegmentStatus(status.value)

    @staticmethod
    def _combine_viability(
        legs: tuple[MissionLeg, ...], resource_status: ResourceEvaluationStatus
    ) -> MissionPlanViability:
        route_statuses = {leg.route.status for leg in legs}
        if (
            RouteOutcomeStatus.NOT_VIABLE in route_statuses
            or resource_status is ResourceEvaluationStatus.NOT_VIABLE
        ):
            return MissionPlanViability.NOT_VIABLE
        if (
            RouteOutcomeStatus.UNKNOWN in route_statuses
            or resource_status is ResourceEvaluationStatus.UNKNOWN
        ):
            return MissionPlanViability.UNKNOWN
        return MissionPlanViability.VIABLE

    @staticmethod
    def _alerts(
        legs: tuple[MissionLeg, ...],
        resource_reasons: tuple[str, ...],
        viability: MissionPlanViability,
    ) -> tuple[str, ...]:
        alerts = [
            warning
            for leg in legs
            for warning in leg.route.warnings
            if warning != "ENDPOINTS_SNAPPED_TO_TERRAIN_CELL_CENTERS"
        ]
        alerts.extend(resource_reasons)
        if viability is not MissionPlanViability.VIABLE:
            alerts.append(f"MISSION_{viability.value.upper()}")
        return tuple(dict.fromkeys(alerts))
