"""Límite interno entre el motor de rutas y cualquier fuente de terreno."""

from typing import Protocol

from app.modules.missions.terrain.models import GridCell, GridGeometry, TerrainSample


class TerrainProvider(Protocol):
    @property
    def geometry(self) -> GridGeometry: ...

    @property
    def version(self) -> str: ...

    def sample_cell(self, cell: GridCell) -> TerrainSample: ...
