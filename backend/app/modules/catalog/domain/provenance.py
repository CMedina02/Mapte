"""D01 — Inventario y procedencia/licencia de productos científicos (NASA/USGS/PDS).

Modelo de dominio puro (sin FastAPI ni rutas físicas). Cada producto avanza por
estados: ``candidate`` (identificado, aún sin descargar) -> ``downloaded``
(archivo local con checksum y metadatos técnicos) -> ``verified`` (revisado y
apto para publicarse como dato confirmado).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import math
import re
from urllib.parse import urlparse

# Radios de Marte (IAU): polar ~3 376 200 m, ecuatorial 3 396 190 m.
# El rango detecta errores como usar el radio terrestre (~6 378 137 m).
MARS_RADIUS_MIN_M: float = 3_370_000.0
MARS_RADIUS_MAX_M: float = 3_400_000.0
MARS_IAU_SPHERE_RADIUS_M: float = 3_396_190.0

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Exploradores visuales: útiles para elegir el sector, nunca como fuente de datos.
_FORBIDDEN_DATA_HOSTS: frozenset[str] = frozenset({"trek.nasa.gov"})

# Marcas de sistemas de referencia terrestres que no deben describir datos marcianos.
_TERRESTRIAL_CRS_MARKERS: tuple[str, ...] = ("EPSG:4326", "WGS84", "WGS 84", "WGS_1984")


class ProductStatus(StrEnum):
    """Etapa del producto dentro del inventario."""

    CANDIDATE = "candidate"
    DOWNLOADED = "downloaded"
    VERIFIED = "verified"


class LatitudeType(StrEnum):
    """Convención de latitud del producto original."""

    PLANETOCENTRIC = "planetocentric"
    PLANETOGRAPHIC = "planetographic"


class LongitudeDomain(StrEnum):
    """Dominio de longitud (positiva hacia el este) del producto original."""

    EAST_0_360 = "0-360"
    EAST_MINUS180_180 = "-180-180"


def _ensure_non_empty(name: str, value: str | None) -> None:
    if value is None or not value.strip():
        raise ValueError(f"{name} no puede estar vacío.")


def _ensure_https_url(name: str, value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{name} debe ser una URL https absoluta; se recibió {value!r}.")
    host = (parsed.hostname or "").lower()
    if host in _FORBIDDEN_DATA_HOSTS:
        raise ValueError(
            f"{name} apunta a {host!r}, que es un explorador visual; "
            "usa la fuente oficial (PDS, USGS Astrogeology, NASA)."
        )


def _ensure_not_terrestrial_crs(value: str) -> None:
    normalized = value.upper().replace(" ", "")
    for marker in _TERRESTRIAL_CRS_MARKERS:
        if marker.upper().replace(" ", "") in normalized:
            raise ValueError(
                f"source_crs parece terrestre ({marker!r}); los datos de Marte deben "
                "declarar un CRS marciano (p. ej. IAU_2015:49900 o PROJ con +R=3396190)."
            )


@dataclass(frozen=True, slots=True)
class SourceProduct:
    """Producto científico de origen con su procedencia, licencia y metadatos técnicos."""

    # Identificación y procedencia (obligatorio desde ``candidate``).
    product_id: str
    title: str
    layer_id: str
    mission: str
    instrument: str
    provider: str
    source_url: str
    license: str
    credit: str
    status: ProductStatus = ProductStatus.CANDIDATE

    # Metadatos técnicos (obligatorios desde ``downloaded``).
    download_url: str | None = None
    local_filename: str | None = None
    file_format: str | None = None
    file_size_bytes: int | None = None
    sha256: str | None = None
    resolution_m: float | None = None
    source_crs: str | None = None
    latitude_type: LatitudeType | None = None
    longitude_domain: LongitudeDomain | None = None
    body_radius_m: float | None = None
    source_nodata: float | None = None

    # Fecha de adquisición o publicación (obligatoria en ``verified``), ISO YYYY-MM-DD.
    product_date: str | None = None
    limitations: tuple[str, ...] = field(default_factory=tuple)
    notes: str | None = None

    def __post_init__(self) -> None:
        for name in (
            "product_id",
            "title",
            "layer_id",
            "mission",
            "instrument",
            "provider",
            "license",
            "credit",
        ):
            _ensure_non_empty(name, getattr(self, name))
        _ensure_https_url("source_url", self.source_url)

        # Validaciones de formato para los campos presentes, sin importar el estado.
        if self.download_url is not None:
            _ensure_https_url("download_url", self.download_url)
        if self.local_filename is not None:
            _ensure_non_empty("local_filename", self.local_filename)
            parts = self.local_filename.replace("\\", "/").split("/")
            if self.local_filename.startswith("/") or ".." in parts:
                raise ValueError("local_filename debe ser relativo a raw/ y sin '..'.")
        if self.sha256 is not None and not _SHA256_RE.match(self.sha256):
            raise ValueError("sha256 debe tener 64 caracteres hexadecimales en minúscula.")
        if self.file_size_bytes is not None and self.file_size_bytes <= 0:
            raise ValueError("file_size_bytes debe ser mayor que 0.")
        if self.resolution_m is not None and not (
            math.isfinite(self.resolution_m) and self.resolution_m > 0
        ):
            raise ValueError("resolution_m debe ser un número finito mayor que 0.")
        if self.source_crs is not None:
            _ensure_non_empty("source_crs", self.source_crs)
            _ensure_not_terrestrial_crs(self.source_crs)
        if self.body_radius_m is not None and not (
            MARS_RADIUS_MIN_M <= self.body_radius_m <= MARS_RADIUS_MAX_M
        ):
            raise ValueError(
                f"body_radius_m={self.body_radius_m} no corresponde a Marte "
                f"([{MARS_RADIUS_MIN_M:.0f}, {MARS_RADIUS_MAX_M:.0f}] m)."
            )
        if self.product_date is not None and not _ISO_DATE_RE.match(self.product_date):
            raise ValueError("product_date debe usar el formato ISO YYYY-MM-DD.")
        for item in self.limitations:
            _ensure_non_empty("limitations[]", item)

        missing = self.missing_fields_for(self.status)
        if missing:
            raise ValueError(
                f"Producto {self.product_id!r} en estado {self.status.value!r} "
                f"requiere: {', '.join(missing)}."
            )

    _DOWNLOADED_REQUIRED = (
        "download_url",
        "local_filename",
        "file_format",
        "file_size_bytes",
        "sha256",
        "resolution_m",
        "source_crs",
        "latitude_type",
        "longitude_domain",
        "body_radius_m",
    )

    def missing_fields_for(self, status: ProductStatus) -> tuple[str, ...]:
        """Campos que faltan para que el producto pueda estar en ``status``."""
        required: tuple[str, ...] = ()
        if status in (ProductStatus.DOWNLOADED, ProductStatus.VERIFIED):
            required = self._DOWNLOADED_REQUIRED
        if status is ProductStatus.VERIFIED:
            required = (*required, "product_date")
        missing = [name for name in required if getattr(self, name) is None]
        if status is ProductStatus.VERIFIED and not self.limitations:
            missing.append("limitations (al menos una, aunque sea 'ninguna conocida')")
        return tuple(missing)

    @property
    def is_publishable(self) -> bool:
        return self.status is ProductStatus.VERIFIED


@dataclass(frozen=True, slots=True)
class SourceInventory:
    """Inventario de productos de una región."""

    region_id: str
    region_name: str
    products: tuple[SourceProduct, ...]

    def __post_init__(self) -> None:
        _ensure_non_empty("region_id", self.region_id)
        _ensure_non_empty("region_name", self.region_name)
        seen: set[str] = set()
        for product in self.products:
            if product.product_id in seen:
                raise ValueError(f"product_id duplicado en el inventario: {product.product_id!r}.")
            seen.add(product.product_id)

    def get(self, product_id: str) -> SourceProduct:
        for product in self.products:
            if product.product_id == product_id:
                return product
        raise KeyError(f"Producto no encontrado: {product_id!r}.")

    def by_layer(self, layer_id: str) -> tuple[SourceProduct, ...]:
        return tuple(p for p in self.products if p.layer_id == layer_id)

    def by_status(self, status: ProductStatus) -> tuple[SourceProduct, ...]:
        return tuple(p for p in self.products if p.status is status)

    def publishable(self) -> tuple[SourceProduct, ...]:
        return tuple(p for p in self.products if p.is_publishable)

    def layer_ids(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(p.layer_id for p in self.products))
