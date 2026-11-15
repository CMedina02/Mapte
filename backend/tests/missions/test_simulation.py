from dataclasses import replace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import register_error_handlers
from app.modules.catalog.domain import (
    InMemoryTerrainRepository,
    TerrainDataset,
    TerrainGridData,
    VerticalReferenceSpec,
    build_synthetic_terrain,
)
from app.modules.missions.api import missions_router, simulation_router
from app.modules.missions.routing import RoutePlanningConstraints
from app.modules.missions.simulation import (
    REROUTE_DEVIATION_M,
    WARN_DEVIATION_M,
    DeviationPlan,
    EvaSimulation,
    SimulationAction,
    SimulationRouteError,
    SimulationStatus,
)
from app.modules.missions.terrain import LocalPosition

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"
SIZE = 60  # celdas
PIXEL_M = 5.0  # 300 × 300 m


def flat_terrain(blocked=lambda row, column: False) -> InMemoryTerrainRepository:
    dataset = build_synthetic_terrain(
        region_id=REGION_ID,
        frame_id=FRAME_ID,
        width_px=SIZE,
        height_px=SIZE,
        pixel_size_m=PIXEL_M,
        terrain_version="sim-test-v1",
    )
    metadata = replace(
        dataset.metadata,
        vertical=VerticalReferenceSpec(
            vertical_datum="test", elevation_min_m=-5000, elevation_max_m=0
        ),
        quality_zones=(),
    )
    grid = TerrainGridData(
        metadata=metadata,
        elevations_m=[-3500.0] * (SIZE * SIZE),
        blocked_mask=[blocked(r, c) for r in range(SIZE) for c in range(SIZE)],
    )
    return InMemoryTerrainRepository((TerrainDataset(metadata, grid),))


def simulation(terrain=None, deviation=DeviationPlan(), speed_factor=1.0) -> EvaSimulation:
    return EvaSimulation(
        sim_id="sim-test",
        terrain_repository=terrain or flat_terrain(),
        region_id=REGION_ID,
        start=LocalPosition(20, 150, FRAME_ID),
        end=LocalPosition(280, 150, FRAME_ID),
        constraints=RoutePlanningConstraints(speed_m_per_min=60),  # 1 m/s
        speed_factor=speed_factor,
        deviation=deviation,
    )


def run(sim: EvaSimulation, dt_s: float = 1.0, limit: int = 2000) -> list[SimulationAction]:
    actions = []
    for _ in range(limit):
        if sim.finished:
            break
        actions.append(sim.step(dt_s).action)
    return actions


def test_walk_without_deviation_follows_route_and_arrives():
    sim = simulation(deviation=None)
    total = sim.remaining_m

    outcome = sim.step(10)
    assert outcome.action is SimulationAction.NONE
    assert sim.progress_m == pytest.approx(10)
    assert sim.remaining_m == pytest.approx(total - 10)
    assert sim.on_route and sim.deviation_m < 1

    actions = run(sim)
    assert actions[-1] is SimulationAction.ARRIVED
    assert sim.status is SimulationStatus.ARRIVED
    assert sim.reroute_count == 0
    end = sim.route.route.path[-1]  # centro de la celda destino
    assert (sim.x_m, sim.y_m) == pytest.approx((end.x_m, end.y_m))


def test_speed_factor_scales_simulated_time_and_distance():
    sim = simulation(deviation=None, speed_factor=30)
    sim.step(1)
    assert sim.t_s == pytest.approx(30)
    assert sim.progress_m == pytest.approx(30)


def test_deviation_warns_then_reroutes_from_current_position():
    sim = simulation()
    actions = run(sim)
    events = [event.event_type for event in sim.log]

    assert events == [
        "route_planned",
        "deviation_started",
        "off_route_warning",
        "off_route",
        "rerouted",
        "arrived",
    ]
    assert SimulationAction.WARN in actions
    assert SimulationAction.REROUTED in actions
    assert sim.reroute_count == 1 and sim.route_version == 2
    assert sim.route.route_id != sim.original_route_id

    warned = next(e for e in sim.log if e.event_type == "off_route_warning")
    rerouted = next(e for e in sim.log if e.event_type == "rerouted")
    assert warned.y_m > 150  # izquierda de una ruta hacia el este = norte
    assert rerouted.y_m - 150 == pytest.approx(REROUTE_DEVIATION_M, abs=PIXEL_M)


