"""Carga y valida el catálogo científico de una región (objetivos, fotografías y evidencias).

Archivos (versionados en git, generados a partir de datos oficiales de NASA/JPL):
``app/modules/catalog/data/<region_id>/objectives.json`` y ``photos.json``.

Validaciones antes de aceptar el catálogo:
- ``region_id`` y ``frame_id`` coherentes en ambos archivos, en cada objetivo y en cada foto.
- IDs únicos de evidencias, objetivos y fotos.
- Toda referencia ``evidence_id`` / ``objective_id`` existe.
- URLs ``https`` absolutas y nunca de exploradores visuales (``trek.nasa.gov``).
- ``location_quality`` en ``verified|approximate|unknown``; ``verified`` exige ``location``.
- Cada objetivo tiene al menos una evidencia.
- Un objetivo con ``active: false`` debe declarar ``inactive_reason``.

La comprobación de que las posiciones caen dentro del terreno publicado se hace contra el
``TerrainMetadata`` de la región (``check_within_extent``), porque depende del terreno cargado.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.modules.catalog.domain.terrain_contract import TerrainMetadata

CATALOG_DATA_DIR: Path = Path(__file__).resolve().parents[1] / "data"
OBJECTIVES_FILE: str = "objectives.json"
PHOTOS_FILE: str = "photos.json"
_FORBIDDEN_HOSTS: frozenset[str] = frozenset({"trek.nasa.gov"})


class ScienceDataError(ValueError):
    """The science catalog of a region is missing or inconsistent."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceCoordinates(_Strict):
    """Original (lon/lat) coordinates the local position was projected from."""

    rmc: str = Field(min_length=1, description="Rover site_drive (Rover Motion Counter).")
    sol: int = Field(ge=0)
    east_lon_deg: float
    planetocentric_lat_deg: float
    elev_geoid_m: float | None = None


class LocalPosition(_Strict):
    x_m: float
    y_m: float
    frame_id: str = Field(min_length=1)
    source: SourceCoordinates


class EvidenceRecord(_Strict):
    evidence_id: str = Field(min_length=1)
    title: str
    mission: str
    instrument: str
    source_url: str
    credit: str
    captured_at: str | None = None
    resolution_m: float | None = None
    caveats: list[str] = Field(default_factory=list)


class ObjectiveRecord(_Strict):
    objective_id: str = Field(min_length=1)
    region_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str
    position: LocalPosition
    science_question: str = Field(min_length=1)
    priority_weight: float = Field(ge=0)
    activities: list[str]
    possible_findings: list[str]
    evidence_ids: list[str] = Field(min_length=1)
    # Valida los objetivos inactivos, pero omite su publicación y la de sus fotos.
    active: bool = True
    inactive_reason: str | None = None


class PhotoRecord(_Strict):
    photo_id: str = Field(min_length=1)
    objective_id: str = Field(min_length=1)
    image_url: str
    camera: str = Field(min_length=1)
    sol: int | None = Field(default=None, ge=0)
    captured_at: str | None = None
    credit: str = Field(min_length=1)
    source_url: str
    location: LocalPosition | None = None
    location_quality: Literal["verified", "approximate", "unknown"]
    limitations: list[str]
    evidence_ids: list[str] = Field(default_factory=list)


class _ObjectivesFile(_Strict):
    region_id: str
    frame_id: str
    generated_from: list[str] = Field(default_factory=list)
    evidence: list[EvidenceRecord]
    objectives: list[ObjectiveRecord]


class _PhotosFile(_Strict):
    region_id: str
    frame_id: str
    generated_from: list[str] = Field(default_factory=list)
    photos: list[PhotoRecord]


@dataclass(frozen=True, slots=True)
class ScienceCatalog:
    region_id: str
    frame_id: str
    evidence: tuple[EvidenceRecord, ...]
    objectives: tuple[ObjectiveRecord, ...]
    photos: tuple[PhotoRecord, ...]

    @property
    def active_objectives(self) -> tuple[ObjectiveRecord, ...]:
        return tuple(item for item in self.objectives if item.active)

    @property
    def active_photos(self) -> tuple[PhotoRecord, ...]:
        """Photos whose objective is active."""
        active_ids = {item.objective_id for item in self.active_objectives}
        return tuple(item for item in self.photos if item.objective_id in active_ids)

    def check_within_extent(self, metadata: TerrainMetadata) -> None:
        """Every objective and located photo must lie inside the published terrain."""
        if metadata.sector.frame_id != self.frame_id:
            raise ScienceDataError(
                f"frame_id {self.frame_id!r} no coincide con el del terreno "
                f"{metadata.sector.frame_id!r}."
            )
        extent = metadata.sector.extent_m
        located: list[tuple[str, LocalPosition]] = [
            (item.objective_id, item.position) for item in self.objectives
        ]
        located += [(item.photo_id, item.location) for item in self.photos if item.location]
        for item_id, position in located:
            if not (
                extent.x_min_m <= position.x_m <= extent.x_max_m
                and extent.y_min_m <= position.y_m <= extent.y_max_m
            ):
                raise ScienceDataError(
                    f"{item_id}: ({position.x_m}, {position.y_m}) está fuera de la extensión "
                    "publicada del terreno."
                )


