"""Pruebas de D01: inventario y procedencia de fuentes."""

from dataclasses import replace
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from app.modules.catalog.domain.provenance import (
    MARS_IAU_SPHERE_RADIUS_M,
    LatitudeType,
    LongitudeDomain,
    ProductStatus,
    SourceInventory,
    SourceProduct,
)
from app.modules.catalog.infrastructure.source_inventory import (
    compute_sha256,
    inventory_from_dict,
    inventory_to_dict,
    load_inventory,
    main,
    render_data_sources_markdown,
    save_inventory,
    verify_checksums,
)

_PAYLOAD = b"fake-dem-bytes"
_PAYLOAD_SHA = hashlib.sha256(_PAYLOAD).hexdigest()


def _candidate(**overrides: object) -> SourceProduct:
    base: dict[str, object] = dict(
        product_id="TEST_DEM",
        title="DEM de prueba",
        layer_id="topography",
        mission="MRO",
        instrument="HiRISE",
        provider="PDS",
        source_url="https://example.org/product",
        license="Dominio público (verificar)",
        credit="NASA/JPL-Caltech/University of Arizona",
    )
    base.update(overrides)
    return SourceProduct(**base)  # type: ignore[arg-type]


def _downloaded(**overrides: object) -> SourceProduct:
    fields: dict[str, object] = dict(
        status=ProductStatus.DOWNLOADED,
        download_url="https://example.org/product.img",
        local_filename="test_dem.img",
        file_format="PDS IMG",
        file_size_bytes=len(_PAYLOAD),
        sha256=_PAYLOAD_SHA,
        resolution_m=1.0,
        source_crs="+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs",
        latitude_type=LatitudeType.PLANETOCENTRIC,
        longitude_domain=LongitudeDomain.EAST_0_360,
        body_radius_m=MARS_IAU_SPHERE_RADIUS_M,
        source_nodata=-3.4028227e38,
    )
    fields.update(overrides)
    return _candidate(**fields)


class SourceProductRulesTest(unittest.TestCase):
    def test_candidate_needs_only_provenance(self) -> None:
        product = _candidate()
        self.assertIs(product.status, ProductStatus.CANDIDATE)
        self.assertFalse(product.is_publishable)

    def test_downloaded_requires_technical_metadata(self) -> None:
        with self.assertRaisesRegex(ValueError, "sha256"):
            _candidate(status=ProductStatus.DOWNLOADED)

    def test_verified_requires_date_and_limitations(self) -> None:
        with self.assertRaisesRegex(ValueError, "product_date"):
            _downloaded(status=ProductStatus.VERIFIED)
        product = _downloaded(
            status=ProductStatus.VERIFIED,
            product_date="2014-06-01",
            limitations=("Bordes con artefactos de correlación estéreo.",),
        )
        self.assertTrue(product.is_publishable)

    def test_rejects_mars_trek_as_data_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "explorador visual"):
            _candidate(source_url="https://trek.nasa.gov/mars/")

    def test_rejects_non_https(self) -> None:
        with self.assertRaisesRegex(ValueError, "https"):
            _candidate(source_url="http://example.org/x")

    def test_rejects_terrestrial_crs(self) -> None:
        for crs in ("EPSG:4326", 'GEOGCS["WGS 84"]', "+datum=WGS84"):
            with self.subTest(crs=crs), self.assertRaisesRegex(ValueError, "terrestre"):
                _downloaded(source_crs=crs)

    def test_rejects_earth_radius(self) -> None:
        with self.assertRaisesRegex(ValueError, "Marte"):
            _downloaded(body_radius_m=6_378_137.0)

    def test_rejects_bad_sha256_and_path_traversal(self) -> None:
        with self.assertRaisesRegex(ValueError, "sha256"):
            _downloaded(sha256="ABC")
        with self.assertRaisesRegex(ValueError, "local_filename"):
            _downloaded(local_filename="../secret.img")

    def test_inventory_rejects_duplicate_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicado"):
            SourceInventory("R", "Región", (_candidate(), _candidate()))

    def test_inventory_queries(self) -> None:
        verified = _downloaded(
            product_id="OK",
            status=ProductStatus.VERIFIED,
            product_date="2020-01-01",
            limitations=("ninguna conocida",),
        )
        inv = SourceInventory("R", "Región", (_candidate(layer_id="imagery"), verified))
        self.assertEqual(inv.publishable(), (verified,))
        self.assertEqual(inv.layer_ids(), ("imagery", "topography"))
        self.assertEqual(inv.get("OK"), verified)


class SourceInventoryIoTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.inventory = SourceInventory(
            region_id="MC-23",
            region_name="Monte Sharp (Aeolis Mons)",
            products=(_candidate(product_id="CANDIDATE_ONLY"), _downloaded()),
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_json_round_trip(self) -> None:
        path = self.tmp / "sources.json"
        save_inventory(self.inventory, path)
        self.assertEqual(load_inventory(path), self.inventory)
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(raw["products"][1]["status"], "downloaded")

    def test_unknown_fields_and_version_are_rejected(self) -> None:
        data = inventory_to_dict(self.inventory)
        data["products"][0]["typo_field"] = 1
        with self.assertRaisesRegex(ValueError, "typo_field"):
            inventory_from_dict(data)
        with self.assertRaisesRegex(ValueError, "schema_version"):
            inventory_from_dict({**inventory_to_dict(self.inventory), "schema_version": 99})

    def test_checksums(self) -> None:
        (self.tmp / "test_dem.img").write_bytes(_PAYLOAD)
        self.assertEqual(compute_sha256(self.tmp / "test_dem.img"), _PAYLOAD_SHA)
        results = verify_checksums(self.inventory, self.tmp)
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].ok)

        (self.tmp / "test_dem.img").write_bytes(b"X" * len(_PAYLOAD))
        self.assertFalse(verify_checksums(self.inventory, self.tmp)[0].ok)

        bad = replace(self.inventory, products=(_downloaded(local_filename="missing.img"),))
        self.assertIn("no encontrado", verify_checksums(bad, self.tmp)[0].detail)

    def test_markdown_lists_every_product(self) -> None:
        md = render_data_sources_markdown(self.inventory)
        self.assertIn("Monte Sharp", md)
        self.assertIn("`CANDIDATE_ONLY`", md)
        self.assertIn(_PAYLOAD_SHA, md)
        self.assertIn("No editar a mano", md)

    def test_cli_render_and_verify(self) -> None:
        inv_path = self.tmp / "sources.json"
        save_inventory(self.inventory, inv_path)
        out = self.tmp / "DATA_SOURCES.md"
        self.assertEqual(main(["render", str(inv_path), str(out)]), 0)
        self.assertTrue(out.read_text(encoding="utf-8").startswith("# Fuentes de datos"))
        self.assertEqual(main(["verify", str(inv_path), str(self.tmp)]), 1)
        (self.tmp / "test_dem.img").write_bytes(_PAYLOAD)
        self.assertEqual(main(["verify", str(inv_path), str(self.tmp)]), 0)


if __name__ == "__main__":
    unittest.main()
