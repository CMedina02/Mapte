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


class UnknownObjectiveError(ValueError):
    """A requested objective does not exist in the selected region."""


class MissionPlanner:
    def __init__(
        self,
        terrain_repository: TerrainRepository,
        objective_repository: ObjectiveRepository,
    ) -> None:
        self._routes = RouteApplicationService(terrain_repository)
        self._objectives = objective_repository
        self._resources = ResourceEvaluator()

    def plan(self, request: MissionPlanningRequest) -> MissionPlan:
        objectives = self._resolve_objectives(request)
        legs = self._plan_legs(request, objectives)
        resource_segments = self._resource_segments(request, objectives, legs)
        evaluation = self._resources.evaluate(request.resources, resource_segments)
        viability = self._combine_viability(legs, evaluation.status)
        evidence_ids = tuple(
            dict.fromkeys(
                [evidence_id for objective in objectives for evidence_id in objective.evidence_ids]
                + [evidence_id for leg in legs for evidence_id in leg.route.evidence_ids]
            )
        )
        alerts = self._alerts(legs, evaluation.reason_codes, viability)
        ordered_titles = " → ".join(objective.title for objective in objectives)
        return MissionPlan(
            mission_id=str(uuid4()),
            region_id=request.region_id,
            version=1,
            objective_ids=request.objective_ids,
            next_objective_id=request.objective_ids[0],
            legs=legs,
            resources=request.resources,
            resource_evaluation=evaluation,
            viability=viability,
            alerts=alerts,
            decision_log=(
                MissionDecision(
                    event_type="plan_created",
                    message=(
                        f"Orden solicitado conservado: base → {ordered_titles} → base. "
                        f"Viabilidad del modelo: {viability.value}."
                    ),
                    evidence_ids=evidence_ids,
                ),
            ),
            evidence_ids=evidence_ids,
        )

    def _resolve_objectives(self, request: MissionPlanningRequest) -> tuple[MissionObjective, ...]:
        resolved: list[MissionObjective] = []
        for objective_id in request.objective_ids:
            objective = self._objectives.get_objective(request.region_id, objective_id)
            if objective is None:
                raise UnknownObjectiveError(
                    f"Objetivo desconocido en {request.region_id!r}: {objective_id!r}"
                )
            if objective.position.frame_id != request.base_position.frame_id:
                raise ValueError(
                    f"El objetivo {objective_id!r} usa un frame_id distinto al de la base"
                )
            resolved.append(objective)
        return tuple(resolved)

    def _plan_legs(
        self,
        request: MissionPlanningRequest,
        objectives: tuple[MissionObjective, ...],
    ) -> tuple[MissionLeg, ...]:
        stops = (
            request.base_position,
            *(item.position for item in objectives),
            request.base_position,
        )
        labels = ("base", *(item.objective_id for item in objectives), "base")
        legs = []
        for index, (start, end) in enumerate(zip(stops, stops[1:]), start=1):
            legs.append(
                MissionLeg(
                    leg_id=f"leg-{index}",
                    start_label=labels[index - 1],
                    end_label=labels[index],
                    route=self._routes.compute(
                        request.region_id,
                        start,
                        end,
                        request.constraints,
                    ),
                )
            )
        return tuple(legs)

    def _resource_segments(
        self,
        request: MissionPlanningRequest,
        objectives: tuple[MissionObjective, ...],
        legs: tuple[MissionLeg, ...],
    ) -> tuple[OperationalSegment, ...]:
        segments: list[OperationalSegment] = []
        for index, leg in enumerate(legs):
            if index == 0:
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
