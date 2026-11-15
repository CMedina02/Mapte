"""Pydantic v2 schemas for 3D terrain and position API payloads."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.catalog.domain.terrain_contract import (
    ASSETS_URL_PREFIX,
    F32_DTYPE,
    F32_MEMORY_ORDER,
    DataQuality,
    LocalExtentM,
    NoDataPolicy,
    RowOrder,
    TerrainGridSpec,
    TerrainMetadata,
    TerrainQualityZone,
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


class TextureGridMetadataSchema(TerrainGridMetadataSchema):
    """Texture raster geometry (may differ in resolution from the heightmap)."""

    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)

    @classmethod
    def from_grid(cls, grid: TerrainGridSpec) -> TextureGridMetadataSchema:
        return cls(
            width_px=grid.width_px,
            height_px=grid.height_px,
            origin_center_x_m=grid.origin_center_x_m,
            origin_center_y_m=grid.origin_center_y_m,
            pixel_size_x_m=grid.pixel_size_x_m,
            pixel_size_y_m=grid.pixel_size_y_m,
        )


class SectorExtentSchema(BaseModel):
    """Sector extent in local frame meters."""

    model_config = ConfigDict(extra="forbid")

    x_min_m: float
    x_max_m: float
    y_min_m: float
    y_max_m: float


class QualityZoneSchema(BaseModel):
    """Zone whose terrain data must be treated with a non-nominal quality."""

    model_config = ConfigDict(extra="forbid")

    zone_id: str = Field(min_length=1)
    quality: Literal["nominal", "unknown"]
    extent_m: SectorExtentSchema
    reason: str = Field(min_length=1)

    @classmethod
    def from_zone(cls, zone: TerrainQualityZone) -> QualityZoneSchema:
        extent = zone.extent_m
        return cls(
            zone_id=zone.zone_id,
            quality=zone.quality.value,
            extent_m=SectorExtentSchema(
                x_min_m=extent.x_min_m,
                x_max_m=extent.x_max_m,
                y_min_m=extent.y_min_m,
                y_max_m=extent.y_max_m,
            ),
            reason=zone.reason,
        )

    def to_zone(self) -> TerrainQualityZone:
        return TerrainQualityZone(
            zone_id=self.zone_id,
            quality=DataQuality(self.quality),
            extent_m=LocalExtentM(
                x_min_m=self.extent_m.x_min_m,
                x_max_m=self.extent_m.x_max_m,
                y_min_m=self.extent_m.y_min_m,
                y_max_m=self.extent_m.y_max_m,
            ),
            reason=self.reason,
        )


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

    # Optional assets and texture geometry.
    texture_url: str | None = None
    texture_grid: TextureGridMetadataSchema | None = None
    blocked_mask_url: str | None = None
    dataset_checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    # Sector covered by the terrain.
    sector_id: str = Field(min_length=1)
    extent_m: SectorExtentSchema

    # Zones with non-nominal data quality (e.g. DEM artifacts -> "unknown").
    quality_zones: list[QualityZoneSchema] = Field(default_factory=list)

    @field_validator("heightmap_url")
    @classmethod
    def _validate_heightmap_url(cls, value: str) -> str:
        expected_prefix = f"{ASSETS_URL_PREFIX}/"
        if not value.startswith(expected_prefix):
            raise ValueError(f"heightmap_url must start with {expected_prefix!r}.")
        if not value.endswith(".f32"):
            raise ValueError("heightmap_url debe apuntar a un archivo '.f32'.")
        return value

    @field_validator("texture_url", "blocked_mask_url")
    @classmethod
    def _validate_optional_asset_url(cls, value: str | None) -> str | None:
        expected_prefix = f"{ASSETS_URL_PREFIX}/"
        if value is not None and not value.startswith(expected_prefix):
            raise ValueError(f"The asset URL must start with {expected_prefix!r}.")
        return value

    @classmethod
    def from_terrain_metadata(cls, metadata: TerrainMetadata) -> TerrainManifestSchema:
        """Build schema from domain TerrainMetadata."""
        texture_grid = metadata.consistency.texture_grid
        extent = metadata.sector.extent_m
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
            texture_url=metadata.assets.texture_url,
            texture_grid=(
                TextureGridMetadataSchema.from_grid(texture_grid)
                if texture_grid is not None
                else None
            ),
            blocked_mask_url=metadata.assets.blocked_mask_url,
            dataset_checksum_sha256=metadata.consistency.dataset_checksum_sha256,
            sector_id=metadata.sector.sector_id,
            extent_m=SectorExtentSchema(
                x_min_m=extent.x_min_m,
                x_max_m=extent.x_max_m,
                y_min_m=extent.y_min_m,
                y_max_m=extent.y_max_m,
            ),
            quality_zones=[QualityZoneSchema.from_zone(zone) for zone in metadata.quality_zones],
        )


# --- HTTP responses of catalog_router (aligned with frontend/src/shared/types/contracts.ts) ---


class RegionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    body: Literal["Mars"] = "Mars"
    description: str
    available: bool = True


class RegionsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regions: list[RegionSchema]


class FrameSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_id: str = Field(min_length=1)
    units: Literal["m"] = "m"
    origin_east_lon_deg: float
    origin_planetocentric_lat_deg: float
    projection_definition: str = Field(min_length=1)
    longitude_direction: Literal["east", "west"] = "east"
    latitude_type: Literal["planetocentric", "planetographic"] = "planetocentric"


class BoundsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_x: float
    min_y: float
    max_x: float
    max_y: float


class EvidenceSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_id: str = Field(min_length=1)
    title: str
    mission: str
    instrument: str
    source_url: str
    credit: str
    captured_at: str | None = None
    resolution_m: float | None = None
    caveats: list[str] = Field(default_factory=list)


class LayerSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layer_id: str = Field(min_length=1)
    kind: Literal["optical", "topographic", "geologic", "thermal", "spectral", "other"]
    title: str
    asset_url: str
    opacity_default: float = Field(ge=0, le=1)
    resolution_m_per_pixel: float = Field(gt=0)
    evidence_ids: list[str]
    nodata_policy: Literal["unknown"] = "unknown"


class ObjectiveSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective_id: str = Field(min_length=1)
    region_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = ""
    position: PositionSchema
    science_question: str = Field(min_length=1)
    priority_weight: float = Field(
        ge=0, description="Mission scenario parameter; not a NASA score."
    )
    activities: list[str]
    possible_findings: list[str]
    evidence_ids: list[str]


class ObjectivesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objectives: list[ObjectiveSchema]


class PhotoSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    photo_id: str = Field(min_length=1)
    objective_id: str = Field(min_length=1)
    image_url: str = Field(min_length=1)
    camera: str
    sol: int | None
    captured_at: str | None
    credit: str
    source_url: str
    location: PositionSchema | None
    location_quality: Literal["verified", "approximate", "unknown"]
    limitations: list[str]


class PhotosResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    photos: list[PhotoSchema]
    sample_only: bool = False


class RegionManifestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region_id: str = Field(min_length=1)
    frame: FrameSchema
    bounds_local_m: BoundsSchema
    layers: list[LayerSchema]
    evidence: list[EvidenceSchema]
    sample_only: bool = False
    terrain: TerrainManifestSchema
