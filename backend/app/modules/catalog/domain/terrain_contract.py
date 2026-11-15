"""Internal 3D terrain contract between catalog (Backend 1) and missions (Backend 2)."""

from __future__ import annotations

from array import array
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
import math
import struct
import sys
from typing import Literal, Protocol

F32_EXTENSION: str = ".f32"
F32_HEADER_BYTES: int = 0
F32_DTYPE: str = "float32_little_endian"
F32_MEMORY_ORDER: str = "row_major"
F32_BYTES_PER_SAMPLE: int = 4

ASSETS_URL_PREFIX: str = "/api/v1/assets"

# Tolerancia al comparar extensiones (m) y rangos de elevación declarados frente a los datos
# cargados como float32 (m).
EXTENT_TOLERANCE_M: float = 1e-6
ELEVATION_RANGE_TOLERANCE_M: float = 0.01


class RowOrder(StrEnum):
    """Grid row orientation along north-south axis."""

    NORTH_TO_SOUTH = "north_to_south"


class NoDataPolicy(StrEnum):
    """Missing elevation representation."""

    F32_NAN = "f32_nan"


class TerrainPurpose(StrEnum):
    """Intended consumer for a terrain grid."""

    ROUTING_AND_VISUALIZATION = "routing_and_visualization"
    VISUALIZATION = "visualization"
    ROUTING = "routing"


def _ensure_finite(name: str, value: float) -> None:
    if not math.isfinite(value):
        raise ValueError(f"{name} debe ser un número finito; se recibió {value!r}.")


def _ensure_non_empty(name: str, value: str) -> None:
    if not value or not value.strip():
        raise ValueError(f"{name} no puede estar vacío.")


@dataclass(frozen=True, slots=True)
class LocalExtentM:
    """Rectangular spatial extent in meters within a local frame."""

    x_min_m: float
    x_max_m: float
    y_min_m: float
    y_max_m: float

    def __post_init__(self) -> None:
        _ensure_finite("x_min_m", self.x_min_m)
        _ensure_finite("x_max_m", self.x_max_m)
        _ensure_finite("y_min_m", self.y_min_m)
        _ensure_finite("y_max_m", self.y_max_m)
        if self.x_max_m <= self.x_min_m:
            raise ValueError("x_max_m debe ser mayor que x_min_m.")
        if self.y_max_m <= self.y_min_m:
            raise ValueError("y_max_m debe ser mayor que y_min_m.")

    @property
    def width_m(self) -> float:
        return self.x_max_m - self.x_min_m

    @property
    def height_m(self) -> float:
        return self.y_max_m - self.y_min_m

    def contains(self, x_m: float, y_m: float) -> bool:
        return (
            math.isfinite(x_m)
            and math.isfinite(y_m)
            and self.x_min_m <= x_m <= self.x_max_m
            and self.y_min_m <= y_m <= self.y_max_m
        )

    def matches(self, other: LocalExtentM, tolerance_m: float = EXTENT_TOLERANCE_M) -> bool:
        """True when both extents cover the same rectangle within tolerance."""
        return (
            abs(self.x_min_m - other.x_min_m) <= tolerance_m
            and abs(self.x_max_m - other.x_max_m) <= tolerance_m
            and abs(self.y_min_m - other.y_min_m) <= tolerance_m
            and abs(self.y_max_m - other.y_max_m) <= tolerance_m
        )


@dataclass(frozen=True, slots=True)
class RegionSectorSpec:
    """Active region and sector bounds within a local coordinate frame."""

    region_id: str
    region_name: str
    sector_id: str
    frame_id: str
    extent_m: LocalExtentM

    def __post_init__(self) -> None:
        _ensure_non_empty("region_id", self.region_id)
        _ensure_non_empty("region_name", self.region_name)
        _ensure_non_empty("sector_id", self.sector_id)
        _ensure_non_empty("frame_id", self.frame_id)


