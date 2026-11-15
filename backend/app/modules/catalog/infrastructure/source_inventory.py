"""D01 — Persistencia del inventario (``sources.json``) y generación de ``DATA_SOURCES.md``.

``sources.json`` es la única fuente de verdad; ``DATA_SOURCES.md`` se genera a partir de él.

Uso (desde ``backend/``)::

    python -m app.modules.catalog.infrastructure.source_inventory render <sources.json> <out.md>
    python -m app.modules.catalog.infrastructure.source_inventory verify <sources.json> <raw_dir>
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, fields
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

from app.modules.catalog.domain.provenance import (
    LatitudeType,
    LongitudeDomain,
    ProductStatus,
    SourceInventory,
    SourceProduct,
)

INVENTORY_SCHEMA_VERSION: int = 1
_CHUNK_BYTES: int = 1024 * 1024

_PRODUCT_FIELDS: frozenset[str] = frozenset(f.name for f in fields(SourceProduct))
_ENUM_FIELDS: dict[str, type] = {
    "status": ProductStatus,
    "latitude_type": LatitudeType,
    "longitude_domain": LongitudeDomain,
}


# ---------------------------------------------------------------------------
# JSON <-> dominio
# ---------------------------------------------------------------------------


def product_from_dict(data: dict[str, Any]) -> SourceProduct:
    unknown = set(data) - _PRODUCT_FIELDS
    if unknown:
        raise ValueError(f"Campos desconocidos en producto: {sorted(unknown)}.")
    kwargs = dict(data)
    for name, enum_type in _ENUM_FIELDS.items():
        if kwargs.get(name) is not None:
            kwargs[name] = enum_type(kwargs[name])
    if "limitations" in kwargs:
        kwargs["limitations"] = tuple(kwargs["limitations"] or ())
    return SourceProduct(**kwargs)


def product_to_dict(product: SourceProduct) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for f in fields(SourceProduct):
        value = getattr(product, f.name)
        if value is None:
            continue
        if isinstance(value, tuple):
            value = list(value)
        elif hasattr(value, "value") and f.name in _ENUM_FIELDS:
            value = value.value
        result[f.name] = value
    return result


def inventory_from_dict(data: dict[str, Any]) -> SourceInventory:
    version = data.get("schema_version")
    if version != INVENTORY_SCHEMA_VERSION:
        raise ValueError(
            f"schema_version no soportado: {version!r} (esperado {INVENTORY_SCHEMA_VERSION})."
        )
    unknown = set(data) - {"schema_version", "region_id", "region_name", "products"}
    if unknown:
        raise ValueError(f"Campos desconocidos en inventario: {sorted(unknown)}.")
    products = []
    for index, raw in enumerate(data.get("products", [])):
        try:
            products.append(product_from_dict(raw))
        except (TypeError, ValueError) as exc:
            pid = raw.get("product_id", f"#{index}") if isinstance(raw, dict) else f"#{index}"
            raise ValueError(f"Producto {pid}: {exc}") from exc
    return SourceInventory(
        region_id=data["region_id"],
        region_name=data["region_name"],
        products=tuple(products),
    )


def inventory_to_dict(inventory: SourceInventory) -> dict[str, Any]:
    return {
        "schema_version": INVENTORY_SCHEMA_VERSION,
        "region_id": inventory.region_id,
        "region_name": inventory.region_name,
        "products": [product_to_dict(p) for p in inventory.products],
    }


def load_inventory(path: Path) -> SourceInventory:
    with path.open(encoding="utf-8") as handle:
        return inventory_from_dict(json.load(handle))


def save_inventory(inventory: SourceInventory, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(inventory_to_dict(inventory), ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Checksums
# ---------------------------------------------------------------------------


def compute_sha256(path: Path) -> str:
    """SHA-256 leyendo por bloques (los DEM pueden pesar varios GB)."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class ChecksumResult:
    product_id: str
    path: Path
    ok: bool
    detail: str