def load_science_catalog(region_id: str, data_dir: Path | None = None) -> ScienceCatalog | None:
    """Read and validate the region's catalog; ``None`` if the region has no catalog files."""
    if data_dir is None:
        return _load_default(region_id)
    return _load(region_id, data_dir)


@lru_cache(maxsize=8)
def _load_default(region_id: str) -> ScienceCatalog | None:
    return _load(region_id, CATALOG_DATA_DIR)


def _load(region_id: str, data_dir: Path) -> ScienceCatalog | None:
    if not region_id or "/" in region_id or "\\" in region_id or region_id in {".", ".."}:
        raise ScienceDataError(f"region_id inválido: {region_id!r}.")
    region_dir = data_dir / region_id
    objectives_path, photos_path = region_dir / OBJECTIVES_FILE, region_dir / PHOTOS_FILE
    if not objectives_path.is_file() and not photos_path.is_file():
        return None
    try:
        objectives_doc = _ObjectivesFile.model_validate(_read_json(objectives_path))
        photos_doc = _PhotosFile.model_validate(_read_json(photos_path))
    except ValidationError as exc:
        raise ScienceDataError(f"Catálogo científico inválido de {region_id!r}: {exc}") from exc

    for doc_name, doc in ((OBJECTIVES_FILE, objectives_doc), (PHOTOS_FILE, photos_doc)):
        if doc.region_id != region_id:
            raise ScienceDataError(f"{doc_name}: region_id {doc.region_id!r} != {region_id!r}.")
    frame_id = objectives_doc.frame_id
    if photos_doc.frame_id != frame_id:
        raise ScienceDataError("objectives.json y photos.json declaran frame_id distintos.")

    evidence_ids = _unique("evidence_id", [e.evidence_id for e in objectives_doc.evidence])
    objective_ids = _unique("objective_id", [o.objective_id for o in objectives_doc.objectives])
    _unique("photo_id", [p.photo_id for p in photos_doc.photos])

    for evidence in objectives_doc.evidence:
        _check_url(evidence.evidence_id, evidence.source_url)
    for objective in objectives_doc.objectives:
        if objective.region_id != region_id:
            raise ScienceDataError(f"{objective.objective_id}: region_id distinto de la región.")
        _check_frame(objective.objective_id, objective.position, frame_id)
        _check_refs(objective.objective_id, objective.evidence_ids, evidence_ids)
        if not objective.active and not objective.inactive_reason:
            raise ScienceDataError(f"{objective.objective_id}: inactivo sin inactive_reason.")
    for photo in photos_doc.photos:
        if photo.objective_id not in objective_ids:
            raise ScienceDataError(
                f"{photo.photo_id}: objective_id {photo.objective_id!r} no existe."
            )
        if photo.location_quality == "verified" and photo.location is None:
            raise ScienceDataError(f"{photo.photo_id}: 'verified' exige una ubicación.")
        if photo.location is not None:
            _check_frame(photo.photo_id, photo.location, frame_id)
        _check_url(photo.photo_id, photo.image_url)
        _check_url(photo.photo_id, photo.source_url)
        _check_refs(photo.photo_id, photo.evidence_ids, evidence_ids)

    return ScienceCatalog(
        region_id=region_id,
        frame_id=frame_id,
        evidence=tuple(objectives_doc.evidence),
        objectives=tuple(objectives_doc.objectives),
        photos=tuple(photos_doc.photos),
    )


def _read_json(path: Path) -> Mapping[str, Any]:
    if not path.is_file():
        raise ScienceDataError(f"No existe {path.name} para la región.")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScienceDataError(f"{path.name} ilegible: {exc}") from exc
    if not isinstance(document, dict):
        raise ScienceDataError(f"{path.name} debe ser un objeto JSON.")
    return document


def _unique(name: str, values: list[str]) -> frozenset[str]:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ScienceDataError(f"{name} duplicado: {value!r}.")
        seen.add(value)
    return frozenset(seen)


def _check_frame(item_id: str, position: LocalPosition, frame_id: str) -> None:
    if position.frame_id != frame_id:
        raise ScienceDataError(f"{item_id}: frame_id {position.frame_id!r} != {frame_id!r}.")


def _check_refs(item_id: str, refs: list[str], known: frozenset[str]) -> None:
    missing = [ref for ref in refs if ref not in known]
    if missing:
        raise ScienceDataError(f"{item_id}: evidencias inexistentes {missing}.")


def _check_url(item_id: str, url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ScienceDataError(f"{item_id}: la URL debe ser https absoluta ({url!r}).")
    if (parsed.hostname or "").lower() in _FORBIDDEN_HOSTS:
        raise ScienceDataError(f"{item_id}: {parsed.hostname!r} no es una fuente de datos válida.")