@dataclass(frozen=True, slots=True)
class TerrainGridSpec:
    """Elevation grid geometry (col: +X west-to-east, row: -Y north-to-south)."""

    width_px: int
    height_px: int
    origin_center_x_m: float
    origin_center_y_m: float
    pixel_size_x_m: float
    pixel_size_y_m: float
    row_order: RowOrder = RowOrder.NORTH_TO_SOUTH
    purpose: TerrainPurpose = TerrainPurpose.ROUTING_AND_VISUALIZATION

    def __post_init__(self) -> None:
        if self.width_px <= 0 or self.height_px <= 0:
            raise ValueError("width_px y height_px deben ser enteros positivos.")
        _ensure_finite("origin_center_x_m", self.origin_center_x_m)
        _ensure_finite("origin_center_y_m", self.origin_center_y_m)
        _ensure_finite("pixel_size_x_m", self.pixel_size_x_m)
        _ensure_finite("pixel_size_y_m", self.pixel_size_y_m)
        if self.pixel_size_x_m <= 0 or self.pixel_size_y_m <= 0:
            raise ValueError("pixel_size_x_m y pixel_size_y_m deben ser mayores que 0.")
        if self.row_order != RowOrder.NORTH_TO_SOUTH:
            raise ValueError(f"row_order no soportado: {self.row_order!r}")

    @property
    def total_samples(self) -> int:
        return self.width_px * self.height_px

    @property
    def expected_f32_byte_size(self) -> int:
        return self.total_samples * F32_BYTES_PER_SAMPLE

    def index_to_center_xy(self, row: int, col: int) -> tuple[float, float]:
        """Return (x_m, y_m) cell center for (row, col)."""
        if not (0 <= row < self.height_px and 0 <= col < self.width_px):
            raise IndexError(
                f"Índice ({row}, {col}) fuera de límites ({self.height_px}x{self.width_px})."
            )
        x_m = self.origin_center_x_m + col * self.pixel_size_x_m
        y_m = self.origin_center_y_m - row * self.pixel_size_y_m
        return x_m, y_m

    def xy_to_fractional_index(self, x_m: float, y_m: float) -> tuple[float, float]:
        """Convert local (x_m, y_m) to continuous (row_f, col_f) coordinates."""
        _ensure_finite("x_m", x_m)
        _ensure_finite("y_m", y_m)
        col_f = (x_m - self.origin_center_x_m) / self.pixel_size_x_m
        row_f = (self.origin_center_y_m - y_m) / self.pixel_size_y_m
        return row_f, col_f

    def bounds_pixel_edges_m(self) -> LocalExtentM:
        """Outer boundary including half-pixel outer margins."""
        return LocalExtentM(
            x_min_m=self.origin_center_x_m - 0.5 * self.pixel_size_x_m,
            x_max_m=self.origin_center_x_m + (self.width_px - 0.5) * self.pixel_size_x_m,
            y_min_m=self.origin_center_y_m - (self.height_px - 0.5) * self.pixel_size_y_m,
            y_max_m=self.origin_center_y_m + 0.5 * self.pixel_size_y_m,
        )

    def contains_xy(self, x_m: float, y_m: float) -> bool:
        """Check whether (x_m, y_m) lies within outer grid bounds."""
        return self.bounds_pixel_edges_m().contains(x_m, y_m)


@dataclass(frozen=True, slots=True)
class VerticalReferenceSpec:
    """Vertical datum, elevation range, units, and NoData policy."""

    vertical_datum: str
    elevation_min_m: float
    elevation_max_m: float
    units: Literal["m"] = "m"
    nodata_policy: NoDataPolicy = NoDataPolicy.F32_NAN

    def __post_init__(self) -> None:
        _ensure_non_empty("vertical_datum", self.vertical_datum)
        _ensure_finite("elevation_min_m", self.elevation_min_m)
        _ensure_finite("elevation_max_m", self.elevation_max_m)
        if self.elevation_max_m < self.elevation_min_m:
            raise ValueError("elevation_max_m debe ser mayor o igual que elevation_min_m.")


