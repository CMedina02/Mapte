"""HTTP route-computation endpoint for Backend 2."""

from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from app.modules.catalog.api.router import (
    build_objectives_response,
    build_photos_response,
    build_region_manifest,
    get_catalog_store,
)
from app.modules.catalog.api.schemas import RegionManifestResponse
from app.modules.catalog.domain import TerrainRepository
from app.modules.catalog.infrastructure.terrain_loader import CatalogStore
from app.modules.missions.api.schemas import (
    ContingencyRequestSchema,
    MissionAdvanceRequestSchema,
    MissionEventsResponseSchema,
    MissionPackageResponseSchema,
    MissionPlanRequestSchema,
    MissionPlanResponseSchema,
    MissionProgressRequestSchema,
    MissionReplanRequestSchema,
    MissionStatusRequestSchema,
    ObservationRequestSchema,
    PreventiveSupportRequestSchema,
    PreventiveSupportResponseSchema,
    RouteRequestSchema,
    RouteResultSchema,
)
from app.modules.missions.observations import decide_observation
from app.modules.missions.persistence import (
    MissionEventDraft,
    MissionLifecycleStatus,
    MissionRepository,
    MissionUpdate,
    MissionVersionConflictError,
    StoredMission,
    StoredViabilityStatus,
)
from app.modules.missions.planning import (
    MissionPlanner,
    MissionPlanningRequest,
    ObjectiveRepository,
)
from app.modules.missions.planning.persistence import mission_create_from_plan
from app.modules.missions.preventive_support import (
    PreventiveSupportOptimizer,
    sample_route_positions,
)
from app.modules.missions.resources import SupportResources
from app.modules.missions.routing import (
    InvalidRouteEndpointError,
    RoutePlanningConstraints,
)
from app.modules.missions.routing.service import RouteApplicationService, RouteComputation
from app.modules.missions.terrain import (
    EnvironmentalHazardReport,
    FrameMismatchError,
    HazardEffect,
    LocalPosition,
)

missions_router = APIRouter(tags=["Missions"])


