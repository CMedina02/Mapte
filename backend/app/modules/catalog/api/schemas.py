"""Pydantic v2 schemas for 3D terrain and position API payloads."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.catalog.domain.terrain_contract import (
    ASSETS_URL_PREFIX,
    F32_DTYPE,
    F32_MEMORY_ORDER,
    NoDataPolicy,
    RowOrder,
    TerrainMetadata,
)


class PositionSchema(BaseModel):
    """Local Mars-frame position with backend-resolved elevation."""

    model_config = ConfigDict(extra="forbid")

    x_m: float
    y_m: float
    frame_id: str = Field(min_length=1)
    z_m: float | None = Field(
        default=None,
        description="Elevation in meters relative to terrain datum; null if missing.",
    )


class TerrainGridMetadataSchema(BaseModel):
    """Exposed grid geometry parameters."""

    model_config = ConfigDict(extra="forbid")

    origin_center_x_m: float
    origin_center_y_m: float
    pixel_size_x_m: float = Field(gt=0)
    pixel_size_y_m: float = Field(gt=0)
    row_order: Literal["north_to_south"] = RowOrder.NORTH_TO_SOUTH.value


class TerrainManifestSchema(BaseModel):
    """Terrain block within RegionManifest for 3D rendering."""

    model_config = ConfigDict(extra="forbid")

    heightmap_url: str = Field(min_length=1)
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    elevation_min_m: float
    elevation_max_m: float
    texture_layer_id: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)

    # Terrain contract metadata.
    frame_id: str = Field(min_length=1)
    terrain_version: str = Field(min_length=1)
    vertical_datum: str = Field(min_length=1)
    units: Literal["m"] = "m"
    format: Literal["f32"] = "f32"
    dtype: Literal["float32_little_endian"] = F32_DTYPE
    header_bytes: Literal[0] = 0
    memory_order: Literal["row_major"] = F32_MEMORY_ORDER
    nodata_policy: Literal["f32_nan"] = NoDataPolicy.F32_NAN.value
    texture_aligned: bool = True
    grid: TerrainGridMetadataSchema

    @field_validator("heightmap_url")
    @classmethod
    def _validate_heightmap_url(cls, value: str) -> str:
        expected_prefix = f"{ASSETS_URL_PREFIX}/"
        if not value.startswith(expected_prefix):
            raise ValueError(f"heightmap_url debe iniciar con {expected_prefix!r}.")
        if not value.endswith(".f32"):
            raise ValueError("heightmap_url debe apuntar a un archivo '.f32'.")
        return value

    @classmethod
    def from_terrain_metadata(cls, metadata: TerrainMetadata) -> TerrainManifestSchema:
        """Build schema from domain TerrainMetadata."""
        return cls(
            heightmap_url=metadata.assets.heightmap_url,
            width_px=metadata.grid.width_px,
            height_px=metadata.grid.height_px,
            elevation_min_m=metadata.vertical.elevation_min_m,
            elevation_max_m=metadata.vertical.elevation_max_m,
            texture_layer_id=metadata.consistency.texture_layer_id,
            evidence_ids=list(metadata.consistency.evidence_ids),
            frame_id=metadata.sector.frame_id,
            terrain_version=metadata.consistency.terrain_version,
            vertical_datum=metadata.vertical.vertical_datum,
            texture_aligned=metadata.consistency.texture_aligned_to_terrain,
            grid=TerrainGridMetadataSchema(
                origin_center_x_m=metadata.grid.origin_center_x_m,
                origin_center_y_m=metadata.grid.origin_center_y_m,
                pixel_size_x_m=metadata.grid.pixel_size_x_m,
                pixel_size_y_m=metadata.grid.pixel_size_y_m,
            ),
        )
