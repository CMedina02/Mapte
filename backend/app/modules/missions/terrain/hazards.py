"""Mission hazard reports layered over the immutable catalog terrain."""

from collections import OrderedDict
from dataclasses import dataclass
from enum import StrEnum
from math import floor, isfinite

from app.modules.catalog.domain import DataQuality, TerrainRepository
from app.modules.missions.terrain.models import (
    FrameMismatchError,
    GridCell,
    LocalPosition,
    RoutingTerrainSample,
    TerrainDataStatus,
    TerrainRestriction,
    TraversalStatus,
    apply_restrictions,
)

_CELL_CACHE_LIMIT = 100_000


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
    """Routing view of one catalog terrain plus active astronaut reports."""

    def __init__(
        self,
        base: TerrainRepository,
        region_id: str,
        reports: tuple[EnvironmentalHazardReport, ...] = (),
    ) -> None:
        self._base = base
        self._region_id = region_id
        self._metadata = base.get_metadata(region_id)
        self._terrain = base.get_terrain(region_id)
        self._grid = self._terrain.grid
        # Route searches revisit the same cells many times. Cache the composed
        # terrain + quality + hazard sample for the lifetime of this request.
        self._sample_cache: OrderedDict[GridCell, RoutingTerrainSample] = OrderedDict()

        frame_id = self._metadata.sector.frame_id
        for report in reports:
            if report.position.frame_id != frame_id:
                raise FrameMismatchError(f"El reporte {report.report_id} no pertenece a {frame_id}")
            if not self._grid.contains_xy(report.position.x_m, report.position.y_m):
                raise ValueError(f"El reporte {report.report_id} está fuera de la región")
        self._reports = reports

    @property
    def region_id(self) -> str:
        return self._region_id

    @property
    def frame_id(self) -> str:
        return self._metadata.sector.frame_id

    @property
    def terrain_version(self) -> str:
        return self._metadata.consistency.terrain_version

    @property
    def version(self) -> str:
        report_ids = ",".join(report.report_id for report in self._reports) or "none"
        return f"{self.terrain_version}+reports:{report_ids}"

    @property
    def width(self) -> int:
        return self._grid.width_px

    @property
    def height(self) -> int:
        return self._grid.height_px

    @property
    def pixel_size_x_m(self) -> float:
        return self._grid.pixel_size_x_m

    @property
    def pixel_size_y_m(self) -> float:
        return self._grid.pixel_size_y_m

    def position_to_cell(self, position: LocalPosition) -> GridCell | None:
        if position.frame_id != self.frame_id:
            raise FrameMismatchError(
                f"Se esperaba frame_id={self.frame_id}, se recibió {position.frame_id}"
            )
        if not self._grid.contains_xy(position.x_m, position.y_m):
            return None

        bounds = self._grid.bounds_pixel_edges_m()
        column = floor((position.x_m - bounds.x_min_m) / self._grid.pixel_size_x_m)
        row = floor((bounds.y_max_m - position.y_m) / self._grid.pixel_size_y_m)
        return GridCell(
            row=min(max(row, 0), self.height - 1),
            column=min(max(column, 0), self.width - 1),
        )

    def cell_position(self, cell: GridCell) -> LocalPosition:
        x_m, y_m = self._grid.index_to_center_xy(cell.row, cell.column)
        return LocalPosition(x_m=x_m, y_m=y_m, frame_id=self.frame_id)

    def sample_cell(self, cell: GridCell) -> RoutingTerrainSample:
        cached = self._sample_cache.get(cell)
        if cached is not None:
            self._sample_cache.move_to_end(cell)
            return cached
        if not (0 <= cell.row < self._grid.height_px and 0 <= cell.column < self._grid.width_px):
            return RoutingTerrainSample(
                elevation_m=None,
                data_status=TerrainDataStatus.OUTSIDE,
                traversal_status=TraversalStatus.BLOCKED,
                restriction_codes=("TERRAIN:OUTSIDE",),
            )

        source = self._terrain.sample_at_index(cell.row, cell.column)
        if not source.is_valid:
            sample = RoutingTerrainSample(
                elevation_m=None,
                data_status=TerrainDataStatus.NODATA,
                traversal_status=TraversalStatus.BLOCKED,
                restriction_codes=("TERRAIN:NODATA",),
            )
        elif source.is_blocked:
            sample = RoutingTerrainSample(
                elevation_m=source.elevation_m,
                data_status=TerrainDataStatus.VALID,
                traversal_status=TraversalStatus.BLOCKED,
                restriction_codes=("TERRAIN:BLOCKED",),
            )
        elif self._metadata.quality_at(source.x_m, source.y_m) is DataQuality.UNKNOWN:
            sample = RoutingTerrainSample(
                elevation_m=source.elevation_m,
                data_status=TerrainDataStatus.VALID,
                traversal_status=TraversalStatus.UNKNOWN,
                restriction_codes=("TERRAIN:DATA_QUALITY_UNKNOWN",),
            )
        else:
            sample = RoutingTerrainSample(
                elevation_m=source.elevation_m,
                data_status=TerrainDataStatus.VALID,
                traversal_status=TraversalStatus.TRAVERSABLE,
            )

        restrictions = tuple(
            self._restriction_for(report)
            for report in self._reports
            if self._report_affects_cell(report, cell)
        )
        result = apply_restrictions(sample, restrictions)
        if len(self._sample_cache) >= _CELL_CACHE_LIMIT:
            self._sample_cache.popitem(last=False)
        self._sample_cache[cell] = result
        return result

    @staticmethod
    def _restriction_for(report: EnvironmentalHazardReport) -> TerrainRestriction:
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
        center_x, center_y = self._grid.index_to_center_xy(cell.row, cell.column)
        half_width = self._grid.pixel_size_x_m / 2
        half_height = self._grid.pixel_size_y_m / 2
        min_x, max_x = center_x - half_width, center_x + half_width
        min_y, max_y = center_y - half_height, center_y + half_height

        delta_x = max(min_x - report.position.x_m, 0.0, report.position.x_m - max_x)
        delta_y = max(min_y - report.position.y_m, 0.0, report.position.y_m - max_y)
        return delta_x * delta_x + delta_y * delta_y <= report.affected_radius_m**2