def test_while_drifting_remaining_distance_is_unknown_and_warning_persists():
    sim = simulation()
    while sim.status is not SimulationStatus.DRIFTING:
        sim.step(1)
    assert sim.remaining_m is None and sim.eta_min is None
    while sim.deviation_m < WARN_DEVIATION_M:
        sim.step(1)
    assert sim.step(1).action is SimulationAction.WARN
    assert not sim.on_route


def test_blocked_terrain_ahead_triggers_reroute_before_warning():
    # Todo lo que está al norte de y = 170 m queda bloqueado.
    blocked = flat_terrain(blocked=lambda row, column: row < (SIZE * PIXEL_M - 170) / PIXEL_M)
    sim = simulation(terrain=blocked)
    run(sim)
    events = [event.event_type for event in sim.log]

    assert "hazard_ahead" in events
    assert "off_route_warning" not in events
    assert events[-1] == "arrived"
    assert sim.reroute_count == 1


def test_initial_route_must_be_viable():
    wall = flat_terrain(blocked=lambda row, column: column == SIZE // 2)
    with pytest.raises(SimulationRouteError):
        simulation(terrain=wall)


def test_finished_simulation_does_not_move():
    sim = simulation(deviation=None)
    run(sim)
    x, y = sim.x_m, sim.y_m
    assert sim.step(5).action is SimulationAction.NONE
    assert (sim.x_m, sim.y_m) == (x, y)


# --- HTTP ---------------------------------------------------------------------


def client(terrain=None) -> TestClient:
    application = FastAPI()
    register_error_handlers(application)
    application.state.terrain_repository = terrain or flat_terrain()
    application.include_router(missions_router, prefix="/api/v1")
    application.include_router(simulation_router, prefix="/api/v1")
    return TestClient(application)


def body(**extra) -> dict:
    return {
        "start": {"x_m": 20, "y_m": 150, "frame_id": FRAME_ID},
        "end": {"x_m": 280, "y_m": 150, "frame_id": FRAME_ID},
        "constraints": {"max_slope_deg": 15, "speed_m_per_min": 60, "avoid_unknown": True},
        "speed_factor": 1,
        **extra,
    }


def test_http_create_step_get_and_delete():
    api = client()
    created = api.post("/api/v1/sim", json=body())
    assert created.status_code == 201
    state = created.json()
    assert state["simulated"] is True
    assert state["status"] == "following"
    assert state["thresholds"] == {"warn_m": WARN_DEVIATION_M, "reroute_m": REROUTE_DEVIATION_M}
    assert state["route"]["status"] == "viable"

    sim_id = state["sim_id"]
    seen = set()
    for _ in range(1000):
        state = api.post(f"/api/v1/sim/{sim_id}/step", json={"dt_s": 5}).json()
        seen.add(state["action"])
        if state["status"] == "arrived":
            break
    assert {"warn", "rerouted", "arrived"} <= seen
    assert state["reroute_count"] == 1

    assert api.get(f"/api/v1/sim/{sim_id}").json()["status"] == "arrived"
    assert api.delete(f"/api/v1/sim/{sim_id}").status_code == 204
    assert api.get(f"/api/v1/sim/{sim_id}").status_code == 404


def test_http_step_without_body_uses_one_second():
    api = client()
    sim_id = api.post("/api/v1/sim", json=body(deviation=None)).json()["sim_id"]
    state = api.post(f"/api/v1/sim/{sim_id}/step").json()
    assert state["t_s"] == 1.0
    assert state["progress_m"] == pytest.approx(1.0)


def test_http_rejects_invalid_requests():
    api = client()
    outside = body(start={"x_m": 9000, "y_m": 9000, "frame_id": FRAME_ID})
    assert api.post("/api/v1/sim", json=outside).status_code == 400
    wrong_frame = body(start={"x_m": 20, "y_m": 150, "frame_id": "OTHER"})
    assert api.post("/api/v1/sim", json=wrong_frame).status_code == 400
    assert api.post("/api/v1/sim", json=body(speed_factor=0)).status_code == 422
    assert api.post("/api/v1/sim/missing/step").status_code == 404

    walled = client(flat_terrain(blocked=lambda row, column: column == SIZE // 2))
    assert walled.post("/api/v1/sim", json=body()).status_code == 422
