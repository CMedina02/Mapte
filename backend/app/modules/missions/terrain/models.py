"""Mission routing models layered over the shared catalog terrain contract."""

from dataclasses import dataclass
from enum import StrEnum
from math import isfinite


class FrameMismatchError(ValueError):
    """Raised when a local position uses a different coordinate frame."""


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
class RoutingTerrainSample:
    """Terrain interpretation consumed by the mission route planner."""

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
    sample: RoutingTerrainSample, restrictions: tuple[TerrainRestriction, ...]
) -> RoutingTerrainSample:
    """Combine restrictions conservatively: blocked dominates unknown."""

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
    return RoutingTerrainSample(
        elevation_m=sample.elevation_m,
        data_status=sample.data_status,
        traversal_status=traversal_status,
        cost_multiplier=max(
            sample.cost_multiplier,
            *(item.cost_multiplier for item in restrictions),
        ),
        restriction_codes=codes,
    )
