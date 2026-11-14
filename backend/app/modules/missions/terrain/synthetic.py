"""Proveedor pequeño y determinista para desarrollar sin depender del DEM real."""

from collections.abc import Mapping, Sequence
from math import isfinite

from app.modules.missions.terrain.models import (
    GridCell,
    GridGeometry,
    TerrainDataStatus,
    TerrainRestriction,
    TerrainSample,
    TraversalStatus,
    apply_restrictions,
)


class SyntheticTerrainProvider:
    def __init__(
        self,
        *,
        geometry: GridGeometry,
        elevations_m: Sequence[Sequence[float | None]],
        version: str = "synthetic-v1",
        restrictions: Mapping[GridCell, Sequence[TerrainRestriction]] | None = None,
    ) -> None:
        if not version.strip():
            raise ValueError("La versión del terreno no puede estar vacía")
        if len(elevations_m) != geometry.height:
            raise ValueError("La cantidad de filas no coincide con geometry.height")

        rows: list[tuple[float | None, ...]] = []
        for row in elevations_m:
            if len(row) != geometry.width:
                raise ValueError("Todas las filas deben coincidir con geometry.width")
            normalized_row = tuple(row)
            if any(value is not None and not isfinite(value) for value in normalized_row):
                raise ValueError("Las elevaciones deben ser finitas o None para NoData")
            rows.append(normalized_row)

        normalized_restrictions: dict[GridCell, tuple[TerrainRestriction, ...]] = {}
        for cell, cell_restrictions in (restrictions or {}).items():
            if not geometry.contains_cell(cell):
                raise ValueError(f"Restricción fuera de la cuadrícula: {cell}")
            normalized_restrictions[cell] = tuple(cell_restrictions)

        self._geometry = geometry
        self._elevations_m = tuple(rows)
        self._version = version
        self._restrictions = normalized_restrictions

    @property
    def geometry(self) -> GridGeometry:
        return self._geometry

    @property
    def version(self) -> str:
        return self._version

    def sample_cell(self, cell: GridCell) -> TerrainSample:
        if not self.geometry.contains_cell(cell):
            return TerrainSample(
                elevation_m=None,
                data_status=TerrainDataStatus.OUTSIDE,
                traversal_status=TraversalStatus.UNKNOWN,
            )

        elevation_m = self._elevations_m[cell.row][cell.column]
        if elevation_m is None:
            sample = TerrainSample(
                elevation_m=None,
                data_status=TerrainDataStatus.NODATA,
                traversal_status=TraversalStatus.UNKNOWN,
            )
        else:
            sample = TerrainSample(
                elevation_m=elevation_m,
                data_status=TerrainDataStatus.VALID,
                traversal_status=TraversalStatus.TRAVERSABLE,
            )

        return apply_restrictions(sample, self._restrictions.get(cell, ()))