@dataclass(frozen=True, slots=True)
class TerrainConsistencySpec:
    """Versioning, evidence IDs, and texture alignment metadata."""

    terrain_version: str
    evidence_ids: tuple[str, ...]
    texture_layer_id: str
    texture_aligned_to_terrain: bool = True
    dataset_checksum_sha256: str | None = None
    texture_grid: TerrainGridSpec | None = None

    def __post_init__(self) -> None:
        _ensure_non_empty("terrain_version", self.terrain_version)
        _ensure_non_empty("texture_layer_id", self.texture_layer_id)
        if not self.evidence_ids:
            raise ValueError("evidence_ids debe contener al menos una evidencia verificable.")
        for evidence_id in self.evidence_ids:
            _ensure_non_empty("evidence_id", evidence_id)
        if not self.texture_aligned_to_terrain:
            raise ValueError("La textura asociada al terreno debe estar alineada con las alturas.")


def build_asset_url(region_id: str, filename: str) -> str:
    """Build public asset URL under /api/v1/assets/{region_id}/{filename}."""
    _ensure_non_empty("region_id", region_id)
    _ensure_non_empty("filename", filename)
    clean_region = region_id.strip("/")
    clean_file = filename.lstrip("/")
    if ".." in clean_file.split("/"):
        raise ValueError("El nombre del archivo no puede contener recorridos de directorio '..'.")
    return f"{ASSETS_URL_PREFIX}/{clean_region}/{clean_file}"


@dataclass(frozen=True, slots=True)
class TerrainAssetPaths:
    """Relative public URLs for terrain static assets."""

    heightmap_url: str
    texture_url: str | None = None
    blocked_mask_url: str | None = None

    def __post_init__(self) -> None:
        self._validate_asset_url("heightmap_url", self.heightmap_url)
        if not self.heightmap_url.endswith(F32_EXTENSION):
            raise ValueError(f"heightmap_url debe terminar en {F32_EXTENSION!r}.")
        if self.texture_url is not None:
            self._validate_asset_url("texture_url", self.texture_url)
        if self.blocked_mask_url is not None:
            self._validate_asset_url("blocked_mask_url", self.blocked_mask_url)

    @staticmethod
    def _validate_asset_url(field_name: str, url: str) -> None:
        _ensure_non_empty(field_name, url)
        expected_prefix = f"{ASSETS_URL_PREFIX}/"
        if not url.startswith(expected_prefix):
            raise ValueError(f"{field_name} debe iniciar con {expected_prefix!r}; recibido {url!r}")

    def iter_urls(self) -> tuple[tuple[str, str], ...]:
        """Return (field_name, url) for every declared asset URL."""
        urls = [("heightmap_url", self.heightmap_url)]
        if self.texture_url is not None:
            urls.append(("texture_url", self.texture_url))
        if self.blocked_mask_url is not None:
            urls.append(("blocked_mask_url", self.blocked_mask_url))
        return tuple(urls)

    def ensure_region(self, region_id: str) -> None:
        """Check that every asset URL lives under /api/v1/assets/{region_id}/."""
        expected_prefix = f"{ASSETS_URL_PREFIX}/{region_id.strip('/')}/"
        for field_name, url in self.iter_urls():
            if not url.startswith(expected_prefix):
                raise ValueError(
                    f"{field_name} debe pertenecer a la región {region_id!r} "
                    f"(prefijo {expected_prefix!r}); recibido {url!r}."
                )


@dataclass(frozen=True, slots=True)
class TerrainMetadata:
    """Complete 3D terrain metadata contract."""

    sector: RegionSectorSpec
    grid: TerrainGridSpec
    vertical: VerticalReferenceSpec
    consistency: TerrainConsistencySpec
    assets: TerrainAssetPaths
    routing_grid: TerrainGridSpec | None = None

    def __post_init__(self) -> None:
        self.assets.ensure_region(self.sector.region_id)
        terrain_extent = self.grid.bounds_pixel_edges_m()
        texture_grid = self.consistency.texture_grid
        if texture_grid is not None and not texture_grid.bounds_pixel_edges_m().matches(
            terrain_extent
        ):
            raise ValueError(
                "texture_grid no cubre la misma extensión que grid; "
                "la textura no está alineada con las alturas."
            )
        if self.routing_grid is not None and not self.routing_grid.bounds_pixel_edges_m().matches(
            terrain_extent
        ):
            raise ValueError("routing_grid no cubre la misma extensión que grid.")

    @property
    def effective_routing_grid(self) -> TerrainGridSpec:
        return self.routing_grid or self.grid


