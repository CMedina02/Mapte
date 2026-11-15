"""D02 — Escribe ``derived/terrain.json`` y ``derived/SHA256SUMS`` de una región.

La metadata se construye con las clases del contrato (``TerrainMetadata`` y
``TerrainManifestSchema``), así que cualquier violación del contrato falla aquí
en lugar de llegar al frontend o a Backend 2.

Lo invoca ``build_gale_mount_sharp.sh``; ver ese script para los argumentos.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from array import array
from datetime import UTC, datetime
from pathlib import Path

from app.modules.catalog.api.schemas import TerrainManifestSchema
from app.modules.catalog.domain.terrain_contract import (
    RegionSectorSpec,
    TerrainAssetPaths,
    TerrainConsistencySpec,
    TerrainGridSpec,
    TerrainMetadata,
    VerticalReferenceSpec,
    build_asset_url,
)
from app.modules.catalog.infrastructure.source_inventory import compute_sha256

EVIDENCE_DEM = "ev-usgs-msl-gale-dem-1m-v3"
EVIDENCE_ORTHO = "ev-usgs-msl-gale-ortho-25cm-v3"


def grid_for(size_m: float, res_m: float) -> TerrainGridSpec:
    n = round(size_m / res_m)
    return TerrainGridSpec(
        width_px=n,
        height_px=n,
        origin_center_x_m=0.5 * res_m,
        origin_center_y_m=size_m - 0.5 * res_m,
        pixel_size_x_m=res_m,
        pixel_size_y_m=res_m,
    )


def read_f32_stats(path: Path, grid: TerrainGridSpec) -> tuple[float, float, int]:
    values = array("f")
    values.frombytes(path.read_bytes())
    if sys.byteorder != "little":
        values.byteswap()
    if len(values) != grid.total_samples:
        raise SystemExit(f"{path.name}: {len(values)} muestras, se esperaban {grid.total_samples}.")
    valid = [v for v in values if math.isfinite(v)]
    if not valid:
        raise SystemExit(f"{path.name}: no hay celdas válidas.")
    return min(valid), max(valid), len(values) - len(valid)


def read_png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path.name} no es un PNG.")
    return struct.unpack(">II", header[16:24])


def cached_sha256(path: Path, cache: Path) -> str:
    """El DEM crudo pesa 3.9 GB: reutiliza el hash si tamaño y mtime no cambiaron."""
    stamp = f"{path.stat().st_size}:{path.stat().st_mtime_ns}"
    if cache.is_file():
        saved_stamp, _, digest = cache.read_text().strip().partition(" ")
        if saved_stamp == stamp:
            return digest
    digest = compute_sha256(path)
    cache.write_text(f"{stamp} {digest}\n")
    return digest


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--region-dir", type=Path, required=True)
    p.add_argument("--region-id", required=True)
    p.add_argument("--heightmap", required=True)
    p.add_argument("--heightmap-res", type=float, required=True)
    p.add_argument("--texture", required=True)
    p.add_argument("--texture-res", type=float, required=True)
    p.add_argument("--size-m", type=float, required=True)
    p.add_argument("--local-crs", required=True)
    p.add_argument("--dem-raw", type=Path, required=True)
    p.add_argument("--dem-url", required=True)
    p.add_argument("--ortho-url", required=True)
    args = p.parse_args()

    derived = args.region_dir / "derived"
    heightmap_path = derived / args.heightmap
    texture_path = derived / args.texture

    grid = grid_for(args.size_m, args.heightmap_res)
    texture_grid = grid_for(args.size_m, args.texture_res)
    elev_min, elev_max, nodata_cells = read_f32_stats(heightmap_path, grid)
    png_w, png_h = read_png_size(texture_path)
    if (png_w, png_h) != (texture_grid.width_px, texture_grid.height_px):
        raise SystemExit(f"Textura {png_w}x{png_h} no coincide con la rejilla esperada.")

    heightmap_sha = compute_sha256(heightmap_path)
    texture_sha = compute_sha256(texture_path)

    metadata = TerrainMetadata(
        sector=RegionSectorSpec(
            region_id=args.region_id,
            region_name="Monte Sharp (Aeolis Mons), cráter Gale",
            sector_id=f"{args.region_id}-aoi-10km",
            frame_id="MARS_GALE_MS_LOCAL_V1",
            extent_m=grid.bounds_pixel_edges_m(),
        ),
        grid=grid,
        vertical=VerticalReferenceSpec(
            vertical_datum="mars_areoid_usgs_msl_gale_v3",
            elevation_min_m=elev_min,
            elevation_max_m=elev_max,
        ),
        consistency=TerrainConsistencySpec(
            terrain_version="gale-ms-v1",
            evidence_ids=(EVIDENCE_DEM, EVIDENCE_ORTHO),
            texture_layer_id="imagery",
            texture_aligned_to_terrain=True,
            dataset_checksum_sha256=heightmap_sha,
            texture_grid=texture_grid,
        ),
        assets=TerrainAssetPaths(
            heightmap_url=build_asset_url(args.region_id, args.heightmap),
            texture_url=build_asset_url(args.region_id, args.texture),
        ),
    )
    manifest = TerrainManifestSchema.from_terrain_metadata(metadata)

    dem_sha = cached_sha256(args.dem_raw, args.region_dir / "work" / "dem_raw.sha256")
    document = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "backend/scripts/terrain/build_gale_mount_sharp.sh",
        "terrain_manifest": manifest.model_dump(mode="json"),
        "sector": {
            "sector_id": metadata.sector.sector_id,
            "extent_m": {
                "x_min_m": metadata.sector.extent_m.x_min_m,
                "x_max_m": metadata.sector.extent_m.x_max_m,
                "y_min_m": metadata.sector.extent_m.y_min_m,
                "y_max_m": metadata.sector.extent_m.y_max_m,
            },
            "local_crs_proj": args.local_crs,
            "body_radius_m": 3396190.0,
        },
        "texture": {
            "url": metadata.assets.texture_url,
            "format": "png",
            "bands": "gray8",
            "nodata_value": 0,
            "nodata_meaning": "sin cobertura HiRISE en el mosaico USGS de origen",
            "width_px": texture_grid.width_px,
            "height_px": texture_grid.height_px,
            "origin_center_x_m": texture_grid.origin_center_x_m,
            "origin_center_y_m": texture_grid.origin_center_y_m,
            "pixel_size_m": args.texture_res,
            "sha256": texture_sha,
        },
        "heightmap": {
            "nodata_cells": nodata_cells,
            "sha256": heightmap_sha,
            "size_bytes": heightmap_path.stat().st_size,
        },
        "transformations": [
            "DEM: reproyección a marco local, remuestreo 'average' "
            f"1 m -> {args.heightmap_res:g} m, "
            "NoData -32767 -> NaN",
            "Ortofoto: paleta -> gris, recorte nativo 0.25 m, reproyección a marco local, "
            f"remuestreo 'average' -> {args.texture_res:g} m",
        ],
        "sources": [
            {
                "evidence_id": EVIDENCE_DEM,
                "title": "MSL Gale Merged DEM Mosaic 1 m v3",
                "provider": "USGS Astrogeology Science Center",
                "download_url": args.dem_url,
                "local_raw_sha256": dem_sha,
                "local_raw_size_bytes": args.dem_raw.stat().st_size,
                "resolution_m": 1.0,
                "source_nodata": -32767,
            },
            {
                "evidence_id": EVIDENCE_ORTHO,
                "title": "MSL Gale Merged Orthophoto Mosaic 25 cm v3",
                "provider": "USGS Astrogeology Science Center",
                "download_url": args.ortho_url,
                "resolution_m": 0.25,
                "note": "Solo se leyó el recorte del AOI vía HTTP Range (no el archivo completo).",
            },
        ],
        "limitations": [
            "La ortofoto de origen tiene huecos sin cobertura (valor 0) en el norte del AOI; "
            "la textura los conserva como 0, no son errores de descarga.",
            "El DEM de origen muestra artefactos en rejilla en la franja este (x > ~6.6 km): "
            "relleno de menor resolución en el mosaico USGS; no usar ahí pendientes finas.",
            "Datum vertical pendiente de confirmar contra la etiqueta PDS del DEM.",
            f"A {args.heightmap_res:g} m no se resuelven rocas ni obstáculos menores a esa escala.",
        ],
    }
    (derived / "terrain.json").write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (derived / "SHA256SUMS").write_text(
        f"{heightmap_sha}  {args.heightmap}\n{texture_sha}  {args.texture}\n", encoding="utf-8"
    )
    size = f"{grid.width_px}x{grid.height_px}"
    print(f"terrain.json: {size}, elev [{elev_min:.1f}, {elev_max:.1f}] m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
