"""Pruebas unitarias para el contrato de terreno de 7 puntos entre Backend 1 y Backend 2."""

import math
import struct
import unittest

from app.modules.catalog.domain.terrain_contract import (
    ASSETS_URL_PREFIX,
    InMemoryTerrainRepository,
    LocalExtentM,
    RegionSectorSpec,
    RowOrder,
    TerrainAssetPaths,
    TerrainConsistencySpec,
    TerrainDataset,
    TerrainGridData,
    TerrainGridSpec,
    TerrainMetadata,
    VerticalReferenceSpec,
    build_asset_url,
    build_synthetic_terrain,
    decode_f32_heightmap,
    encode_f32_heightmap,
)


def _make_sample_dataset(
    elevations: list[float],
    blocked_mask: list[bool] | None = None,
    width_px: int = 2,
    height_px: int = 2,
) -> TerrainDataset:
    grid = TerrainGridSpec(
        width_px=width_px,
        height_px=height_px,
        origin_center_x_m=10.0,
        origin_center_y_m=110.0,
        pixel_size_x_m=20.0,
        pixel_size_y_m=20.0,
        row_order=RowOrder.NORTH_TO_SOUTH,
    )
    metadata = TerrainMetadata(
        sector=RegionSectorSpec(
            region_id="MC-09",
            region_name="Tharsis",
            sector_id="MC-09-TEST",
            frame_id="MARS_MC09_LOCAL_V1",
            extent_m=grid.bounds_pixel_edges_m(),
        ),
        grid=grid,
        vertical=VerticalReferenceSpec(
            vertical_datum="MOLA_areoid",
            elevation_min_m=100.0,
            elevation_max_m=130.0,
        ),
        consistency=TerrainConsistencySpec(
            terrain_version="test-v1",
            evidence_ids=("ev-dem-test",),
            texture_layer_id="imagery",
            texture_aligned_to_terrain=True,
        ),
        assets=TerrainAssetPaths(
            heightmap_url=build_asset_url("MC-09", "height.f32"),
            texture_url=build_asset_url("MC-09", "imagery.png"),
        ),
    )
    grid_data = TerrainGridData(
        metadata=metadata,
        elevations_m=elevations,
        blocked_mask=blocked_mask,
    )
    return TerrainDataset(metadata=metadata, grid_data=grid_data)


