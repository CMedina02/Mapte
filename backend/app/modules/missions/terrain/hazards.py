"""Mission hazard reports layered over the immutable catalog terrain."""

import json
from array import array
from collections import OrderedDict
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from math import ceil, floor, inf, isfinite
from pathlib import Path

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

# Estado de cada celda en la rejilla de búsqueda (mismo orden que la combinación conservadora de
# apply_restrictions: bloqueado domina a desconocido, que domina a transitable)
GRID_TRAVERSABLE = 0
GRID_UNKNOWN = 1
GRID_BLOCKED = 2


@dataclass(frozen=True, slots=True)
class RoutingGrid:
    """Terreno + calidad + zonas del catálogo + reportes, precalculado por celda para el A*.

    Índice plano = fila * width + columna. Misma regla que sample_cell, sin crear objetos.
    """

    width: int
    height: int
    elevations: array  # 'f'; NaN/inf = sin dato
    status: bytearray  # GRID_TRAVERSABLE | GRID_UNKNOWN | GRID_BLOCKED
    multipliers: array  # 'f'; multiplicador de costo (>= 1)


# Rejilla base por terreno (sin reportes del astronauta): se construye una vez por proceso y región.
# Se guarda también el objeto terreno para que su id() no se reutilice mientras esté en caché, y la
# caché de rutas calculadas sobre ese terreno (se descarta junto con la rejilla).
_BASE_GRIDS: dict[tuple[int, str, str], tuple[object, RoutingGrid, OrderedDict]] = {}
_BASE_GRID_LIMIT = 4
_CATALOG_DATA = Path(__file__).resolve().parents[2] / "catalog" / "data"


