"""Adapter from Backend 1's validated science catalog to mission objectives."""

from collections.abc import Iterable

from app.modules.catalog.infrastructure.science_loader import ScienceCatalog
from app.modules.missions.planning.models import MissionObjective
from app.modules.missions.planning.objectives import InMemoryObjectiveRepository
from app.modules.missions.terrain import LocalPosition


def objective_repository_from_catalogs(
    catalogs: Iterable[ScienceCatalog],
) -> InMemoryObjectiveRepository:
    return InMemoryObjectiveRepository(
        MissionObjective(
            objective_id=objective.objective_id,
            region_id=objective.region_id,
            title=objective.title,
            position=LocalPosition(
                objective.position.x_m,
                objective.position.y_m,
                objective.position.frame_id,
            ),
            activities=tuple(objective.activities),
            evidence_ids=tuple(objective.evidence_ids),
            possible_findings=tuple(objective.possible_findings),
        )
        for catalog in catalogs
        for objective in catalog.objectives
    )