class TerrainContractTests(unittest.TestCase):
    def test_grid_center_coordinates_and_north_to_south_order(self) -> None:
        grid = TerrainGridSpec(
            width_px=3,
            height_px=2,
            origin_center_x_m=50.0,
            origin_center_y_m=150.0,
            pixel_size_x_m=10.0,
            pixel_size_y_m=20.0,
        )
        self.assertEqual(grid.index_to_center_xy(0, 0), (50.0, 150.0))
        self.assertEqual(grid.index_to_center_xy(0, 2), (70.0, 150.0))
        self.assertEqual(grid.index_to_center_xy(1, 0), (50.0, 130.0))

        row_f, col_f = grid.xy_to_fractional_index(60.0, 140.0)
        self.assertAlmostEqual(row_f, 0.5)
        self.assertAlmostEqual(col_f, 1.0)

        edges = grid.bounds_pixel_edges_m()
        self.assertEqual(edges, LocalExtentM(45.0, 75.0, 120.0, 160.0))

    def test_f32_roundtrip_little_endian_headerless_and_nan(self) -> None:
        values = [100.5, float("nan"), -25.25, 310.0]
        raw = encode_f32_heightmap(values, width_px=2, height_px=2)

        self.assertEqual(len(raw), 16)
        self.assertEqual(raw[:4], struct.pack("<f", 100.5))

        decoded = decode_f32_heightmap(raw, width_px=2, height_px=2)
        self.assertAlmostEqual(decoded[0], 100.5, places=5)
        self.assertTrue(math.isnan(decoded[1]))
        self.assertAlmostEqual(decoded[2], -25.25, places=5)
        self.assertAlmostEqual(decoded[3], 310.0, places=5)

    def test_f32_rejects_wrong_byte_length(self) -> None:
        with self.assertRaises(ValueError):
            decode_f32_heightmap(b"\x00\x00\x00", width_px=1, height_px=1)

    def test_bilinear_sampling_and_nodata_never_becomes_zero(self) -> None:
        # Fila 0 (norte, y=110): [100, 120]
        # Fila 1 (sur,   y=90):  [110, 130]
        dataset = _make_sample_dataset([100.0, 120.0, 110.0, 130.0])
        repo = InMemoryTerrainRepository([dataset])

        center_sample = repo.sample_elevation("MC-09", 20.0, 100.0, method="bilinear")
        self.assertTrue(center_sample.in_bounds)
        self.assertTrue(center_sample.is_valid)
        self.assertFalse(center_sample.is_blocked)
        self.assertIsNotNone(center_sample.elevation_m)
        self.assertAlmostEqual(center_sample.elevation_m or 0.0, 115.0)

        dataset_with_hole = _make_sample_dataset([100.0, 120.0, 110.0, float("nan")])
        repo_hole = InMemoryTerrainRepository([dataset_with_hole])

        # En el centro de la celda superior izquierda, la celda NaN tiene peso cero.
        corner_ok = repo_hole.sample_elevation("MC-09", 10.0, 110.0, method="bilinear")
        self.assertTrue(corner_ok.is_valid)
        self.assertAlmostEqual(corner_ok.elevation_m or 0.0, 100.0)

        # En (20, 100), la interpolación incluye la celda NaN.
        hole_sample = repo_hole.sample_elevation("MC-09", 20.0, 100.0, method="bilinear")
        self.assertTrue(hole_sample.in_bounds)
        self.assertFalse(hole_sample.is_valid)
        self.assertTrue(hole_sample.is_blocked)
        self.assertIsNone(hole_sample.elevation_m)

    def test_out_of_bounds_and_blocked_mask_and_route_z(self) -> None:
        dataset = _make_sample_dataset(
            [100.0, 120.0, 110.0, 130.0],
            blocked_mask=[False, True, False, False],
        )
        repo = InMemoryTerrainRepository([dataset])

        outside = repo.sample_elevation("MC-09", -50.0, 100.0)
        self.assertFalse(outside.in_bounds)
        self.assertFalse(outside.is_valid)
        self.assertTrue(outside.is_blocked)
        self.assertIsNone(outside.elevation_m)

        blocked_cell = repo.sample_elevation("MC-09", 30.0, 110.0, method="nearest")
        self.assertTrue(blocked_cell.is_valid)
        self.assertTrue(blocked_cell.is_blocked)

        z_list = repo.sample_route_elevations("MC-09", [(10.0, 110.0), (10.0, 90.0), (-5.0, 90.0)])
        self.assertEqual(z_list, [100.0, 110.0, None])

    def test_synthetic_terrain_meets_7_point_contract(self) -> None:
        synthetic = build_synthetic_terrain()
        repo = InMemoryTerrainRepository([synthetic])

        meta = repo.get_metadata("mc23-gale-mount-sharp")
        self.assertEqual(meta.sector.region_id, "mc23-gale-mount-sharp")
        self.assertTrue(
            meta.assets.heightmap_url.startswith(f"{ASSETS_URL_PREFIX}/mc23-gale-mount-sharp/")
        )
        self.assertTrue(meta.consistency.texture_aligned_to_terrain)

        raw = repo.get_terrain("mc23-gale-mount-sharp").to_f32_bytes()
        self.assertEqual(len(raw), meta.grid.expected_f32_byte_size)

    def test_asset_url_must_stay_under_api_v1_assets(self) -> None:
        with self.assertRaises(ValueError):
            TerrainAssetPaths(heightmap_url="/assets/MC-09/height.f32")
        with self.assertRaises(ValueError):
            build_asset_url("MC-09", "../secret.f32")


if __name__ == "__main__":
    unittest.main()