@dataclass(frozen=True, slots=True)
class StaticHazardZone:
    """Catalog hazard polygon: exclusion blocks the cell, caution raises its cost."""

    hazard_id: str
    kind: str  # "exclusion" | "caution"
    risk_factor: str
    polygon: tuple[tuple[float, float], ...]
    cost_multiplier: float = 1.0

    def contains(self, x: float, y: float) -> bool:
        inside = False
        points = self.polygon
        j = len(points) - 1
        for i, (xi, yi) in enumerate(points):
            xj, yj = points[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        xs = [p[0] for p in self.polygon]
        ys = [p[1] for p in self.polygon]
        return min(xs), min(ys), max(xs), max(ys)


@lru_cache(maxsize=16)
def load_static_hazards(region_id: str) -> tuple[StaticHazardZone, ...]:
    """Hazard zones published with the region catalog (empty if the region has none)."""
    # ponytail: lee el JSON del catálogo directamente; usar el repositorio si se versiona aparte
    path = _CATALOG_DATA / region_id / "hazards.json"
    if not path.exists():
        return ()
    data = json.loads(path.read_text(encoding="utf-8"))
    zones = []
    for item in data["hazards"]:
        if item["kind"] not in ("exclusion", "caution"):
            raise ValueError(f"{item['hazard_id']}: kind desconocido {item['kind']!r}")
        zones.append(
            StaticHazardZone(
                hazard_id=item["hazard_id"],
                kind=item["kind"],
                risk_factor=item["risk_factor"],
                polygon=tuple((float(x), float(y)) for x, y in item["polygon"]),
                cost_multiplier=float(item.get("cost_multiplier", 1.0)),
            )
        )
    return tuple(zones)


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
        self._static_zones = tuple((zone, zone.bbox) for zone in load_static_hazards(region_id))

    @property
    def has_static_hazards(self) -> bool:
        return bool(self._static_zones)

    def routing_grid(self) -> RoutingGrid:
        """Rejilla precalculada para el buscador (base en caché + reportes de esta misión)."""
        grid = getattr(self, "_routing_grid", None)
        if grid is None:
            grid = self._base_grid()
            if self._reports:
                grid = self._apply_reports(grid)
            self._routing_grid = grid
        return grid

    def _cells_in_box(self, x0: float, y0: float, x1: float, y1: float):
        """Celdas cuyo centro puede caer en el rectángulo (con una celda de margen)."""
        g = self._grid
        c0 = max(floor((x0 - g.origin_center_x_m) / g.pixel_size_x_m) - 1, 0)
        c1 = min(ceil((x1 - g.origin_center_x_m) / g.pixel_size_x_m) + 1, g.width_px - 1)
        r0 = max(floor((g.origin_center_y_m - y1) / g.pixel_size_y_m) - 1, 0)
        r1 = min(ceil((g.origin_center_y_m - y0) / g.pixel_size_y_m) + 1, g.height_px - 1)
        for row in range(r0, r1 + 1):
            y = g.origin_center_y_m - row * g.pixel_size_y_m
            for col in range(c0, c1 + 1):
                yield row, col, g.origin_center_x_m + col * g.pixel_size_x_m, y

    def _base_grid(self) -> RoutingGrid:
        key = (id(self._terrain), self._region_id, self.terrain_version)
        cached = _BASE_GRIDS.get(key)
        if cached is not None:
            return cached[1]
        return self._build_base_grid(key)

    def route_cache(self) -> OrderedDict:
        """Rutas ya calculadas sobre este terreno (la clave debe incluir self.version)."""
        self._base_grid()
        return _BASE_GRIDS[(id(self._terrain), self._region_id, self.terrain_version)][2]

    def _build_base_grid(self, key: tuple[int, str, str]) -> RoutingGrid:

        g = self._grid
        width, height = g.width_px, g.height_px
        n = width * height
        terrain = self._terrain
        elevations = terrain.elevations_m
        if not isinstance(elevations, array) or elevations.typecode != "f":
            elevations = array("f", elevations)

        # Sin dato o bloqueado en el catálogo → bloqueado (igual que sample_cell: NODATA / BLOCKED)
        status = bytearray(n)
        if (
            getattr(terrain, "_explicit_valid", None) is None
            and getattr(terrain, "_blocked", None) is None
        ):
            for i, value in enumerate(elevations):
                if not -inf < value < inf:
                    status[i] = GRID_BLOCKED
        else:
            for i in range(n):
                if terrain.is_blocked_at(i):
                    status[i] = GRID_BLOCKED

        # Calidad desconocida (el centro de la celda dentro de la zona)
        for zone in self._metadata.quality_zones:
            if zone.quality is not DataQuality.UNKNOWN:
                continue
            e = zone.extent_m
            for row, col, x, y in self._cells_in_box(e.x_min_m, e.y_min_m, e.x_max_m, e.y_max_m):
                i = row * width + col
                if status[i] == GRID_TRAVERSABLE and e.contains(x, y):
                    status[i] = GRID_UNKNOWN

        # Zonas del catálogo: exclusión bloquea; precaución sube el costo
        multipliers = array("f", [1.0]) * n
        for zone, (x0, y0, x1, y1) in self._static_zones:
            for row, col, x, y in self._cells_in_box(x0, y0, x1, y1):
                if not (x0 <= x <= x1 and y0 <= y <= y1) or not zone.contains(x, y):
                    continue
                i = row * width + col
                if zone.kind == "exclusion":
                    status[i] = GRID_BLOCKED
                elif zone.cost_multiplier > multipliers[i]:
                    multipliers[i] = zone.cost_multiplier

        grid = RoutingGrid(width, height, elevations, status, multipliers)
        if len(_BASE_GRIDS) >= _BASE_GRID_LIMIT:
            _BASE_GRIDS.pop(next(iter(_BASE_GRIDS)))
        _BASE_GRIDS[key] = (terrain, grid, OrderedDict())
        return grid

    def _apply_reports(self, base: RoutingGrid) -> RoutingGrid:
        status = bytearray(base.status)
        multipliers = array("f", base.multipliers)
        width = base.width
        for report in self._reports:
            r = report.affected_radius_m
            px, py = report.position.x_m, report.position.y_m
            for row, col, _x, _y in self._cells_in_box(px - r, py - r, px + r, py + r):
                if not self._report_affects_cell(report, GridCell(row, col)):
                    continue
                i = row * width + col
                if report.effect is HazardEffect.BLOCKED:
                    status[i] = GRID_BLOCKED
                elif report.effect is HazardEffect.UNKNOWN:
                    status[i] = max(status[i], GRID_UNKNOWN)
                if report.cost_multiplier > multipliers[i]:
                    multipliers[i] = report.cost_multiplier
        return RoutingGrid(base.width, base.height, base.elevations, status, multipliers)

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
        ) + self._static_restrictions(cell)
        result = apply_restrictions(sample, restrictions)
        if len(self._sample_cache) >= _CELL_CACHE_LIMIT:
            self._sample_cache.popitem(last=False)
        self._sample_cache[cell] = result
        return result

    def _static_restrictions(self, cell: GridCell) -> tuple[TerrainRestriction, ...]:
        if not self._static_zones:
            return ()
        x, y = self._grid.index_to_center_xy(cell.row, cell.column)
        restrictions = []
        for zone, (x0, y0, x1, y1) in self._static_zones:
            if not (x0 <= x <= x1 and y0 <= y <= y1) or not zone.contains(x, y):
                continue
            if zone.kind == "exclusion":
                restrictions.append(
                    TerrainRestriction(f"STATIC_HAZARD:{zone.hazard_id}", TraversalStatus.BLOCKED)
                )
            else:
                restrictions.append(
                    TerrainRestriction(
                        f"STATIC_HAZARD:{zone.hazard_id}",
                        TraversalStatus.TRAVERSABLE,
                        cost_multiplier=max(zone.cost_multiplier, 1.0),
                    )
                )
        return tuple(restrictions)

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
