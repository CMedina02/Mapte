"""Modelos de dominio para terreno marciano en una cuadrícula local."""

from dataclasses import dataclass
from enum import StrEnum
from math import floor, isfinite


class FrameMismatchError(ValueError):
    """La posición recibida pertenece a otro marco de coordenadas."""


class TerrainDataStatus(StrEnum):
    VALID = "valid"
    NODATA = "nodata"
    OUTSIDE = "outside"


class TraversalStatus(StrEnum):
    TRAVERSABLE = "traversable"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class LocalPosition:
    x_m: float
    y_m: float
    frame_id: str

    def __post_init__(self) -> None:
        if not isfinite(self.x_m) or not isfinite(self.y_m):
            raise ValueError("Las coordenadas locales deben ser finitas")
        if not self.frame_id.strip():
            raise ValueError("frame_id no puede estar vacío")


@dataclass(frozen=True, slots=True)
class GridCell:
    row: int
    column: int


@dataclass(frozen=True, slots=True)
class GridGeometry:
    """Geometría norte-arriba; el origen es la esquina exterior superior izquierda."""

    frame_id: str
    width: int
    height: int
    cell_size_m: float
    upper_left_x_m: float
    upper_left_y_m: float

    def __post_init__(self) -> None:
        if not self.frame_id.strip():
            raise ValueError("frame_id no puede estar vacío")
        if self.width <= 0 or self.height <= 0:
            raise ValueError("width y height deben ser positivos")
        if not isfinite(self.cell_size_m) or self.cell_size_m <= 0:
            raise ValueError("cell_size_m debe ser un número positivo y finito")
        if not isfinite(self.upper_left_x_m) or not isfinite(self.upper_left_y_m):
            raise ValueError("El origen de la cuadrícula debe ser finito")

    @property
    def min_x_m(self) -> float:
        return self.upper_left_x_m

    @property
    def max_x_m(self) -> float:
        return self.upper_left_x_m + self.width * self.cell_size_m

    @property
    def max_y_m(self) -> float:
        return self.upper_left_y_m

    @property
    def min_y_m(self) -> float:
        return self.upper_left_y_m - self.height * self.cell_size_m

    def contains_cell(self, cell: GridCell) -> bool:
        return 0 <= cell.row < self.height and 0 <= cell.column < self.width

    def world_to_cell(self, position: LocalPosition) -> GridCell | None:
        if position.frame_id != self.frame_id:
            raise FrameMismatchError(
                f"Se esperaba frame_id={self.frame_id}, se recibió {position.frame_id}"
            )

        inside = (
            self.min_x_m <= position.x_m < self.max_x_m
            and self.min_y_m < position.y_m <= self.max_y_m
        )
        if not inside:
            return None

        column = floor((position.x_m - self.upper_left_x_m) / self.cell_size_m)
        row = floor((self.upper_left_y_m - position.y_m) / self.cell_size_m)
        cell = GridCell(row=row, column=column)
        return cell if self.contains_cell(cell) else None

    def cell_center(self, cell: GridCell) -> LocalPosition:
        if not self.contains_cell(cell):
            raise ValueError(f"Celda fuera de la cuadrícula: {cell}")

        return LocalPosition(
            x_m=self.upper_left_x_m + (cell.column + 0.5) * self.cell_size_m,
            y_m=self.upper_left_y_m - (cell.row + 0.5) * self.cell_size_m,
            frame_id=self.frame_id,
        )


@dataclass(frozen=True, slots=True)
class TerrainRestriction:
    code: str
    traversal_status: TraversalStatus
    cost_multiplier: float = 1.0

    def __post_init__(self) -> None:
        if not self.code.strip():
            raise ValueError("El código de restricción no puede estar vacío")
        if not isfinite(self.cost_multiplier) or self.cost_multiplier < 1:
            raise ValueError("cost_multiplier debe ser finito y mayor o igual que 1")


@dataclass(frozen=True, slots=True)
class TerrainSample:
    elevation_m: float | None
    data_status: TerrainDataStatus
    traversal_status: TraversalStatus
    cost_multiplier: float = 1.0
    restriction_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.data_status is TerrainDataStatus.VALID:
            if self.elevation_m is None or not isfinite(self.elevation_m):
                raise ValueError("Una muestra válida requiere una elevación finita")
        elif self.elevation_m is not None:
            raise ValueError("NoData y outside no pueden declarar elevación")

        if not isfinite(self.cost_multiplier) or self.cost_multiplier < 1:
            raise ValueError("cost_multiplier debe ser finito y mayor o igual que 1")
        if any(not code.strip() for code in self.restriction_codes):
            raise ValueError("Los códigos de restricción no pueden estar vacíos")


def apply_restrictions(
    sample: TerrainSample, restrictions: tuple[TerrainRestriction, ...]
) -> TerrainSample:
    """Combina restricciones de forma conservadora: blocked domina a unknown."""

    if not restrictions:
        return sample

    statuses = {sample.traversal_status, *(item.traversal_status for item in restrictions)}
    if TraversalStatus.BLOCKED in statuses:
        traversal_status = TraversalStatus.BLOCKED
    elif TraversalStatus.UNKNOWN in statuses:
        traversal_status = TraversalStatus.UNKNOWN
    else:
        traversal_status = TraversalStatus.TRAVERSABLE

    codes = tuple(dict.fromkeys((*sample.restriction_codes, *(item.code for item in restrictions))))
    return TerrainSample(
        elevation_m=sample.elevation_m,
        data_status=sample.data_status,
        traversal_status=traversal_status,
        cost_multiplier=max(
            sample.cost_multiplier,
            *(item.cost_multiplier for item in restrictions),
        ),
        restriction_codes=codes,
    )
