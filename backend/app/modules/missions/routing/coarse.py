"""Rejilla gruesa (bloques de COARSE_FACTOR × COARSE_FACTOR celdas) para trazar rutas largas rápido.

Solo guía la búsqueda fina: un bloque se considera usable si al menos USABLE_FRACTION de sus celdas
lo son. Las reglas exactas (pendiente, bloqueos, zonas) se aplican siempre en la rejilla fina.
"""

from array import array
from dataclasses import dataclass
from math import ceil, nan

from app.modules.missions.terrain.hazards import GRID_BLOCKED, GRID_TRAVERSABLE, RoutingGrid

COARSE_FACTOR = 5  # 4 m → 20 m
USABLE_FRACTION = 0.3  # Conserva bloques con pasos estrechos.

_TRAVERSABLE = bytes(1 if value == 0 else 0 for value in range(256))
_TRAVERSABLE_OR_UNKNOWN = bytes(1 if value <= 1 else 0 for value in range(256))


@dataclass(frozen=True, slots=True)
class CoarseGrid:
    factor: int
    strict: RoutingGrid  # para avoid_unknown: cuenta solo celdas transitables
    loose: RoutingGrid  # permitiendo terreno desconocido


# Mantiene una referencia a la rejilla fina para evitar reutilizar su id().
_CACHE: dict[int, tuple[RoutingGrid, CoarseGrid]] = {}
_CACHE_LIMIT = 8


def coarse_grid(fine: RoutingGrid) -> CoarseGrid:
    cached = _CACHE.get(id(fine))
    if cached is not None:
        return cached[1]
    coarse = _build(fine, COARSE_FACTOR)
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[id(fine)] = (fine, coarse)
    return coarse


def _build(fine: RoutingGrid, k: int) -> CoarseGrid:
    width, height = fine.width, fine.height
    cw, ch = ceil(width / k), ceil(height / k)
    n = cw * ch
    traversable = fine.status.translate(_TRAVERSABLE)
    usable = fine.status.translate(_TRAVERSABLE_OR_UNKNOWN)
    elevations = fine.elevations
    strict = bytearray([GRID_BLOCKED]) * n
    loose = bytearray([GRID_BLOCKED]) * n
    coarse_z = array("f", [nan]) * n

    for crow in range(ch):
        r0, r1 = crow * k, min(crow * k + k, height)
        for ccol in range(cw):
            c0, c1 = ccol * k, min(ccol * k + k, width)
            t = u = 0
            for row in range(r0, r1):
                a, b = row * width + c0, row * width + c1
                t += sum(traversable[a:b])
                u += sum(usable[a:b])
            if not u:
                continue
            need = (r1 - r0) * (c1 - c0) * USABLE_FRACTION
            index = crow * cw + ccol
            if t >= need:
                strict[index] = GRID_TRAVERSABLE
            if u >= need:
                loose[index] = GRID_TRAVERSABLE
            # Usa la elevación del centro o la primera celda utilizable.
            center = min(r0 + k // 2, r1 - 1) * width + min(c0 + k // 2, c1 - 1)
            if usable[center]:
                coarse_z[index] = elevations[center]
            else:
                coarse_z[index] = next(
                    elevations[row * width + col]
                    for row in range(r0, r1)
                    for col in range(c0, c1)
                    if usable[row * width + col]
                )

    # Solo las cajas pueden contener multiplicadores de costo mayores que 1.
    multipliers = array("f", [1.0]) * n
    for row0, col0, row1, col1 in fine.cost_boxes:
        for row in range(max(row0, 0), min(row1, height - 1) + 1):
            for col in range(max(col0, 0), min(col1, width - 1) + 1):
                value = fine.multipliers[row * width + col]
                index = (row // k) * cw + col // k
                if value > multipliers[index]:
                    multipliers[index] = value

    def level(status: bytearray) -> RoutingGrid:
        return RoutingGrid(cw, ch, coarse_z, status, multipliers)

    return CoarseGrid(k, level(strict), level(loose))
