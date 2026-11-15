"""Pruebas del cargador de terreno publicado (``infrastructure/terrain_loader.py``)."""

import math
import os
import tempfile
import unittest
from pathlib import Path

from app.modules.catalog.domain.terrain_contract import DataQuality
from app.modules.catalog.infrastructure.terrain_loader import (
    TerrainDataError,
    load_catalog,
    load_region,
)
from tests.catalog._region_fixture import FRAME_ID, REGION_ID, write_region

REAL_DATA_ROOT = Path(__file__).resolve().parents[2] / "data" / "regions"
REAL_REGION = "mc23-gale-mount-sharp"


class TerrainLoaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def assert_rejected(self, fragment: str, **kwargs) -> None:
        with self.assertRaises(TerrainDataError) as ctx:
            load_region(self.root, REGION_ID, **kwargs)
        self.assertIn(fragment, str(ctx.exception))

    def test_loads_valid_region_into_compact_repository(self) -> None:
        write_region(self.root)
        store = load_catalog(self.root, [REGION_ID], {REGION_ID: FRAME_ID})
        repo = store.terrain_repository
        grid = repo.get_terrain(REGION_ID)
        self.assertEqual(grid.elevations_m.typecode, "f")
        self.assertEqual(grid.non_finite_count, 1)

        west = repo.sample_elevation(REGION_ID, 50.0, 350.0, method="nearest")
        self.assertTrue(west.is_valid)
        self.assertEqual(west.quality, DataQuality.NOMINAL)
        east = repo.sample_elevation(REGION_ID, 350.0, 350.0, method="nearest")
        self.assertEqual(east.quality, DataQuality.UNKNOWN)
        outside = repo.sample_elevation(REGION_ID, -10.0, 0.0)
        self.assertEqual(outside.quality, DataQuality.UNKNOWN)
        self.assertIsNone(outside.elevation_m)

    def test_rejects_wrong_f32_size(self) -> None:
        write_region(self.root, heightmap_bytes=b"\x00" * 12)
        self.assert_rejected("bytes")

    def test_rejects_checksum_mismatch(self) -> None:
        derived = write_region(self.root)
        raw = bytearray((derived / "height.f32").read_bytes())
        raw[0] ^= 0x01
        (derived / "height.f32").write_bytes(bytes(raw))
        self.assert_rejected("SHA-256")

    def test_rejects_declared_nan_count(self) -> None:
        write_region(self.root, mutate=lambda d: d["heightmap"].update(nodata_cells=0))
        self.assert_rejected("NaN")

    def test_rejects_declared_elevation_range(self) -> None:
        def widen(document: dict) -> None:
            document["terrain_manifest"]["elevation_min_m"] -= 50.0

        write_region(self.root, mutate=widen)
        self.assert_rejected("rango real")

    def test_rejects_dimension_mismatch(self) -> None:
        def resize(document: dict) -> None:
            document["terrain_manifest"]["width_px"] = 5

        write_region(self.root, mutate=resize)
        with self.assertRaises(TerrainDataError):
            load_region(self.root, REGION_ID)

    def test_rejects_frame_and_version_mismatch(self) -> None:
        write_region(self.root)
        self.assert_rejected("frame_id", expected_frame_id="OTRO_FRAME")
        self.assert_rejected("terrain_version", expected_terrain_version="otra")

    def test_rejects_inconsistent_frame_blocks(self) -> None:
        write_region(self.root, mutate=lambda d: d["frame"].update(frame_id="OTRO"))
        self.assert_rejected("frame.frame_id")

    def test_rejects_unsupported_schema_version(self) -> None:
        write_region(self.root, mutate=lambda d: d.update(schema_version=1))
        self.assert_rejected("schema_version")

    def test_rejects_region_id_mismatch_and_path_like_ids(self) -> None:
        write_region(self.root, mutate=lambda d: d["region"].update(region_id="otra"))
        self.assert_rejected("region.region_id")
        with self.assertRaises(TerrainDataError):
            load_region(self.root, "../" + REGION_ID)

    def test_rejects_asset_url_from_another_region(self) -> None:
        def foreign(document: dict) -> None:
            document["terrain_manifest"]["texture_url"] = "/api/v1/assets/otra/imagery.png"

        write_region(self.root, mutate=foreign)
        self.assert_rejected("región")


@unittest.skipUnless(
    (REAL_DATA_ROOT / REAL_REGION / "derived" / "terrain.json").is_file()
    and os.environ.get("MAPTE_SKIP_REAL_DATA") != "1",
    "Datos reales de Monte Sharp no disponibles.",
)
class RealMountSharpIntegrationTests(unittest.TestCase):
    """Integración opcional: solo corre si ``derived/`` del mapa real está presente."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.store = load_catalog(REAL_DATA_ROOT, [REAL_REGION], {REAL_REGION: FRAME_ID})

    def test_center_elevation_with_tolerance(self) -> None:
        sample = self.store.terrain_repository.sample_elevation(REAL_REGION, 5000.0, 5000.0)
        self.assertTrue(sample.is_valid)
        self.assertIsNotNone(sample.elevation_m)
        self.assertTrue(math.isclose(sample.elevation_m or 0.0, -3922.5, abs_tol=1.0))
        self.assertEqual(sample.quality, DataQuality.NOMINAL)

    def test_east_artifact_strip_is_unknown(self) -> None:
        sample = self.store.terrain_repository.sample_elevation(REAL_REGION, 8000.0, 5000.0)
        self.assertEqual(sample.quality, DataQuality.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
