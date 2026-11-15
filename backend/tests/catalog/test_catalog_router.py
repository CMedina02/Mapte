"""Pruebas HTTP del ``catalog_router`` con una región sintética en disco."""

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import register_error_handlers
from app.modules.catalog.api.router import catalog_router
from app.modules.catalog.infrastructure.terrain_loader import load_catalog
from tests.catalog._region_fixture import FRAME_ID, REGION_ID, write_region


def make_app(store=None) -> FastAPI:
    application = FastAPI()
    register_error_handlers(application)
    if store is not None:
        application.state.catalog_store = store
    application.include_router(catalog_router, prefix="/api/v1")
    return application


class CatalogRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.derived = write_region(root)
        self.client = TestClient(make_app(load_catalog(root, [REGION_ID])))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_regions_and_manifest(self) -> None:
        regions = self.client.get("/api/v1/regions").json()["regions"]
        self.assertEqual([r["region_id"] for r in regions], [REGION_ID])

        manifest = self.client.get(f"/api/v1/regions/{REGION_ID}/manifest").json()
        self.assertEqual(manifest["frame"]["frame_id"], FRAME_ID)
        self.assertEqual(manifest["layers"][0]["layer_id"], manifest["terrain"]["texture_layer_id"])
        terrain = manifest["terrain"]
        self.assertTrue(terrain["heightmap_url"].startswith(f"/api/v1/assets/{REGION_ID}/"))
        self.assertEqual(terrain["quality_zones"][0]["quality"], "unknown")

    def test_serves_declared_heightmap_with_exact_size(self) -> None:
        manifest = self.client.get(f"/api/v1/regions/{REGION_ID}/manifest").json()["terrain"]
        response = self.client.get(manifest["heightmap_url"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/octet-stream")
        self.assertEqual(len(response.content), manifest["width_px"] * manifest["height_px"] * 4)

    def test_assets_cannot_escape_region(self) -> None:
        for path in [
            f"/api/v1/assets/{REGION_ID}/terrain.json",
            f"/api/v1/assets/{REGION_ID}/..%2Fsecret.txt",
            f"/api/v1/assets/{REGION_ID}/%2e%2e",
            f"/api/v1/assets/{REGION_ID}/../secret.txt",
            f"/api/v1/assets/{REGION_ID}/sub/height.f32",
            "/api/v1/assets/otra/height.f32",
        ]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertIn("error", response.json())

    def test_unknown_region_and_missing_store(self) -> None:
        self.assertEqual(self.client.get("/api/v1/regions/otra/manifest").status_code, 404)
        response = TestClient(make_app()).get("/api/v1/regions")
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
