"""Punto de integración compartido, coordinado por Backend 2."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.core.errors import register_error_handlers
from app.modules.catalog.api.router import catalog_router
from app.modules.catalog.infrastructure.science_loader import load_science_catalog
from app.modules.catalog.infrastructure.terrain_loader import CatalogStore, load_catalog
from app.modules.missions.api import missions_router, simulation_router
from app.modules.missions.persistence import MissionRepository, SQLiteMissionRepository
from app.modules.missions.planning import (
    InMemoryObjectiveRepository,
    ObjectiveRepository,
    objective_repository_from_catalogs,
)
from app.modules.missions.routing.coarse import coarse_grid
from app.modules.missions.terrain import MissionHazardOverlay

DATA_ROOT_ENV = "MAPTE_DATA_ROOT"
ACTIVE_REGION_ENV = "MAPTE_ACTIVE_REGION"
DATABASE_PATH_ENV = "MAPTE_DB_PATH"


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    api_version: str


def _default_data_root() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "regions"


def _active_region(data_root: Path) -> str:
    configured = os.environ.get(ACTIVE_REGION_ENV, "").strip()
    if configured:
        return configured

    available = sorted(
        path.name
        for path in data_root.iterdir()
        if path.is_dir() and (path / "derived" / "terrain.json").is_file()
    )
    if len(available) == 1:
        return available[0]
    raise RuntimeError(f"Defina {ACTIVE_REGION_ENV}; regiones detectadas: {available or 'ninguna'}")


def _load_configured_catalog() -> CatalogStore:
    data_root = Path(os.environ.get(DATA_ROOT_ENV, _default_data_root())).resolve()
    return load_catalog(data_root, [_active_region(data_root)])


def _mission_database_path() -> Path:
    default = Path(__file__).resolve().parents[1] / "data" / "runtime" / "mapte.sqlite3"
    return Path(os.environ.get(DATABASE_PATH_ENV, default)).resolve()


def create_app(
    catalog_store: CatalogStore | None = None,
    objective_repository: ObjectiveRepository | None = None,
    mission_repository: MissionRepository | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        store = catalog_store or _load_configured_catalog()
        application.state.catalog_store = store
        application.state.terrain_repository = store.terrain_repository
        if catalog_store is None:
            # Rejillas del buscador (4 m y 20 m): se precalculan al arrancar (~1.7 s/región),
            # no en la primera ruta que pida un usuario
            for region_id in store.region_ids():
                coarse_grid(
                    MissionHazardOverlay(store.terrain_repository, region_id).routing_grid()
                )
        loaded_objectives = objective_repository
        if loaded_objectives is None and catalog_store is None:
            science_catalogs = [
                catalog
                for region_id in store.region_ids()
                if (catalog := load_science_catalog(region_id)) is not None
            ]
            for catalog in science_catalogs:
                region = store.get(catalog.region_id)
                if region is not None:
                    catalog.check_within_extent(region.metadata)
            loaded_objectives = objective_repository_from_catalogs(science_catalogs)
        application.state.objective_repository = loaded_objectives or InMemoryObjectiveRepository(
            ()
        )
        application.state.mission_repository = mission_repository or SQLiteMissionRepository(
            _mission_database_path()
        )
        yield

    application = FastAPI(title="Mapte API", version="0.1.0", lifespan=lifespan)
    register_error_handlers(application)

    @application.get("/api/v1/health", response_model=HealthResponse, tags=["System"])
    async def health() -> HealthResponse:
        # Confirma disponibilidad HTTP; no certifica datos ni motores científicos.
        return HealthResponse(status="ok", api_version="v1")

    application.include_router(catalog_router, prefix="/api/v1")
    application.include_router(missions_router, prefix="/api/v1")
    application.include_router(simulation_router, prefix="/api/v1")
    return application


app = create_app()