@dataclass(frozen=True, slots=True)
class TerrainSample:
    """Point query sample result for elevation, validity, and block state."""

    x_m: float
    y_m: float
    elevation_m: float | None
    is_valid: bool
    is_blocked: bool
    in_bounds: bool
    row: int | None = None
    col: int | None = None


def compute_elevation_range(elevations_m: Sequence[float]) -> tuple[float, float]:
    """Compute (min_m, max_m) over finite elevation samples."""
    valid = [value for value in elevations_m if math.isfinite(value)]
    if not valid:
        raise ValueError("El heightmap no contiene muestras finitas de elevación.")
    return min(valid), max(valid)


def encode_f32_heightmap(elevations_m: Sequence[float], width_px: int, height_px: int) -> bytes:
    """Serialize elevations to headerless little-endian Float32 (.f32)."""
    expected = width_px * height_px
    if width_px <= 0 or height_px <= 0:
        raise ValueError("width_px y height_px deben ser positivos.")
    if len(elevations_m) != expected:
        raise ValueError(
            f"Se esperaban {expected} muestras ({width_px}x{height_px}), "
            f"se recibieron {len(elevations_m)}."
        )
    normalized = [float("nan") if math.isnan(v) else float(v) for v in elevations_m]
    for value in normalized:
        if math.isinf(value):
            raise ValueError("No se permiten valores infinitos en el archivo .f32; use NaN.")
    return struct.pack(f"<{expected}f", *normalized)


def decode_f32_heightmap(raw: bytes, width_px: int, height_px: int) -> tuple[float, ...]:
    """Deserialize headerless little-endian Float32 (.f32) bytes."""
    if width_px <= 0 or height_px <= 0:
        raise ValueError("width_px y height_px deben ser positivos.")
    expected_samples = width_px * height_px
    expected_bytes = expected_samples * F32_BYTES_PER_SAMPLE
    if len(raw) != expected_bytes:
        raise ValueError(
            f"Tamaño inválido de archivo .f32: se esperaban {expected_bytes} bytes, "
            f"se recibieron {len(raw)}."
        )
    values = struct.unpack(f"<{expected_samples}f", raw)
    for value in values:
        if math.isinf(value):
            raise ValueError("El archivo .f32 contiene infinitos; solo se permite finito o NaN.")
    return values


