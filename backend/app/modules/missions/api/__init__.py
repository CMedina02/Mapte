"""Public HTTP API for the missions module."""

from app.modules.missions.api.router import missions_router

__all__ = ["missions_router"]