def verify_checksums(inventory: SourceInventory, raw_dir: Path) -> tuple[ChecksumResult, ...]:
    """Recalcula SHA-256 y tamaño de cada producto descargado o verificado."""
    results: list[ChecksumResult] = []
    for product in inventory.products:
        if product.status is ProductStatus.CANDIDATE:
            continue
        assert product.local_filename is not None  # garantizado por el dominio
        path = raw_dir / product.local_filename
        if not path.is_file():
            results.append(ChecksumResult(product.product_id, path, False, "archivo no encontrado"))
            continue
        size = path.stat().st_size
        if size != product.file_size_bytes:
            results.append(
                ChecksumResult(
                    product.product_id,
                    path,
                    False,
                    f"tamaño {size} != {product.file_size_bytes} bytes",
                )
            )
            continue
        actual = compute_sha256(path)
        ok = actual == product.sha256
        detail = "ok" if ok else f"sha256 {actual} != {product.sha256}"
        results.append(ChecksumResult(product.product_id, path, ok, detail))
    return tuple(results)


# ---------------------------------------------------------------------------
# DATA_SOURCES.md
# ---------------------------------------------------------------------------


def _md(value: object) -> str:
    if value is None:
        return "—"
    return str(value).replace("|", "\\|").replace("\n", " ")


def render_data_sources_markdown(inventory: SourceInventory) -> str:
    lines = [
        f"# Fuentes de datos — {inventory.region_name} (`{inventory.region_id}`)",
        "",
        "> Archivo generado desde `sources.json`. No editar a mano.",
        "",
        "| Producto | Capa | Misión / Instrumento | Resolución (m) | Estado | Licencia |",
        "|---|---|---|---|---|---|",
    ]
    for p in inventory.products:
        lines.append(
            f"| `{_md(p.product_id)}` | {_md(p.layer_id)} | {_md(p.mission)} / "
            f"{_md(p.instrument)} | {_md(p.resolution_m)} | {p.status.value} | {_md(p.license)} |"
        )
    for p in inventory.products:
        lines += [
            "",
            f"## `{p.product_id}` — {p.title}",
            "",
            f"- **Estado:** {p.status.value}",
            f"- **Capa:** {p.layer_id}",
            f"- **Misión / instrumento:** {p.mission} / {p.instrument}",
            f"- **Proveedor:** {p.provider}",
            f"- **Fuente original:** <{p.source_url}>",
            f"- **Descarga:** {f'<{p.download_url}>' if p.download_url else '—'}",
            f"- **Fecha (adquisición/publicación):** {_md(p.product_date)}",
            f"- **Resolución:** {_md(p.resolution_m)} m",
            f"- **CRS original:** `{_md(p.source_crs)}`",
            f"- **Latitud / longitud:** {_md(p.latitude_type and p.latitude_type.value)} / "
            f"{_md(p.longitude_domain and p.longitude_domain.value)}",
            f"- **Radio de referencia:** {_md(p.body_radius_m)} m",
            f"- **NoData original:** {_md(p.source_nodata)}",
            f"- **Formato / tamaño:** {_md(p.file_format)} / {_md(p.file_size_bytes)} bytes",
            f"- **SHA-256:** `{_md(p.sha256)}`",
            f"- **Licencia:** {p.license}",
            f"- **Crédito:** {p.credit}",
            "- **Limitaciones:**",
        ]
        lines += [f"  - {item}" for item in p.limitations] or ["  - (pendiente de documentar)"]
        if p.notes:
            lines.append(f"- **Notas:** {p.notes}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inventario de fuentes del catálogo (D01).")
    sub = parser.add_subparsers(dest="command", required=True)
    render = sub.add_parser("render", help="Genera DATA_SOURCES.md desde sources.json")
    render.add_argument("inventory", type=Path)
    render.add_argument("output", type=Path)
    verify = sub.add_parser("verify", help="Verifica tamaño y SHA-256 de los archivos en raw/")
    verify.add_argument("inventory", type=Path)
    verify.add_argument("raw_dir", type=Path)
    args = parser.parse_args(argv)

    inventory = load_inventory(args.inventory)
    if args.command == "render":
        args.output.write_text(render_data_sources_markdown(inventory), encoding="utf-8")
        print(f"Escrito {args.output} ({len(inventory.products)} productos).")
        return 0

    results = verify_checksums(inventory, args.raw_dir)
    for r in results:
        print(f"[{'OK' if r.ok else 'FALLA'}] {r.product_id}: {r.detail}")
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