class TerrainGridData:
    """In-memory elevation grid with validity and blocked masks.

    Elevations are stored as a compact ``array('f')`` (4 bytes per cell). The validity mask is
    derived on demand from the elevations (NaN -> invalid); explicit masks, when given, are
    stored as ``bytearray`` (1 byte per cell).

    By default the data must match ``metadata.grid`` (the served ``.f32``). Pass
    ``grid=metadata.routing_grid`` to load a separate, finer routing grid.
    """

    def __init__(
        self,
        metadata: TerrainMetadata,
        elevations_m: Sequence[float] | array,
        valid_mask: Sequence[bool] | None = None,
        blocked_mask: Sequence[bool] | None = None,
        grid: TerrainGridSpec | None = None,
    ) -> None:
        self.metadata = metadata
        if grid is None:
            grid = metadata.grid
        elif grid != metadata.grid and grid != metadata.routing_grid:
            raise ValueError("grid debe ser metadata.grid o metadata.routing_grid.")
        self._grid = grid
        expected = self._grid.total_samples

        if len(elevations_m) != expected:
            raise ValueError(
                f"elevations_m debe tener {expected} elementos; tiene {len(elevations_m)}."
            )

        if isinstance(elevations_m, array) and elevations_m.typecode == "f":
            elevations = elevations_m
        else:
            elevations = array("f", (float(v) for v in elevations_m))

        self._explicit_valid: bytearray | None = None
        if valid_mask is not None:
            if len(valid_mask) != expected:
                raise ValueError(
                    f"valid_mask debe tener {expected} elementos; tiene {len(valid_mask)}."
                )
            self._explicit_valid = bytearray(1 if flag else 0 for flag in valid_mask)

        self._blocked: bytearray | None = None
        if blocked_mask is not None:
            if len(blocked_mask) != expected:
                raise ValueError(
                    f"blocked_mask debe tener {expected} elementos; tiene {len(blocked_mask)}."
                )
            self._blocked = bytearray(1 if flag else 0 for flag in blocked_mask)

        self.elevations_m: array = elevations
        self._check_declared_elevation_range()

    @classmethod
    def from_f32_bytes(
        cls,
        metadata: TerrainMetadata,
        raw: bytes,
        blocked_mask: Sequence[bool] | None = None,
        grid: TerrainGridSpec | None = None,
    ) -> TerrainGridData:
        """Load a headerless little-endian ``.f32`` without expanding it to Python floats."""
        target = grid or metadata.grid
        expected_bytes = target.expected_f32_byte_size
        if len(raw) != expected_bytes:
            raise ValueError(
                f"Tamaño inválido de archivo .f32: se esperaban {expected_bytes} bytes, "
                f"se recibieron {len(raw)}."
            )
        elevations = array("f")
        elevations.frombytes(raw)
        if sys.byteorder != "little":
            elevations.byteswap()
        return cls(metadata, elevations, blocked_mask=blocked_mask, grid=grid)

    def _check_declared_elevation_range(self) -> None:
        data_min = math.inf
        data_max = -math.inf
        isfinite = math.isfinite
        for value in self.elevations_m:
            if not isfinite(value):
                continue
            if value < data_min:
                data_min = value
            if value > data_max:
                data_max = value
        if data_min > data_max:
            return  # Grid without finite samples.
        vertical = self.metadata.vertical
        tol = ELEVATION_RANGE_TOLERANCE_M
        if data_min < vertical.elevation_min_m - tol or data_max > vertical.elevation_max_m + tol:
            raise ValueError(
                f"Los datos ({data_min:.3f}..{data_max:.3f} m) se salen del rango declarado "
                f"en metadata ({vertical.elevation_min_m:.3f}..{vertical.elevation_max_m:.3f} m)."
            )

    def is_valid_at(self, idx: int) -> bool:
        if not math.isfinite(self.elevations_m[idx]):
            return False
        return self._explicit_valid is None or bool(self._explicit_valid[idx])

    def is_blocked_at(self, idx: int) -> bool:
        if not self.is_valid_at(idx):
            return True
        return self._blocked is not None and bool(self._blocked[idx])

    @property
    def valid_mask(self) -> tuple[bool, ...]:
        """Full validity mask (materialized on demand; avoid on large grids)."""
        return tuple(self.is_valid_at(i) for i in range(len(self.elevations_m)))

    @property
    def blocked_mask(self) -> tuple[bool, ...]:
        """Full blocked mask (materialized on demand; avoid on large grids)."""
        return tuple(self.is_blocked_at(i) for i in range(len(self.elevations_m)))

    def _flat_index(self, row: int, col: int) -> int:
        if not (0 <= row < self._grid.height_px and 0 <= col < self._grid.width_px):
            raise IndexError(
                f"Celda ({row}, {col}) fuera de {self._grid.height_px}x{self._grid.width_px}."
            )
        return row * self._grid.width_px + col

    def sample_at_index(self, row: int, col: int) -> TerrainSample:
        """Sample cell by (row, col) grid indices."""
        idx = self._flat_index(row, col)
        x_m, y_m = self._grid.index_to_center_xy(row, col)
        is_valid = self.is_valid_at(idx)
        elevation = self.elevations_m[idx] if is_valid else None
        return TerrainSample(
            x_m=x_m,
            y_m=y_m,
            elevation_m=elevation,
            is_valid=is_valid,
            is_blocked=self.is_blocked_at(idx),
            in_bounds=True,
            row=row,
            col=col,
        )

    def sample_at_xy(
        self,
        x_m: float,
        y_m: float,
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> TerrainSample:
        """Sample elevation at local (x_m, y_m); out-of-bounds or NaN returns None and blocked."""
        if not self._grid.contains_xy(x_m, y_m):
            return TerrainSample(
                x_m=x_m,
                y_m=y_m,
                elevation_m=None,
                is_valid=False,
                is_blocked=True,
                in_bounds=False,
            )

        row_f, col_f = self._grid.xy_to_fractional_index(x_m, y_m)
        if method == "nearest":
            row = max(0, min(self._grid.height_px - 1, round(row_f)))
            col = max(0, min(self._grid.width_px - 1, round(col_f)))
            cell = self.sample_at_index(row, col)
            return TerrainSample(
                x_m=x_m,
                y_m=y_m,
                elevation_m=cell.elevation_m,
                is_valid=cell.is_valid,
                is_blocked=cell.is_blocked,
                in_bounds=True,
                row=row,
                col=col,
            )

        if method != "bilinear":
            raise ValueError(f"Método de muestreo no soportado: {method!r}")
        clamped_row = max(0.0, min(float(self._grid.height_px - 1), row_f))
        clamped_col = max(0.0, min(float(self._grid.width_px - 1), col_f))

        r0 = math.floor(clamped_row)
        c0 = math.floor(clamped_col)
        r1 = min(self._grid.height_px - 1, r0 + 1)
        c1 = min(self._grid.width_px - 1, c0 + 1)

        dr = clamped_row - r0
        dc = clamped_col - c0

        corners = (
            (r0, c0, (1.0 - dr) * (1.0 - dc)),
            (r0, c1, (1.0 - dr) * dc),
            (r1, c0, dr * (1.0 - dc)),
            (r1, c1, dr * dc),
        )

        elevation_acc = 0.0
        any_blocked = False
        for r, c, weight in corners:
            if weight == 0.0:
                continue
            idx = self._flat_index(r, c)
            if self.is_blocked_at(idx):
                any_blocked = True
            if not self.is_valid_at(idx):
                return TerrainSample(
                    x_m=x_m,
                    y_m=y_m,
                    elevation_m=None,
                    is_valid=False,
                    is_blocked=True,
                    in_bounds=True,
                )
            elevation_acc += weight * self.elevations_m[idx]

        return TerrainSample(
            x_m=x_m,
            y_m=y_m,
            elevation_m=elevation_acc,
            is_valid=True,
            is_blocked=any_blocked,
            in_bounds=True,
        )

    def sample_route_z(
        self,
        points_xy: Sequence[tuple[float, float]],
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> list[float | None]:
        """Sample elevation values for a sequence of (x_m, y_m) route waypoints."""
        return [self.sample_at_xy(x_m, y_m, method=method).elevation_m for x_m, y_m in points_xy]

    def to_f32_bytes(self) -> bytes:
        """Export current elevations to .f32 binary format (same dims as the loaded grid)."""
        for value in self.elevations_m:
            if math.isinf(value):
                raise ValueError("No se permiten valores infinitos en el archivo .f32; use NaN.")
        if sys.byteorder == "little":
            return self.elevations_m.tobytes()
        swapped = array("f", self.elevations_m)
        swapped.byteswap()
        return swapped.tobytes()

    @property
    def grid(self) -> TerrainGridSpec:
        """Grid geometry these elevations follow."""
        return self._grid


@dataclass(frozen=True, slots=True)
class TerrainDataset:
    """Dataset bundle combining metadata and in-memory grid data."""

    metadata: TerrainMetadata
    grid_data: TerrainGridData


class TerrainRepository(Protocol):
    """In-memory query protocol for missions service."""

    def get_metadata(self, region_id: str) -> TerrainMetadata:
        """Return terrain metadata for region."""
        ...

    def get_terrain(self, region_id: str) -> TerrainGridData:
        """Return full in-memory grid for region."""
        ...

    def sample_elevation(
        self,
        region_id: str,
        x_m: float,
        y_m: float,
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> TerrainSample:
        """Sample elevation, validity, and blocked status at (x_m, y_m)."""
        ...

    def sample_route_elevations(
        self,
        region_id: str,
        points_xy: Sequence[tuple[float, float]],
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> list[float | None]:
        """Sample elevation z_m for each route waypoint."""
        ...


class InMemoryTerrainRepository:
    """In-memory implementation of TerrainRepository."""

    def __init__(self, datasets: Sequence[TerrainDataset]) -> None:
        self._by_region: dict[str, TerrainDataset] = {}
        for dataset in datasets:
            region_id = dataset.metadata.sector.region_id
            if region_id in self._by_region:
                raise ValueError(f"Región duplicada en repositorio: {region_id!r}")
            self._by_region[region_id] = dataset

    def _require(self, region_id: str) -> TerrainDataset:
        dataset = self._by_region.get(region_id)
        if dataset is None:
            raise KeyError(f"No hay terreno cargado para la región {region_id!r}.")
        return dataset

    def get_metadata(self, region_id: str) -> TerrainMetadata:
        return self._require(region_id).metadata

    def get_terrain(self, region_id: str) -> TerrainGridData:
        return self._require(region_id).grid_data

    def sample_elevation(
        self,
        region_id: str,
        x_m: float,
        y_m: float,
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> TerrainSample:
        return self._require(region_id).grid_data.sample_at_xy(x_m, y_m, method=method)

    def sample_route_elevations(
        self,
        region_id: str,
        points_xy: Sequence[tuple[float, float]],
        method: Literal["nearest", "bilinear"] = "bilinear",
    ) -> list[float | None]:
        return self._require(region_id).grid_data.sample_route_z(points_xy, method=method)


def build_synthetic_terrain(
    region_id: str = "gale-mount-sharp",
    region_name: str = "Monte Sharp (Aeolis Mons), cráter Gale",
    sector_id: str = "gale-mount-sharp-synthetic-pilot",
    frame_id: str = "MARS_GALE_MS_LOCAL_V1",
    width_px: int = 32,
    height_px: int = 32,
    pixel_size_m: float = 100.0,
    base_elevation_m: float = -3500.0,
    terrain_version: str = "synthetic-v1",
) -> TerrainDataset:
    """Generate deterministic synthetic terrain dataset with sample NoData and blocked cells."""
    origin_center_x_m = 0.5 * pixel_size_m
    origin_center_y_m = (height_px - 0.5) * pixel_size_m
    grid = TerrainGridSpec(
        width_px=width_px,
        height_px=height_px,
        origin_center_x_m=origin_center_x_m,
        origin_center_y_m=origin_center_y_m,
        pixel_size_x_m=pixel_size_m,
        pixel_size_y_m=pixel_size_m,
    )
    extent = grid.bounds_pixel_edges_m()

    elevations: list[float] = []
    blocked_mask: list[bool] = []
    nodata_cell = (height_px // 4, width_px // 4)
    blocked_cell = (height_px // 2, width_px // 2)

    for row in range(height_px):
        for col in range(width_px):
            if (row, col) == nodata_cell and width_px >= 4 and height_px >= 4:
                elevations.append(float("nan"))
                blocked_mask.append(True)
                continue
            ridge = 45.0 * math.sin(col * 0.25) + 30.0 * math.cos(row * 0.2)
            elevations.append(base_elevation_m + ridge)
            blocked_mask.append((row, col) == blocked_cell and width_px >= 4 and height_px >= 4)

    elev_min, elev_max = compute_elevation_range(elevations)
    metadata = TerrainMetadata(
        sector=RegionSectorSpec(
            region_id=region_id,
            region_name=region_name,
            sector_id=sector_id,
            frame_id=frame_id,
            extent_m=extent,
        ),
        grid=grid,
        vertical=VerticalReferenceSpec(
            vertical_datum="MOLA_areoid_synthetic",
            elevation_min_m=elev_min,
            elevation_max_m=elev_max,
        ),
        consistency=TerrainConsistencySpec(
            terrain_version=terrain_version,
            evidence_ids=("ev-synthetic-terrain-gale-ms",),
            texture_layer_id="imagery",
            texture_aligned_to_terrain=True,
        ),
        assets=TerrainAssetPaths(
            heightmap_url=build_asset_url(region_id, "height.f32"),
            texture_url=build_asset_url(region_id, "imagery.png"),
        ),
    )
    grid_data = TerrainGridData(
        metadata=metadata,
        elevations_m=elevations,
        blocked_mask=blocked_mask,
    )
    return TerrainDataset(metadata=metadata, grid_data=grid_data)
