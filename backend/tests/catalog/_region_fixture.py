"""Región sintética mínima en disco, con el mismo formato que publica el pipeline."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import struct
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.modules.catalog.api.schemas import TerrainManifestSchema
from app.modules.catalog.domain.terrain_contract import (
    DataQuality,
    LocalExtentM,
    TerrainQualityZone,
    build_synthetic_terrain,
)

REGION_ID = "mc23-gale-mount-sharp"
FRAME_ID = "MARS_GALE_MS_LOCAL_V1"


def png_header(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)
    )


def write_region(
    root: Path,
    mutate: Callable[[dict[str, Any]], None] | None = None,
    heightmap_bytes: bytes | None = None,
) -> Path:
    """Write ``<root>/<REGION_ID>/derived/`` and return the derived directory."""
    dataset = build_synthetic_terrain(width_px=4, height_px=4, frame_id=FRAME_ID)
    raw = dataset.grid_data.to_f32_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    extent = dataset.metadata.sector.extent_m
    zone = TerrainQualityZone(
        zone_id="east-artifacts",
        quality=DataQuality.UNKNOWN,
        extent_m=LocalExtentM(
            extent.x_min_m + extent.width_m / 2, extent.x_max_m, extent.y_min_m, extent.y_max_m
        ),
        reason="prueba",
    )
    metadata = dataclasses.replace(
        dataset.metadata,
        consistency=dataclasses.replace(dataset.metadata.consistency, dataset_checksum_sha256=sha),
        quality_zones=(zone,),
    )
    texture = png_header(8, 8)
    derived = root / REGION_ID / "derived"
    derived.mkdir(parents=True)
    (derived / "height.f32").write_bytes(raw if heightmap_bytes is None else heightmap_bytes)
    (derived / "imagery.png").write_bytes(texture)
    (root / REGION_ID / "secret.txt").write_text("fuera de derived")
    document: dict[str, Any] = {
        "schema_version": 2,
        "region": {
            "region_id": REGION_ID,
            "name": "Monte Sharp",
            "body": "Mars",
            "description": "",
        },
        "frame": {
            "frame_id": FRAME_ID,
            "units": "m",
            "origin_east_lon_deg": 137.315346,
            "origin_planetocentric_lat_deg": -4.834348,
            "projection_definition": "+proj=tmerc +lat_0=-4.75 +lon_0=137.4 +R=3396190",
            "longitude_direction": "east",
            "latitude_type": "planetocentric",
        },
        "terrain_manifest": TerrainManifestSchema.from_terrain_metadata(metadata).model_dump(
            mode="json"
        ),
        "sector": {"sector_id": metadata.sector.sector_id},
        "texture": {"sha256": hashlib.sha256(texture).hexdigest(), "pixel_size_m": 50.0},
        "heightmap": {
            "nodata_cells": dataset.grid_data.non_finite_count,
            "sha256": sha,
            "size_bytes": len(raw),
        },
        "sources": [
            {
                "evidence_id": "ev-synthetic-terrain-gale-ms",
                "title": "Sintético",
                "mission": "-",
                "instrument": "-",
                "credit": "-",
                "download_url": "https://example.invalid/dem",
                "resolution_m": 100.0,
            }
        ],
        "limitations": ["Datos sintéticos"],
    }
    if mutate is not None:
        mutate(document)
    (derived / "terrain.json").write_text(json.dumps(document), encoding="utf-8")
    return derived
