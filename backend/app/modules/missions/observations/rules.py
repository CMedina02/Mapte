"""Explicit, conservative adaptation rules for scientific observations."""

from dataclasses import dataclass
from enum import StrEnum

from app.modules.missions.planning import MissionObjective


class ObservationAction(StrEnum):
    COMPLETE_AND_PRESERVE_ORDER = "complete_and_preserve_order"


@dataclass(frozen=True, slots=True)
class ObservationDecision:
    finding_code: str
    action: ObservationAction
    reason: str


class InvalidFindingError(ValueError):
    """The finding is not valid for the selected objective."""


class ObservationRuleNotConfiguredError(ValueError):
    """A catalog finding has no approved mission-adaptation rule."""


_PRESERVE_ORDER_CODES = frozenset(
    {
        "HEMATITE_DETECTED",
        "COARSE_HEMATITE_ONLY",
        "DIAGENETIC_ALTERATION_OBSERVED",
        "NO_HEMATITE_DETECTED",
        "CLAY_MINERALS_DETECTED",
        "FE_CARBONATE_DETECTED",
        "NO_CLAY_ENRICHMENT",
        "ELEMENTAL_SULFUR_DETECTED",
        "SULFATE_ONLY",
        "NO_SULFUR_PHASE",
        "TRIDYMITE_DETECTED",
        "HIGH_SILICA_AMORPHOUS",
        "NO_TRIDYMITE_DETECTED",
    }
)


def decide_observation(objective: MissionObjective, finding_code: str) -> ObservationDecision:
    if finding_code not in objective.possible_findings:
        raise InvalidFindingError(
            f"Finding {finding_code!r} is not allowed for {objective.objective_id!r}"
        )
    if finding_code not in _PRESERVE_ORDER_CODES:
        raise ObservationRuleNotConfiguredError(
            f"Finding {finding_code!r} has no approved adaptation rule"
        )
    return ObservationDecision(
        finding_code=finding_code,
        action=ObservationAction.COMPLETE_AND_PRESERVE_ORDER,
        reason=(
            "Finding recorded with a validated code; the remaining order is kept because "
            "there is no approved science rule to prioritize another objective."
        ),
    )
