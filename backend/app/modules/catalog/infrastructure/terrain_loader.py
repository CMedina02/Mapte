"""Carga y valida el terreno publicado de una región (``data/regions/<region_id>/derived/``).

Solo lo usan el arranque de la aplicación y el ``catalog_router``. Backend 2 recibe el
``TerrainRepository`` ya construido y no debe importar este módulo.

Validaciones antes de aceptar una región:
- ``schema_version`` soportada, ``region_id`` y ``frame_id`` coherentes entre bloques
  (y con los esperados, si se indican), ``terrain_version`` esperada si se indica.
- Extensión del sector idéntica a los bordes de la rejilla y origen del marco presente.
- Assets dentro de ``derived/`` y bajo ``/api/v1/assets/<region_id>/``.
- ``.f32``: tamaño exacto ``width*height*4`` y el declarado, SHA-256 (``terrain.json``,
  ``dataset_checksum_sha256`` y ``SHA256SUMS``), sin infinitos, número de NaN y rango de
  elevación iguales a los declarados.
- Textura: dimensiones del PNG iguales a ``texture_grid`` y SHA-256 declarado.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.modules.catalog.api.schemas import TerrainManifestSchema
from app.modules.catalog.domain.terrain_contract import (
    ASSETS_URL_PREFIX,
    ELEVATION_RANGE_TOLERANCE_M,
    InMemoryTerrainRepository,
    LocalExtentM,
    RegionSectorSpec,
    TerrainAssetPaths,
    TerrainConsistencySpec,
    TerrainDataset,
    TerrainGridData,
    TerrainGridSpec,
    TerrainMetadata,
    VerticalReferenceSpec,
)

SUPPORTED_SCHEMA_VERSIONS: frozenset[int] = frozenset({2})
TERRAIN_DOCUMENT_NAME: str = "terrain.json"
CHECKSUMS_NAME: str = "SHA256SUMS"
DERIVED_DIR_NAME: str = "derived"


class TerrainDataError(ValueError):
    """The published terrain of a region is missing, inconsistent or corrupted."""


@dataclass(frozen=True, slots=True)
class LoadedRegion:
    """Validated region: domain dataset plus the published ``terrain.json`` document."""

    region_id: str
    derived_dir: Path
    dataset: TerrainDataset
    document: Mapping[str, Any]

    @property
    def metadata(self) -> TerrainMetadata:
        return self.dataset.metadata

    def asset_files(self) -> dict[str, Path]:
        """Public filename -> file on disk, only for assets declared in the metadata."""
        return _asset_files(self.region_id, self.metadata, self.derived_dir)


def _asset_files(region_id: str, metadata: TerrainMetadata, derived_dir: Path) -> dict[str, Path]:
    prefix = f"{ASSETS_URL_PREFIX}/{region_id}/"
    files: dict[str, Path] = {}
    for _, url in metadata.assets.iter_urls():
        name = url.removeprefix(prefix)
        _check_plain_name("asset", name)
        files[name] = derived_dir / name
    return files


class CatalogStore:
    """Regions loaded at startup; shared by ``catalog_router`` and Backend 2."""

    def __init__(self, regions: Iterable[LoadedRegion]) -> None:
        self._regions: dict[str, LoadedRegion] = {}
        for region in regions:
            if region.region_id in self._regions:
                raise TerrainDataError(f"Región duplicada: {region.region_id!r}")
            self._regions[region.region_id] = region
        self.terrain_repository = InMemoryTerrainRepository(
            [region.dataset for region in self._regions.values()]
        )

    def region_ids(self) -> list[str]:
        return list(self._regions)

    def get(self, region_id: str) -> LoadedRegion | None:
        return self._regions.get(region_id)


def load_catalog(
    data_root: str | Path,
    region_ids: Iterable[str],
    expected_frame_ids: Mapping[str, str] | None = None,
) -> CatalogStore:
    """Load and validate every region; fails on the first inconsistent one."""
    frames = expected_frame_ids or {}
    return CatalogStore(
        load_region(data_root, region_id, expected_frame_id=frames.get(region_id))
        for region_id in region_ids
    )


def load_region(
    data_root: str | Path,
    region_id: str,
    expected_frame_id: str | None = None,
    expected_terrain_version: str | None = None,
) -> LoadedRegion:
    """Read ``<data_root>/<region_id>/derived/terrain.json`` and its assets, validating all."""
    _check_plain_name("region_id", region_id)
    derived_dir = (Path(data_root) / region_id / DERIVED_DIR_NAME).resolve()
    document = _read_document(derived_dir / TERRAIN_DOCUMENT_NAME)

    version = document.get("schema_version")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        raise TerrainDataError(
            f"schema_version {version!r} no soportada (soportadas: "
            f"{sorted(SUPPORTED_SCHEMA_VERSIONS)})."
        )

    region_block = _require_block(document, "region")
    frame_block = _require_block(document, "frame")
    sector_block = _require_block(document, "sector")
    heightmap_block = _require_block(document, "heightmap")
    try:
        manifest = TerrainManifestSchema.model_validate(document.get("terrain_manifest"))
    except ValidationError as exc:
        raise TerrainDataError(f"terrain_manifest inválido: {exc}") from exc

    if region_block.get("region_id") != region_id:
        raise TerrainDataError(
            f"region.region_id {region_block.get('region_id')!r} no coincide con {region_id!r}."
        )
    if frame_block.get("frame_id") != manifest.frame_id:
        raise TerrainDataError("frame.frame_id no coincide con terrain_manifest.frame_id.")
    if expected_frame_id is not None and manifest.frame_id != expected_frame_id:
        raise TerrainDataError(
            f"frame_id {manifest.frame_id!r} no coincide con el esperado {expected_frame_id!r}."
        )
    for key in ("origin_east_lon_deg", "origin_planetocentric_lat_deg"):
        if not isinstance(frame_block.get(key), int | float):
            raise TerrainDataError(f"frame.{key} debe ser numérico.")
    if not frame_block.get("projection_definition"):
        raise TerrainDataError("frame.projection_definition no puede estar vacío.")
    if expected_terrain_version is not None and manifest.terrain_version != (
        expected_terrain_version
    ):
        raise TerrainDataError(
            f"terrain_version {manifest.terrain_version!r} no coincide con la esperada "
            f"{expected_terrain_version!r}."
        )
    if sector_block.get("sector_id") != manifest.sector_id:
        raise TerrainDataError("sector.sector_id no coincide con terrain_manifest.sector_id.")

    try:
        metadata = _build_metadata(region_id, region_block, manifest)
    except ValueError as exc:
        raise TerrainDataError(f"Metadata de terreno inválida: {exc}") from exc

    if not metadata.sector.extent_m.matches(metadata.grid.bounds_pixel_edges_m()):
        raise TerrainDataError("La extensión del sector no coincide con los bordes de la rejilla.")

    try:
        assets = _asset_files(region_id, metadata, derived_dir)
    except ValueError as exc:
        raise TerrainDataError(str(exc)) from exc
    for name, path in assets.items():
        if path.resolve().parent != derived_dir or not path.is_file():
            raise TerrainDataError(f"Asset {name!r} no existe dentro de {derived_dir}.")

    checksums = _read_checksums(derived_dir / CHECKSUMS_NAME)
    heightmap_name = manifest.heightmap_url.rsplit("/", 1)[-1]
    grid_data = _load_heightmap(
        metadata,
        assets[heightmap_name],
        heightmap_block,
        manifest.dataset_checksum_sha256,
        checksums.get(heightmap_name),
    )
    if manifest.texture_url is not None:
        texture_name = manifest.texture_url.rsplit("/", 1)[-1]
        _check_texture(
            metadata,
            assets[texture_name],
            document.get("texture") or {},
            checksums.get(texture_name),
        )

    dataset = TerrainDataset(metadata=metadata, grid_data=grid_data)
    return LoadedRegion(
        region_id=region_id, derived_dir=derived_dir, dataset=dataset, document=document
    )


def _build_metadata(
    region_id: str, region_block: Mapping[str, Any], manifest: TerrainManifestSchema
) -> TerrainMetadata:
    grid = TerrainGridSpec(
        width_px=manifest.width_px,
        height_px=manifest.height_px,
        origin_center_x_m=manifest.grid.origin_center_x_m,
        origin_center_y_m=manifest.grid.origin_center_y_m,
        pixel_size_x_m=manifest.grid.pixel_size_x_m,
        pixel_size_y_m=manifest.grid.pixel_size_y_m,
    )
    texture_grid = None
    if manifest.texture_grid is not None:
        texture_grid = TerrainGridSpec(
            width_px=manifest.texture_grid.width_px,
            height_px=manifest.texture_grid.height_px,
            origin_center_x_m=manifest.texture_grid.origin_center_x_m,
            origin_center_y_m=manifest.texture_grid.origin_center_y_m,
            pixel_size_x_m=manifest.texture_grid.pixel_size_x_m,
            pixel_size_y_m=manifest.texture_grid.pixel_size_y_m,
        )
    extent = manifest.extent_m
    return TerrainMetadata(
        sector=RegionSectorSpec(
            region_id=region_id,
            region_name=str(region_block.get("name") or ""),
            sector_id=manifest.sector_id,
            frame_id=manifest.frame_id,
            extent_m=LocalExtentM(extent.x_min_m, extent.x_max_m, extent.y_min_m, extent.y_max_m),
        ),
        grid=grid,
        vertical=VerticalReferenceSpec(
            vertical_datum=manifest.vertical_datum,
            elevation_min_m=manifest.elevation_min_m,
            elevation_max_m=manifest.elevation_max_m,
        ),
        consistency=TerrainConsistencySpec(
            terrain_version=manifest.terrain_version,
            evidence_ids=tuple(manifest.evidence_ids),
            texture_layer_id=manifest.texture_layer_id,
            texture_aligned_to_terrain=manifest.texture_aligned,
            dataset_checksum_sha256=manifest.dataset_checksum_sha256,
            texture_grid=texture_grid,
        ),
        assets=TerrainAssetPaths(
            heightmap_url=manifest.heightmap_url,
            texture_url=manifest.texture_url,
            blocked_mask_url=manifest.blocked_mask_url,
        ),
        quality_zones=tuple(zone.to_zone() for zone in manifest.quality_zones),
    )


def _load_heightmap(
    metadata: TerrainMetadata,
    path: Path,
    block: Mapping[str, Any],
    manifest_sha: str | None,
    sums_sha: str | None,
) -> TerrainGridData:
    expected_size = metadata.grid.expected_f32_byte_size
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise TerrainDataError(
            f"{path.name}: {actual_size} bytes; la rejilla "
            f"{metadata.grid.width_px}x{metadata.grid.height_px} exige {expected_size}."
        )
    if block.get("size_bytes") != expected_size:
        raise TerrainDataError(f"heightmap.size_bytes no coincide con {expected_size}.")

    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    declared = {block.get("sha256"), manifest_sha} | ({sums_sha} if sums_sha else set())
    if declared != {digest}:
        raise TerrainDataError(f"{path.name}: SHA-256 {digest} no coincide con el declarado.")

    try:
        grid_data = TerrainGridData.from_f32_bytes(metadata, raw)
    except ValueError as exc:
        raise TerrainDataError(f"{path.name}: {exc}") from exc
    del raw

    data_range = grid_data.elevation_range_m
    if data_range is None:
        raise TerrainDataError(f"{path.name}: no contiene celdas con elevación válida.")
    infinite = sum(1 for value in grid_data.elevations_m if math.isinf(value))
    if infinite:
        raise TerrainDataError(f"{path.name}: {infinite} celdas infinitas; solo se admite NaN.")
    if grid_data.non_finite_count != block.get("nodata_cells"):
        raise TerrainDataError(
            f"{path.name}: {grid_data.non_finite_count} celdas NaN; "
            f"se declararon {block.get('nodata_cells')!r}."
        )
    vertical = metadata.vertical
    tol = ELEVATION_RANGE_TOLERANCE_M
    if (
        abs(data_range[0] - vertical.elevation_min_m) > tol
        or abs(data_range[1] - vertical.elevation_max_m) > tol
    ):
        raise TerrainDataError(
            f"{path.name}: rango real {data_range[0]:.3f}..{data_range[1]:.3f} m distinto del "
            f"declarado {vertical.elevation_min_m:.3f}..{vertical.elevation_max_m:.3f} m."
        )
    return grid_data


def _check_texture(
    metadata: TerrainMetadata,
    path: Path,
    block: Mapping[str, Any],
    sums_sha: str | None,
) -> None:
    texture_grid = metadata.consistency.texture_grid
    with path.open("rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise TerrainDataError(f"{path.name} no es un PNG.")
    width, height = struct.unpack(">II", header[16:24])
    if texture_grid is not None and (width, height) != (
        texture_grid.width_px,
        texture_grid.height_px,
    ):
        raise TerrainDataError(
            f"{path.name}: {width}x{height} px no coincide con texture_grid "
            f"{texture_grid.width_px}x{texture_grid.height_px}."
        )
    digest = _sha256_file(path)
    declared = {block.get("sha256")} | ({sums_sha} if sums_sha else set())
    if declared != {digest}:
        raise TerrainDataError(f"{path.name}: SHA-256 {digest} no coincide con el declarado.")


def _read_document(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise TerrainDataError(f"No existe {path}.")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TerrainDataError(f"{path.name} ilegible: {exc}") from exc
    if not isinstance(document, dict):
        raise TerrainDataError(f"{path.name} debe ser un objeto JSON.")
    return document


def _require_block(document: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    block = document.get(key)
    if not isinstance(block, dict):
        raise TerrainDataError(f"terrain.json no tiene el bloque {key!r}.")
    return block


def _read_checksums(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    sums: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        digest, _, name = line.strip().partition("  ")
        if digest and name:
            sums[name.strip()] = digest
    return sums


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_plain_name(field_name: str, value: str) -> None:
    if not value or value in {".", ".."} or "/" in value or "\\" in value or "\x00" in value:
        raise TerrainDataError(f"{field_name} inválido: {value!r}.")
