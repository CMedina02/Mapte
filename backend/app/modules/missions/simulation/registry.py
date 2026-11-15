"""In-memory store of running simulations (demo only; lost on restart)."""

from collections import OrderedDict
from threading import Lock

from app.modules.missions.simulation.engine import EvaSimulation

MAX_SIMULATIONS = 20


class SimulationRegistry:
    def __init__(self, limit: int = MAX_SIMULATIONS) -> None:
        self._items: OrderedDict[str, EvaSimulation] = OrderedDict()
        self._limit = limit
        self.lock = Lock()  # serializa creación y pasos; las peticiones sync corren en hilos

    def add(self, simulation: EvaSimulation) -> None:
        with self.lock:
            self._items[simulation.sim_id] = simulation
            while len(self._items) > self._limit:
                self._items.popitem(last=False)

    def get(self, sim_id: str) -> EvaSimulation | None:
        return self._items.get(sim_id)

    def remove(self, sim_id: str) -> bool:
        with self.lock:
            return self._items.pop(sim_id, None) is not None
