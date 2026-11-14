"""Restricciones de misión superpuestas sin modificar el terreno científico base."""

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite

from app.modules.missions.terrain.models import (
    FrameMismatchError,
    GridCell,
    GridGeometry,
    LocalPosition,
    TerrainRestriction,
    TerrainSample,
    TraversalStatus,
    apply_restrictions,
)
from app.modules.missions.terrain.provider import TerrainProvider


class HazardEffect(StrEnum):
    BLOCKED = "blocked"
    UNKNOWN = "unknown"
    HIGH_COST = "high_cost"


@dataclass(frozen=True, slots=True)
class EnvironmentalHazardReport:
    report_id: str
    mission_version: int
    position: LocalPosition
    hazard_code: str
    effect: HazardEffect
    affected_radius_m: float
    cost_multiplier: float = 1.0

    def __post_init__(self) -> None:
        if not self.report_id.strip() or not self.hazard_code.strip():
            raise ValueError("report_id y hazard_code no pueden estar vacíos")
        if self.mission_version < 1:
            raise ValueError("mission_version debe ser mayor o igual que 1")
        if not isfinite(self.affected_radius_m) or self.affected_radius_m < 0:
            raise ValueError("affected_radius_m debe ser finito y no negativo")
        if not isfinite(self.cost_multiplier) or self.cost_multiplier < 1:
            raise ValueError("cost_multiplier debe ser finito y mayor o igual que 1")
        if self.effect is HazardEffect.HIGH_COST and self.cost_multiplier == 1:
            raise ValueError("HIGH_COST requiere cost_multiplier mayor que 1")


class MissionHazardOverlay:
    """Vista conservadora de un terreno base con reportes de una misión."""

    def __init__(
        self, base: TerrainProvider, reports: tuple[EnvironmentalHazardReport, ...]
    ) -> None:
        for report in reports:
            if report.position.frame_id != base.geometry.frame_id:
                raise FrameMismatchError(
                    f"El reporte {report.report_id} no pertenece a {base.geometry.frame_id}"
                )
            if base.geometry.world_to_cell(report.position) is None:
                raise ValueError(f"El reporte {report.report_id} está fuera de la región")
        self._base = base
        self._reports = reports

    @property
    def geometry(self) -> GridGeometry:
        return self._base.geometry

    @property
    def version(self) -> str:
        report_ids = ",".join(report.report_id for report in self._reports) or "none"
        return f"{self._base.version}+reports:{report_ids}"

    def sample_cell(self, cell: GridCell) -> TerrainSample:
        sample = self._base.sample_cell(cell)
        if not self.geometry.contains_cell(cell):
            return sample

        restrictions = tuple(
            self._restriction_for(report)
            for report in self._reports
            if self._report_affects_cell(report, cell)
        )
        return apply_restrictions(sample, restrictions)

    def _restriction_for(self, report: EnvironmentalHazardReport) -> TerrainRestriction:
        if report.effect is HazardEffect.BLOCKED:
            traversal_status = TraversalStatus.BLOCKED
        elif report.effect is HazardEffect.UNKNOWN:
            traversal_status = TraversalStatus.UNKNOWN
        else:
            traversal_status = TraversalStatus.TRAVERSABLE

        return TerrainRestriction(
            code=f"ASTRONAUT_REPORT:{report.hazard_code}:{report.report_id}",
            traversal_status=traversal_status,
            cost_multiplier=report.cost_multiplier,
        )

    def _report_affects_cell(self, report: EnvironmentalHazardReport, cell: GridCell) -> bool:
        size = self.geometry.cell_size_m
        min_x = self.geometry.upper_left_x_m + cell.column * size
        max_x = min_x + size
        max_y = self.geometry.upper_left_y_m - cell.row * size
        min_y = max_y - size

        delta_x = max(min_x - report.position.x_m, 0.0, report.position.x_m - max_x)
        delta_y = max(min_y - report.position.y_m, 0.0, report.position.y_m - max_y)
        return delta_x * delta_x + delta_y * delta_y <= report.affected_radius_m**2
