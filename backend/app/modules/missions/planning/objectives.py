"""Objective lookup boundary used by the mission planner."""

from collections.abc import Iterable
from typing import Protocol

from app.modules.missions.planning.models import MissionObjective


class ObjectiveRepository(Protocol):
    def get_objective(self, region_id: str, objective_id: str) -> MissionObjective | None: ...


class InMemoryObjectiveRepository:
    def __init__(self, objectives: Iterable[MissionObjective]) -> None:
        self._objectives: dict[tuple[str, str], MissionObjective] = {}
        for objective in objectives:
            key = (objective.region_id, objective.objective_id)
            if key in self._objectives:
                raise ValueError(f"Duplicate objective: {key!r}")
            self._objectives[key] = objective

    def get_objective(self, region_id: str, objective_id: str) -> MissionObjective | None:
        return self._objectives.get((region_id, objective_id))