def get_terrain_repository(request: Request) -> TerrainRepository:
    repository = getattr(request.app.state, "terrain_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="El terreno no está cargado.")
    return repository


TerrainDep = Annotated[TerrainRepository, Depends(get_terrain_repository)]


def get_objective_repository(request: Request) -> ObjectiveRepository:
    repository = getattr(request.app.state, "objective_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="El catálogo científico no está cargado.")
    return repository


def get_mission_repository(request: Request) -> MissionRepository:
    repository = getattr(request.app.state, "mission_repository", None)
    if repository is None:
        raise HTTPException(status_code=503, detail="La persistencia de misiones no está lista.")
    return repository


ObjectiveDep = Annotated[ObjectiveRepository, Depends(get_objective_repository)]
MissionDep = Annotated[MissionRepository, Depends(get_mission_repository)]
CatalogDep = Annotated[CatalogStore, Depends(get_catalog_store)]


@missions_router.post("/routes/compute", response_model=RouteResultSchema)
def compute_route(payload: RouteRequestSchema, repository: TerrainDep) -> RouteResultSchema:
    service = RouteApplicationService(repository)
    constraints = RoutePlanningConstraints(
        max_slope_deg=payload.constraints.max_slope_deg,
        speed_m_per_min=payload.constraints.speed_m_per_min,
        avoid_unknown=payload.constraints.avoid_unknown,
    )
    start = LocalPosition(payload.start.x_m, payload.start.y_m, payload.start.frame_id)
    end = LocalPosition(payload.end.x_m, payload.end.y_m, payload.end.frame_id)

    try:
        result = service.compute(payload.region_id, start, end, constraints)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Región desconocida: {payload.region_id!r}.",
        ) from exc
    except (FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _route_response(result)


@missions_router.post("/missions/plan", response_model=MissionPlanResponseSchema, status_code=201)
def plan_mission(
    payload: MissionPlanRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    request = MissionPlanningRequest(
        region_id=payload.region_id,
        base_position=LocalPosition(
            payload.base_position.x_m,
            payload.base_position.y_m,
            payload.base_position.frame_id,
        ),
        objective_ids=tuple(payload.objective_ids),
        constraints=RoutePlanningConstraints(
            max_slope_deg=payload.constraints.max_slope_deg,
            speed_m_per_min=payload.constraints.speed_m_per_min,
            avoid_unknown=payload.constraints.avoid_unknown,
        ),
        resources=SupportResources(
            payload.resources.oxygen_available_min,
            payload.resources.return_reserve_min,
        ),
        activity_durations_min=tuple(payload.activity_durations_min.items()),
    )
    try:
        plan = MissionPlanner(terrain, objectives).plan(request)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stored = missions.create(mission_create_from_plan(plan))
    return _mission_response(stored)


@missions_router.get("/missions/{mission_id}", response_model=MissionPlanResponseSchema)
def get_mission(mission_id: str, missions: MissionDep) -> MissionPlanResponseSchema:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    return _mission_response(stored)


@missions_router.get(
    "/missions/{mission_id}/package",
    response_model=MissionPackageResponseSchema,
)
def get_mission_package(
    mission_id: str,
    catalog: CatalogDep,
    missions: MissionDep,
) -> MissionPackageResponseSchema:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    region = catalog.get(stored.region_id)
    if region is None:
        raise HTTPException(status_code=503, detail="La región de la misión no está cargada.")

    manifest = build_region_manifest(region)
    available_objectives = {
        item.objective_id: item
        for item in build_objectives_response(stored.region_id, catalog).objectives
    }
    missing_objective_ids = [
        item for item in stored.snapshot["objective_ids"] if item not in available_objectives
    ]
    if missing_objective_ids:
        raise HTTPException(
            status_code=503,
            detail=f"Faltan objetivos del paquete: {missing_objective_ids}.",
        )
    objectives = [available_objectives[item] for item in stored.snapshot["objective_ids"]]
    objective_ids = set(stored.snapshot["objective_ids"])
    photos = [
        item
        for item in build_photos_response(stored.region_id, catalog).photos
        if item.objective_id in objective_ids
    ]

    declared_local_assets = _manifest_asset_urls(manifest)
    published_files = region.asset_files()
    available_local_assets: list[str] = []
    missing_assets: list[str] = []
    for url in declared_local_assets:
        filename = urlparse(url).path.rsplit("/", 1)[-1]
        path = published_files.get(filename)
        if path is not None and path.is_file():
            available_local_assets.append(url)
        else:
            missing_assets.append(url)
    remote_assets = [item.image_url for item in photos]
    offline_assets = list(dict.fromkeys([*available_local_assets, *remote_assets]))
    package_status = "incomplete" if missing_assets else "ready_to_sync"
    return MissionPackageResponseSchema(
        mission=_mission_response(stored),
        region_manifest=manifest,
        objectives=objectives,
        photos=photos,
        offline_assets=offline_assets,
        missing_assets=missing_assets,
        package_status=package_status,
        sync={
            "mission_version": stored.current_version,
            "requires_network": bool(remote_assets),
            "remote_asset_count": len(set(remote_assets)),
            "missing_asset_count": len(missing_assets),
        },
        generated_at=datetime.now(UTC),
        sample_only=manifest.sample_only,
    )


@missions_router.post(
    "/missions/{mission_id}/hazard-reports",
    response_model=MissionPlanResponseSchema,
)
def report_hazard_and_replan(
    mission_id: str,
    payload: MissionReplanRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    if payload.expected_version != stored.current_version:
        raise HTTPException(status_code=409, detail="La misión fue actualizada por otro cliente.")
    original_ids = tuple(stored.snapshot["objective_ids"])
    completed = tuple(dict.fromkeys(payload.completed_objective_ids))
    if not set(completed).issubset(original_ids):
        raise HTTPException(status_code=400, detail="Hay objetivos completados ajenos a la misión.")
    remaining = tuple(item for item in original_ids if item not in completed)
    report_id = str(uuid4())
    report = EnvironmentalHazardReport(
        report_id=report_id,
        mission_version=payload.expected_version,
        position=_local_position(payload.report.position),
        hazard_code=payload.report.hazard_code,
        effect=HazardEffect(payload.report.effect),
        affected_radius_m=payload.report.affected_radius_m,
        cost_multiplier=payload.report.cost_multiplier,
    )
    previous_reports = tuple(
        _hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", [])
    )
    return_position = _local_position_data(stored.snapshot["return_position"])
    request = MissionPlanningRequest(
        region_id=stored.region_id,
        base_position=_local_position(payload.current_position),
        return_position=return_position,
        objective_ids=remaining,
        constraints=RoutePlanningConstraints(
            max_slope_deg=payload.constraints.max_slope_deg,
            speed_m_per_min=payload.constraints.speed_m_per_min,
            avoid_unknown=payload.constraints.avoid_unknown,
        ),
        resources=SupportResources(
            payload.resources.oxygen_available_min,
            payload.resources.return_reserve_min,
        ),
        activity_durations_min=tuple(payload.activity_durations_min.items()),
    )
    try:
        plan = MissionPlanner(terrain, objectives, (*previous_reports, report)).plan(request)
        draft = mission_create_from_plan(plan)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    report_data = {
        "report_id": report_id,
        "mission_version": payload.expected_version,
        "position": _position_data(report.position),
        "hazard_code": report.hazard_code,
        "effect": report.effect.value,
        "affected_radius_m": report.affected_radius_m,
        "cost_multiplier": report.cost_multiplier,
    }
    snapshot = {
        **draft.snapshot,
        "objective_ids": list(original_ids),
        "completed_objective_ids": list(completed),
        "hazard_reports": [*stored.snapshot.get("hazard_reports", []), report_data],
    }
    try:
        updated = missions.update(
            mission_id,
            MissionUpdate(
                expected_version=payload.expected_version,
                lifecycle_status=stored.lifecycle_status,
                viability_status=draft.viability_status,
                snapshot=snapshot,
                routes=draft.routes,
                events=(
                    *draft.events,
                    MissionEventDraft(str(uuid4()), "hazard_reported", report_data),
                ),
            ),
        )
    except MissionVersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _mission_response(updated)


@missions_router.patch(
    "/missions/{mission_id}/progress",
    response_model=MissionPlanResponseSchema,
)
def update_mission_progress(
    mission_id: str,
    payload: MissionProgressRequestSchema,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = _current_mission(missions, mission_id, payload.expected_version)
    if stored.lifecycle_status is not MissionLifecycleStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Solo una misión activa admite progreso.")
    original = tuple(stored.snapshot["objective_ids"])
    previous = tuple(stored.snapshot.get("completed_objective_ids", []))
    completed = tuple(dict.fromkeys(payload.completed_objective_ids))
    if not set(previous).issubset(completed) or not set(completed).issubset(original):
        raise HTTPException(
            status_code=400, detail="El progreso no puede revertir o inventar objetivos."
        )
    remaining = [item for item in original if item not in completed]
    snapshot = {
        **stored.snapshot,
        "current_position": _position_schema_data(payload.current_position),
        "completed_objective_ids": list(completed),
        "next_objective_id": remaining[0] if remaining else None,
        "resources": payload.resources.model_dump(),
        "resource_evaluation": {
            "status": "unknown",
            "reason_codes": ["ROUTE_REVALIDATION_REQUIRED"],
            "warnings": [],
            "assumptions": [],
            "known_consumption_min": 0,
            "projected_consumption_min": None,
            "oxygen_remaining_min": payload.resources.oxygen_available_min,
            "reserve_margin_min": None,
        },
        "alerts": list(dict.fromkeys([*stored.snapshot["alerts"], "ROUTE_REVALIDATION_REQUIRED"])),
    }
    updated = _update_mission(
        missions,
        mission_id,
        MissionUpdate(
            expected_version=payload.expected_version,
            lifecycle_status=stored.lifecycle_status,
            viability_status=StoredViabilityStatus.UNKNOWN,
            snapshot=snapshot,
            events=(
                MissionEventDraft(
                    str(uuid4()),
                    "progress_updated",
                    {
                        "current_position": snapshot["current_position"],
                        "completed_objective_ids": list(completed),
                        "resources": snapshot["resources"],
                    },
                ),
            ),
        ),
    )
    return _mission_response(updated)


@missions_router.post(
    "/missions/{mission_id}/status",
    response_model=MissionPlanResponseSchema,
)
def change_mission_status(
    mission_id: str,
    payload: MissionStatusRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = _current_mission(missions, mission_id, payload.expected_version)
    if payload.action == "abort":
        return _abort_mission(stored, payload, terrain, objectives, missions)
    target = (
        MissionLifecycleStatus.ACTIVE
        if payload.action == "start"
        else MissionLifecycleStatus.COMPLETED
    )
    if payload.action == "start" and stored.lifecycle_status is not MissionLifecycleStatus.DRAFT:
        raise HTTPException(status_code=409, detail="Solo una misión borrador puede iniciarse.")
    if payload.action == "complete":
        if stored.lifecycle_status is not MissionLifecycleStatus.ACTIVE:
            raise HTTPException(status_code=409, detail="Solo una misión activa puede completarse.")
        if set(stored.snapshot.get("completed_objective_ids", [])) != set(
            stored.snapshot["objective_ids"]
        ):
            raise HTTPException(status_code=409, detail="Aún existen objetivos pendientes.")
    updated = _update_mission(
        missions,
        mission_id,
        MissionUpdate(
            expected_version=payload.expected_version,
            lifecycle_status=target,
            viability_status=stored.viability_status,
            snapshot=stored.snapshot,
            events=(MissionEventDraft(str(uuid4()), f"mission_{target.value}", {}),),
        ),
    )
    return _mission_response(updated)


@missions_router.get(
    "/missions/{mission_id}/events",
    response_model=MissionEventsResponseSchema,
)
def get_mission_events(mission_id: str, missions: MissionDep) -> MissionEventsResponseSchema:
    if missions.get(mission_id) is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    return MissionEventsResponseSchema(
        events=[
            {
                "event_id": event.event_id,
                "mission_id": event.mission_id,
                "mission_version": event.mission_version,
                "event_type": event.event_type,
                "payload": event.payload,
                "created_at": event.created_at,
            }
            for event in missions.list_events(mission_id)
        ]
    )


@missions_router.post(
    "/missions/{mission_id}/contingencies",
    response_model=MissionPlanResponseSchema,
)
def evaluate_contingency(
    mission_id: str,
    payload: ContingencyRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = _current_mission(missions, mission_id, payload.mission_version)
    if stored.lifecycle_status is not MissionLifecycleStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Solo una misión activa admite contingencias.")
    if payload.contingency_type == "rover_unavailable":
        raise HTTPException(
            status_code=400,
            detail="rover_unavailable no está modelado; no se simulará un efecto inventado.",
        )
    if payload.position.frame_id != stored.frame_id:
        raise HTTPException(
            status_code=400,
            detail="La posición de la contingencia usa un frame_id distinto al de la misión.",
        )

    current_resources = stored.snapshot["resources"]
    if payload.oxygen_available_min >= current_resources["oxygen_available_min"]:
        raise HTTPException(
            status_code=400,
            detail="oxygen_reduced debe disminuir el soporte disponible actual.",
        )
    constraints_data = stored.snapshot.get("routing_constraints")
    if constraints_data is None:
        raise HTTPException(
            status_code=409,
            detail="La misión no conserva sus restricciones de ruta; debe replanificarse.",
        )

    reports = tuple(_hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", []))
    request = MissionPlanningRequest(
        region_id=stored.region_id,
        base_position=_local_position(payload.position),
        return_position=_local_position_data(stored.snapshot["return_position"]),
        objective_ids=(),
        constraints=_routing_constraints_from_data(constraints_data),
        resources=SupportResources(
            payload.oxygen_available_min,
            current_resources["return_reserve_min"],
        ),
    )
    try:
        plan = MissionPlanner(terrain, objectives, reports).plan(request)
        draft = mission_create_from_plan(plan)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return_leg = draft.snapshot["legs"][0]
    result_status = draft.viability_status.value
    decision_entry = {
        "event_type": "contingency_evaluated",
        "message": (
            "Reducción de soporte evaluada con retorno directo a la base. "
            f"Viabilidad del modelo: {result_status}."
        ),
        "evidence_ids": list(draft.snapshot["evidence_ids"]),
        "simulated": True,
    }
    assumptions = list(
        dict.fromkeys(
            [
                *return_leg["assumptions"],
                *draft.snapshot["resource_evaluation"]["assumptions"],
            ]
        )
    )
    event_payload = {
        "contingency_type": payload.contingency_type,
        "position": _position_schema_data(payload.position),
        "oxygen_available_min": payload.oxygen_available_min,
        "return_reserve_min": current_resources["return_reserve_min"],
        "return_status": result_status,
        "return_route_id": return_leg["route_id"],
        "return_route_status": return_leg["status"],
        "return_route_metrics": return_leg["metrics"],
        "resource_evaluation": draft.snapshot["resource_evaluation"],
        "hazard_report_ids": [
            item["report_id"] for item in stored.snapshot.get("hazard_reports", [])
        ],
        "assumptions": assumptions,
    }
    snapshot = {
        **draft.snapshot,
        "start_position": stored.snapshot["start_position"],
        "current_position": _position_schema_data(payload.position),
        "objective_ids": stored.snapshot["objective_ids"],
        "completed_objective_ids": stored.snapshot.get("completed_objective_ids", []),
        "next_objective_id": None,
        "legs": [{**return_leg, "start_label": "current_position"}],
        "hazard_reports": stored.snapshot.get("hazard_reports", []),
        "alerts": list(dict.fromkeys(["OXYGEN_REDUCED", *draft.snapshot["alerts"]])),
        "decision_log": [*stored.snapshot["decision_log"], decision_entry],
        "evidence_ids": list(
            dict.fromkeys([*stored.snapshot["evidence_ids"], *draft.snapshot["evidence_ids"]])
        ),
    }
    updated = _update_mission(
        missions,
        mission_id,
        MissionUpdate(
            expected_version=payload.mission_version,
            lifecycle_status=stored.lifecycle_status,
            viability_status=draft.viability_status,
            snapshot=snapshot,
            routes=draft.routes,
            events=(MissionEventDraft(str(uuid4()), "contingency_evaluated", event_payload),),
        ),
    )
    return _mission_response(updated)


@missions_router.post(
    "/missions/{mission_id}/preventive-support-options",
    response_model=PreventiveSupportResponseSchema,
)
def optimize_preventive_support(
    mission_id: str,
    payload: PreventiveSupportRequestSchema,
    terrain: TerrainDep,
    missions: MissionDep,
) -> PreventiveSupportResponseSchema:
    stored = _current_mission(missions, mission_id, payload.mission_version)
    if stored.lifecycle_status not in {
        MissionLifecycleStatus.DRAFT,
        MissionLifecycleStatus.ACTIVE,
    }:
        raise HTTPException(status_code=409, detail="La misión ya está cerrada.")
    constraints_data = stored.snapshot.get("routing_constraints")
    if constraints_data is None:
        raise HTTPException(
            status_code=409,
            detail="La misión no conserva las restricciones necesarias para comparar opciones.",
        )
    current_oxygen = stored.snapshot["resources"]["oxygen_available_min"]
    if payload.oxygen_available_min > current_oxygen:
        raise HTTPException(
            status_code=400,
            detail="oxygen_available_min no puede superar el soporte registrado en la misión.",
        )
    path_points = tuple(
        _local_position_data(point) for leg in stored.snapshot["legs"] for point in leg["path"]
    )
    candidates = sample_route_positions(path_points, payload.max_candidates)
    if not candidates:
        raise HTTPException(
            status_code=409, detail="La misión no tiene una ruta vigente evaluable."
        )
    reports = tuple(_hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", []))
    optimizer = PreventiveSupportOptimizer(terrain, reports)
    try:
        analysis = optimizer.analyze(
            region_id=stored.region_id,
            crew_position=_local_position(payload.crew_position),
            return_position=_local_position_data(stored.snapshot["return_position"]),
            vehicle_position=_local_position(payload.support_vehicle_position),
            candidate_positions=candidates,
            crew_constraints=_routing_constraints_from_data(constraints_data),
            vehicle_speed_m_per_min=payload.vehicle_speed_m_per_min,
            resources=SupportResources(
                payload.oxygen_available_min,
                stored.snapshot["resources"]["return_reserve_min"],
            ),
        )
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PreventiveSupportResponseSchema.model_validate(
        {
            "mission_id": stored.mission_id,
            "mission_version": stored.current_version,
            "terrain_version": stored.terrain_version,
            "options": [
                {
                    "option_id": option.option_id,
                    "kind": option.kind.value,
                    "support_position": _position_data(option.support_position),
                    "crew_route": _route_response(option.crew_route),
                    "vehicle_route": (
                        _route_response(option.vehicle_route) if option.vehicle_route else None
                    ),
                    "intervention_time_min": option.intervention_time_min,
                    "total_distance_m": option.total_distance_m,
                    "resource_evaluation": {
                        "status": option.resource_evaluation.status.value,
                        "known_consumption_min": option.resource_evaluation.known_consumption_min,
                        "projected_consumption_min": (
                            option.resource_evaluation.projected_consumption_min
                        ),
                        "oxygen_remaining_min": option.resource_evaluation.oxygen_remaining_min,
                        "reserve_margin_min": option.resource_evaluation.reserve_margin_min,
                        "reason_codes": list(option.resource_evaluation.reason_codes),
                        "warnings": list(option.resource_evaluation.warnings),
                        "assumptions": list(option.resource_evaluation.assumptions),
                    },
                }
                for option in analysis.options
            ],
            "recommended_option_id": analysis.recommended_option_id,
            "warnings": list(analysis.warnings),
            "assumptions": list(analysis.assumptions),
            "generated_at": datetime.now(UTC),
        }
    )


@missions_router.post(
    "/missions/{mission_id}/replan",
    response_model=MissionPlanResponseSchema,
)
def replan_from_current_position(
    mission_id: str,
    payload: MissionAdvanceRequestSchema,
    terrain: TerrainDep,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    """Recalcula la ruta de los objetivos pendientes desde la posición actual.

    Usa el mismo planificador de regreso seguro, las restricciones del plan y los riesgos ya
    reportados. Conserva la base, los objetivos originales y lo completado.
    """
    stored = _current_mission(missions, mission_id, payload.expected_version)
    if stored.lifecycle_status is not MissionLifecycleStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Solo una misión activa se puede recalcular.")
    constraints_data = stored.snapshot.get("routing_constraints")
    if constraints_data is None:
        raise HTTPException(
            status_code=409,
            detail="La misión no conserva sus restricciones de ruta; debe replanificarse.",
        )
    original_ids = tuple(stored.snapshot["objective_ids"])
    completed = tuple(stored.snapshot.get("completed_objective_ids", []))
    remaining = tuple(item for item in original_ids if item not in completed)
    reports = tuple(_hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", []))
    request = MissionPlanningRequest(
        region_id=stored.region_id,
        base_position=_local_position(payload.current_position),
        return_position=_local_position_data(stored.snapshot["return_position"]),
        objective_ids=remaining,
        constraints=_routing_constraints_from_data(constraints_data),
        resources=SupportResources(
            payload.resources.oxygen_available_min,
            payload.resources.return_reserve_min,
        ),
        activity_durations_min=tuple(
            (key, value)
            for key, value in payload.activity_durations_min.items()
            if key in remaining
        ),
    )
    try:
        plan = MissionPlanner(terrain, objectives, reports).plan(request)
        draft = mission_create_from_plan(plan)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # El planificador nombra "base" a su punto de salida: aquí es la parada donde está el astronauta
    from_label = payload.from_label or (completed[-1] if completed else "base")
    legs = [dict(leg) for leg in draft.snapshot["legs"]]
    if legs and legs[0]["start_label"] == "base" and from_label != "base":
        legs[0]["start_label"] = from_label
    accepted = draft.snapshot["objective_ids"]
    message = (
        "Ruta recalculada desde la posición actual: "
        + (" → ".join(accepted) + " → base" if accepted else "regreso a base")
        + f". Viabilidad del modelo: {draft.viability_status.value}."
    )
    recalculated = {
        "event_type": "route_recalculated",
        "message": message,
        "evidence_ids": [],
        "simulated": True,
    }
    snapshot = {
        **draft.snapshot,
        "start_position": stored.snapshot["start_position"],
        "current_position": _position_schema_data(payload.current_position),
        "objective_ids": list(original_ids),
        "completed_objective_ids": list(completed),
        "legs": legs,
        "hazard_reports": stored.snapshot.get("hazard_reports", []),
        "decision_log": [
            *stored.snapshot["decision_log"],
            recalculated,
            *(
                entry
                for entry in draft.snapshot["decision_log"]
                if entry["event_type"] == "objective_excluded"
            ),
        ],
    }
    updated = _update_mission(
        missions,
        mission_id,
        MissionUpdate(
            expected_version=payload.expected_version,
            lifecycle_status=stored.lifecycle_status,
            viability_status=draft.viability_status,
            snapshot=snapshot,
            routes=draft.routes,
            events=(
                MissionEventDraft(
                    str(uuid4()),
                    "route_recalculated",
                    {"from_label": from_label, "remaining": list(remaining)},
                ),
            ),
        ),
    )
    return _mission_response(updated)


@missions_router.post(
    "/missions/{mission_id}/observations",
    response_model=MissionPlanResponseSchema,
)
def submit_observation(
    mission_id: str,
    payload: ObservationRequestSchema,
    objectives: ObjectiveDep,
    missions: MissionDep,
) -> MissionPlanResponseSchema:
    stored = _current_mission(missions, mission_id, payload.mission_version)
    if stored.lifecycle_status is not MissionLifecycleStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Solo una misión activa admite observaciones.")
    if payload.objective_id != stored.snapshot.get("next_objective_id"):
        raise HTTPException(
            status_code=409,
            detail="Solo puede observarse el siguiente objetivo activo de la misión.",
        )
    objective = objectives.get_objective(stored.region_id, payload.objective_id)
    if objective is None or payload.objective_id not in stored.snapshot["objective_ids"]:
        raise HTTPException(
            status_code=400, detail="El objetivo no pertenece al catálogo de la misión."
        )
    try:
        decision = decide_observation(objective, payload.finding_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    completed = list(
        dict.fromkeys([*stored.snapshot.get("completed_objective_ids", []), payload.objective_id])
    )
    remaining = [item for item in stored.snapshot["objective_ids"] if item not in completed]
    message = (
        f"Hallazgo {payload.finding_code} registrado en {objective.title}. "
        f"{decision.reason} Siguiente destino: {remaining[0] if remaining else 'base'}."
    )
    decision_entry = {
        "event_type": "observation_recorded",
        "message": message,
        "evidence_ids": list(objective.evidence_ids),
        "simulated": True,
    }
    snapshot = {
        **stored.snapshot,
        "completed_objective_ids": completed,
        "next_objective_id": remaining[0] if remaining else None,
        "legs": _remaining_legs(stored.snapshot["legs"], completed),
        "resource_evaluation": {
            "status": "unknown",
            "reason_codes": ["RESOURCE_READING_REQUIRED_AFTER_OBSERVATION"],
            "warnings": [],
            "assumptions": [],
            "known_consumption_min": 0,
            "projected_consumption_min": None,
            "oxygen_remaining_min": None,
            "reserve_margin_min": None,
        },
        "alerts": list(
            dict.fromkeys(
                [
                    *stored.snapshot["alerts"],
                    "RESOURCE_READING_REQUIRED_AFTER_OBSERVATION",
                ]
            )
        ),
        "decision_log": [*stored.snapshot["decision_log"], decision_entry],
    }
    event_payload = {
        "objective_id": payload.objective_id,
        "finding_code": payload.finding_code,
        "notes": payload.notes,
        "action": decision.action.value,
        "reason": decision.reason,
        "evidence_ids": list(objective.evidence_ids),
    }
    updated = _update_mission(
        missions,
        mission_id,
        MissionUpdate(
            expected_version=payload.mission_version,
            lifecycle_status=stored.lifecycle_status,
            viability_status=StoredViabilityStatus.UNKNOWN,
            snapshot=snapshot,
            events=(MissionEventDraft(str(uuid4()), "observation_recorded", event_payload),),
        ),
    )
    return _mission_response(updated)


def _abort_mission(
    stored: StoredMission,
    payload: MissionStatusRequestSchema,
    terrain: TerrainRepository,
    objectives: ObjectiveRepository,
    missions: MissionRepository,
) -> MissionPlanResponseSchema:
    if stored.lifecycle_status not in {
        MissionLifecycleStatus.DRAFT,
        MissionLifecycleStatus.ACTIVE,
    }:
        raise HTTPException(status_code=409, detail="La misión ya está cerrada.")
    if payload.current_position is None or payload.resources is None or payload.constraints is None:
        raise HTTPException(
            status_code=400,
            detail="Abortar requiere posición actual, recursos y restricciones.",
        )
    reports = tuple(_hazard_from_data(item) for item in stored.snapshot.get("hazard_reports", []))
    request = MissionPlanningRequest(
        region_id=stored.region_id,
        base_position=_local_position(payload.current_position),
        return_position=_local_position_data(stored.snapshot["return_position"]),
        objective_ids=(),
        constraints=RoutePlanningConstraints(
            max_slope_deg=payload.constraints.max_slope_deg,
            speed_m_per_min=payload.constraints.speed_m_per_min,
            avoid_unknown=payload.constraints.avoid_unknown,
        ),
        resources=SupportResources(
            payload.resources.oxygen_available_min,
            payload.resources.return_reserve_min,
        ),
    )
    try:
        plan = MissionPlanner(terrain, objectives, reports).plan(request)
        draft = mission_create_from_plan(plan)
    except (ValueError, FrameMismatchError, InvalidRouteEndpointError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = {
        **draft.snapshot,
        "current_position": _position_schema_data(payload.current_position),
        "objective_ids": stored.snapshot["objective_ids"],
        "completed_objective_ids": stored.snapshot.get("completed_objective_ids", []),
        "hazard_reports": stored.snapshot.get("hazard_reports", []),
    }
    updated = _update_mission(
        missions,
        stored.mission_id,
        MissionUpdate(
            expected_version=payload.expected_version,
            lifecycle_status=MissionLifecycleStatus.ABORTED,
            viability_status=draft.viability_status,
            snapshot=snapshot,
            routes=draft.routes,
            events=(
                *draft.events,
                MissionEventDraft(
                    str(uuid4()),
                    "mission_aborted",
                    {"return_status": draft.viability_status.value},
                ),
            ),
        ),
    )
    return _mission_response(updated)


def _current_mission(
    missions: MissionRepository, mission_id: str, expected_version: int
) -> StoredMission:
    stored = missions.get(mission_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"Misión no encontrada: {mission_id!r}.")
    if stored.current_version != expected_version:
        raise HTTPException(status_code=409, detail="La misión fue actualizada por otro cliente.")
    return stored


def _update_mission(
    missions: MissionRepository, mission_id: str, change: MissionUpdate
) -> StoredMission:
    try:
        return missions.update(mission_id, change)
    except MissionVersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _mission_response(stored: StoredMission) -> MissionPlanResponseSchema:
    return MissionPlanResponseSchema.model_validate(
        {
            "mission_id": stored.mission_id,
            "mission_version": stored.current_version,
            "region_id": stored.region_id,
            "frame_id": stored.frame_id,
            "terrain_version": stored.terrain_version,
            "lifecycle_status": stored.lifecycle_status.value,
            "viability_status": stored.viability_status.value,
            **stored.snapshot,
        }
    )


def _route_response(result: RouteComputation) -> RouteResultSchema:
    route = result.route
    return RouteResultSchema(
        route_id=result.route_id,
        region_id=result.region_id,
        frame_id=result.frame_id,
        terrain_version=result.terrain_version,
        path=(
            [
                {
                    "x_m": point.x_m,
                    "y_m": point.y_m,
                    "z_m": point.z_m,
                    "frame_id": point.frame_id,
                }
                for point in route.path
            ]
            if route is not None
            else []
        ),
        distance_m=route.distance_m if route is not None else None,
        duration_min=route.duration_min if route is not None else None,
        ascent_m=route.ascent_m if route is not None else None,
        max_slope_deg=route.max_slope_deg if route is not None else None,
        status=result.status.value,
        unknown_segments=result.unknown_segments,
        warnings=list(result.warnings),
        evidence_ids=list(result.evidence_ids),
        assumptions=list(result.assumptions),
    )


def _local_position(position) -> LocalPosition:
    return LocalPosition(position.x_m, position.y_m, position.frame_id)


def _local_position_data(position: dict) -> LocalPosition:
    return LocalPosition(position["x_m"], position["y_m"], position["frame_id"])


def _position_data(position: LocalPosition) -> dict:
    return {"x_m": position.x_m, "y_m": position.y_m, "frame_id": position.frame_id}


def _position_schema_data(position) -> dict:
    return {"x_m": position.x_m, "y_m": position.y_m, "frame_id": position.frame_id}


def _remaining_legs(legs: list[dict], completed_objective_ids: list[str]) -> list[dict]:
    completed = set(completed_objective_ids)
    return [leg for leg in legs if leg["end_label"] not in completed]


def _hazard_from_data(data: dict) -> EnvironmentalHazardReport:
    return EnvironmentalHazardReport(
        report_id=data["report_id"],
        mission_version=data["mission_version"],
        position=_local_position_data(data["position"]),
        hazard_code=data["hazard_code"],
        effect=HazardEffect(data["effect"]),
        affected_radius_m=data["affected_radius_m"],
        cost_multiplier=data["cost_multiplier"],
    )


def _routing_constraints_from_data(data: dict) -> RoutePlanningConstraints:
    return RoutePlanningConstraints(
        max_slope_deg=data["max_slope_deg"],
        speed_m_per_min=data["speed_m_per_min"],
        avoid_unknown=data["avoid_unknown"],
    )


def _manifest_asset_urls(manifest: RegionManifestResponse) -> list[str]:
    terrain = manifest.terrain
    urls = [
        terrain.heightmap_url,
        terrain.texture_url,
        terrain.blocked_mask_url,
        *(layer.asset_url for layer in manifest.layers),
    ]
    return list(dict.fromkeys(url for url in urls if url is not None))
