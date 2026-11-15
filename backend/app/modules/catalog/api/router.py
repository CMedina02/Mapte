"""HTTP routes of the catalog module (registered under ``/api/v1``).

The store is read from ``request.app.state.catalog_store`` (a ``CatalogStore`` loaded once at
startup), so this module has no globals and tests can inject their own store.

- ``GET /regions``
- ``GET /regions/{region_id}/manifest``
- ``GET /regions/{region_id}/objectives``: objetivos científicos con ``z_m`` muestreado del DEM.
- ``GET /regions/{region_id}/photos``: fotografías y su calidad de localización; ``?objective_id``.
- ``GET /assets/{region_id}/{filename}``: only the files declared in the region metadata,
  never subdirectories, ``..`` or anything outside ``data/regions/<region_id>/derived/``.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from app.modules.catalog.api.schemas import (
    BoundsSchema,
    EvidenceSchema,
    FrameSchema,
    LayerSchema,
    ObjectiveSchema,
    ObjectivesResponse,
    PhotoSchema,
    PhotosResponse,
    PositionSchema,
    RegionManifestResponse,
    RegionSchema,
    RegionsResponse,
    TerrainManifestSchema,
)
from app.modules.catalog.infrastructure.science_loader import (
    LocalPosition,
    ScienceCatalog,
    ScienceDataError,
    load_science_catalog,
)
from app.modules.catalog.infrastructure.terrain_loader import CatalogStore, LoadedRegion

ASSET_MEDIA_TYPES: dict[str, str] = {
    ".f32": "application/octet-stream",
    ".png": "image/png",
}

catalog_router = APIRouter(tags=["Catalog"])


def get_catalog_store(request: Request) -> CatalogStore:
    store = getattr(request.app.state, "catalog_store", None)
    if not isinstance(store, CatalogStore):
        raise HTTPException(status_code=503, detail="The region catalog is not loaded.")
    return store


StoreDep = Annotated[CatalogStore, Depends(get_catalog_store)]


def _require_region(store: CatalogStore, region_id: str) -> LoadedRegion:
    region = store.get(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail=f"Unknown region: {region_id!r}.")
    return region


@catalog_router.get("/regions", response_model=RegionsResponse)
def list_regions(store: StoreDep) -> RegionsResponse:
    regions = []
    for region_id in store.region_ids():
        block = _require_region(store, region_id).document["region"]
        regions.append(
            RegionSchema(
                region_id=region_id,
                name=block["name"],
                description=block.get("description", ""),
            )
        )
    return RegionsResponse(regions=regions)


@catalog_router.get("/regions/{region_id}/manifest", response_model=RegionManifestResponse)
def get_region_manifest(region_id: str, store: StoreDep) -> RegionManifestResponse:
    region = _require_region(store, region_id)
    return build_region_manifest(region)


@catalog_router.get("/regions/{region_id}/objectives", response_model=ObjectivesResponse)
def get_objectives(region_id: str, store: StoreDep) -> ObjectivesResponse:
    return build_objectives_response(region_id, store)


def build_objectives_response(region_id: str, store: CatalogStore) -> ObjectivesResponse:
    region = _require_region(store, region_id)
    catalog = _science_catalog(region)
    if catalog is None:
        return ObjectivesResponse(objectives=[])
    return ObjectivesResponse(
        objectives=[
            ObjectiveSchema(
                objective_id=item.objective_id,
                region_id=item.region_id,
                title=item.title,
                description=item.description,
                position=_position(store, region_id, item.position),
                science_question=item.science_question,
                priority_weight=item.priority_weight,
                activities=list(item.activities),
                possible_findings=list(item.possible_findings),
                evidence_ids=list(item.evidence_ids),
            )
            for item in catalog.active_objectives
        ]
    )


@catalog_router.get("/regions/{region_id}/photos", response_model=PhotosResponse)
def get_photos(region_id: str, store: StoreDep, objective_id: str | None = None) -> PhotosResponse:
    return build_photos_response(region_id, store, objective_id)


def build_photos_response(
    region_id: str, store: CatalogStore, objective_id: str | None = None
) -> PhotosResponse:
    region = _require_region(store, region_id)
    catalog = _science_catalog(region)
    if catalog is None:
        return PhotosResponse(photos=[])
    if objective_id is not None and objective_id not in {
        item.objective_id for item in catalog.active_objectives
    }:
        raise HTTPException(status_code=404, detail=f"Unknown objective: {objective_id!r}.")
    return PhotosResponse(
        photos=[
            PhotoSchema(
                photo_id=item.photo_id,
                objective_id=item.objective_id,
                image_url=item.image_url,
                camera=item.camera,
                sol=item.sol,
                captured_at=item.captured_at,
                credit=item.credit,
                source_url=item.source_url,
                location=(_position(store, region_id, item.location) if item.location else None),
                location_quality=item.location_quality,
                limitations=list(item.limitations),
            )
            for item in catalog.active_photos
            if objective_id is None or item.objective_id == objective_id
        ]
    )


def _science_catalog(region: LoadedRegion) -> ScienceCatalog | None:
    try:
        catalog = load_science_catalog(region.region_id)
        if catalog is not None:
            catalog.check_within_extent(region.metadata)
    except ScienceDataError as exc:
        raise HTTPException(
            status_code=503, detail=f"Science catalog unavailable: {exc}"
        ) from exc
    return catalog


def _position(store: CatalogStore, region_id: str, position: LocalPosition) -> PositionSchema:
    sample = store.terrain_repository.sample_elevation(region_id, position.x_m, position.y_m)
    return PositionSchema(
        x_m=position.x_m, y_m=position.y_m, frame_id=position.frame_id, z_m=sample.elevation_m
    )


@catalog_router.get(
    "/assets/{region_id}/{filename}",
    response_class=FileResponse,
    responses={404: {"description": "Region or asset not published."}},
)
def get_asset(region_id: str, filename: str, store: StoreDep) -> FileResponse:
    region = _require_region(store, region_id)
    path = region.asset_files().get(filename)
    if path is None or path.resolve().parent != region.derived_dir or not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not published for this region.")
    media_type = ASSET_MEDIA_TYPES.get(path.suffix, "application/octet-stream")
    return FileResponse(path, media_type=media_type, filename=path.name)


def build_region_manifest(region: LoadedRegion) -> RegionManifestResponse:
    document = region.document
    metadata = region.metadata
    terrain = TerrainManifestSchema.from_terrain_metadata(metadata)
    frame = document["frame"]
    extent = metadata.sector.extent_m
    sources: list[dict[str, Any]] = list(document.get("sources") or [])
    limitations: list[str] = list(document.get("limitations") or [])

    evidence = [
        EvidenceSchema(
            evidence_id=source["evidence_id"],
            title=source.get("title", ""),
            mission=source.get("mission", ""),
            instrument=source.get("instrument", ""),
            source_url=source.get("download_url", ""),
            credit=source.get("credit", source.get("provider", "")),
            resolution_m=source.get("resolution_m"),
            caveats=[note for note in (source.get("note"),) if note] + limitations,
        )
        for source in sources
    ]
    # Incluye las evidencias referenciadas por objetivos y fotos.
    try:
        science = load_science_catalog(region.region_id)
    except ScienceDataError:
        science = None
    if science is not None:
        known = {item.evidence_id for item in evidence}
        evidence += [
            EvidenceSchema(**item.model_dump())
            for item in science.evidence
            if item.evidence_id not in known
        ]

    layers = []
    texture_block = document.get("texture") or {}
    if metadata.assets.texture_url is not None:
        layers.append(
            LayerSchema(
                layer_id=metadata.consistency.texture_layer_id,
                kind="optical",
                title="HiRISE orthophoto (USGS MSL Gale 25 cm v3)",
                asset_url=metadata.assets.texture_url,
                opacity_default=1.0,
                resolution_m_per_pixel=float(texture_block.get("pixel_size_m") or 1.0),
                evidence_ids=[
                    source["evidence_id"] for source in sources if "ortho" in source["evidence_id"]
                ]
                or list(metadata.consistency.evidence_ids),
            )
        )

    return RegionManifestResponse(
        region_id=region.region_id,
        frame=FrameSchema(
            frame_id=frame["frame_id"],
            units=frame.get("units", "m"),
            origin_east_lon_deg=frame["origin_east_lon_deg"],
            origin_planetocentric_lat_deg=frame["origin_planetocentric_lat_deg"],
            projection_definition=frame["projection_definition"],
            longitude_direction=frame.get("longitude_direction", "east"),
            latitude_type=frame.get("latitude_type", "planetocentric"),
        ),
        bounds_local_m=BoundsSchema(
            min_x=extent.x_min_m, min_y=extent.y_min_m, max_x=extent.x_max_m, max_y=extent.y_max_m
        ),
        layers=layers,
        evidence=evidence,
        sample_only=False,
        terrain=terrain,
    )
