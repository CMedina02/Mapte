"""Punto de integración compartido, coordinado por Backend 2."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.core.errors import register_error_handlers


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    api_version: str


def create_app() -> FastAPI:
    application = FastAPI(title="Mapte API", version="0.1.0")
    register_error_handlers(application)

    @application.get("/api/v1/health", response_model=HealthResponse, tags=["System"])
    async def health() -> HealthResponse:
        # Confirma disponibilidad HTTP; no certifica datos ni motores científicos.
        return HealthResponse(status="ok", api_version="v1")

    # Registrar aquí los routers de catalog y missions cuando se implementen.
    # application.include_router(catalog_router, prefix="/api/v1")
    # application.include_router(missions_router, prefix="/api/v1")
    return application


app = create_app()
