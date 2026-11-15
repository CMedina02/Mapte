"""Translate a computed mission plan into durable records."""

from uuid import uuid4

from app.modules.missions.persistence import (
    MissionCreate,
    MissionEventDraft,
    MissionLifecycleStatus,
    RouteDraft,
    StoredRouteKind,
    StoredViabilityStatus,
)
from app.modules.missions.planning.models import MissionPlan


def mission_create_from_plan(plan: MissionPlan) -> MissionCreate:
    first_route = plan.legs[0].route
    snapshot = {
        "objective_ids": list(plan.objective_ids),
        "next_objective_id": plan.next_objective_id,
        "legs": [_leg_snapshot(leg) for leg in plan.legs],
        "resources": {
            "oxygen_available_min": plan.resources.oxygen_available_min,
            "return_reserve_min": plan.resources.return_reserve_min,
        },
        "resource_evaluation": {
            "status": plan.resource_evaluation.status.value,
            "known_consumption_min": plan.resource_evaluation.known_consumption_min,
            "projected_consumption_min": plan.resource_evaluation.projected_consumption_min,
            "oxygen_remaining_min": plan.resource_evaluation.oxygen_remaining_min,
            "reserve_margin_min": plan.resource_evaluation.reserve_margin_min,
            "reason_codes": list(plan.resource_evaluation.reason_codes),
            "warnings": list(plan.resource_evaluation.warnings),
            "assumptions": list(plan.resource_evaluation.assumptions),
        },
        "alerts": list(plan.alerts),
        "decision_log": [
            {
                "event_type": decision.event_type,
                "message": decision.message,
                "evidence_ids": list(decision.evidence_ids),
                "simulated": decision.simulated,
            }
            for decision in plan.decision_log
        ],
        "evidence_ids": list(plan.evidence_ids),
    }
    routes = tuple(
        RouteDraft(
            route_id=leg.route.route_id,
            kind=(
                StoredRouteKind.RETURN if index == len(plan.legs) - 1 else StoredRouteKind.ACTIVE
            ),
            status=StoredViabilityStatus(leg.route.status.value),
            path={
                "leg_id": leg.leg_id,
                "frame_id": leg.route.frame_id,
                "points": (
                    [
                        {
                            "x_m": point.x_m,
                            "y_m": point.y_m,
                            "z_m": point.z_m,
                            "frame_id": point.frame_id,
                        }
                        for point in leg.route.route.path
                    ]
                    if leg.route.route
                    else []
                ),
            },
            metrics=_route_metrics(leg),
        )
        for index, leg in enumerate(plan.legs)
    )
    events = tuple(
        MissionEventDraft(
            event_id=str(uuid4()),
            event_type=decision.event_type,
            payload={
                "message": decision.message,
                "evidence_ids": list(decision.evidence_ids),
                "simulated": decision.simulated,
            },
        )
        for decision in plan.decision_log
    )
    return MissionCreate(
        mission_id=plan.mission_id,
        region_id=plan.region_id,
        frame_id=first_route.frame_id,
        terrain_version=first_route.terrain_version,
        lifecycle_status=MissionLifecycleStatus.DRAFT,
        viability_status=StoredViabilityStatus(plan.viability.value),
        snapshot=snapshot,
        routes=routes,
        events=events,
    )


def _leg_snapshot(leg) -> dict:
    route = leg.route.route
    return {
        "leg_id": leg.leg_id,
        "route_id": leg.route.route_id,
        "start_label": leg.start_label,
        "end_label": leg.end_label,
        "status": leg.route.status.value,
        "path": (
            [
                {
                    "x_m": point.x_m,
                    "y_m": point.y_m,
                    "z_m": point.z_m,
                    "frame_id": point.frame_id,
                }
                for point in route.path
            ]
            if route
            else []
        ),
        "metrics": _route_metrics(leg),
        "warnings": list(leg.route.warnings),
        "assumptions": list(leg.route.assumptions),
    }


def _route_metrics(leg) -> dict:
    route = leg.route.route
    return {
        "distance_m": route.distance_m if route else None,
        "duration_min": route.duration_min if route else None,
        "ascent_m": route.ascent_m if route else None,
        "max_slope_deg": route.max_slope_deg if route else None,
        "unknown_segments": leg.route.unknown_segments,
    }
