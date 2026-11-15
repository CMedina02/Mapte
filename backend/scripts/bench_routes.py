"""Mide el tiempo del buscador de rutas con el terreno real (Monte Sharp).

Uso (desde backend/):  .venv/Scripts/python.exe scripts/bench_routes.py [--all]
--all agrega una ruta imposible (sin el límite de búsqueda, puede tardar minutos).
"""

import sys
import time

from fastapi.testclient import TestClient

from app.main import app

F = "MARS_GALE_MS_LOCAL_V1"
REGION = "mc23-gale-mount-sharp"


def pos(x: float, y: float) -> dict:
    return {"x_m": x, "y_m": y, "frame_id": F}


CASES = [
    ("corta (~1 km)", pos(5523.3, 2882.8), pos(5300, 3700), 15, True),
    ("larga Gediz→Glen (~4 km)", pos(5523.3, 2882.8), pos(4034.4, 6417.9), 15, True),
    ("cruza las dunas", pos(4950, 5350), pos(5900, 5350), 25, False),
    ("muy larga Gediz→Marias (~7 km)", pos(5523.3, 2882.8), pos(3245.3, 9859.0), 15, True),
]
IMPOSSIBLE = ("imposible (pendiente 1°)", pos(5523.3, 2882.8), pos(4034.4, 6417.9), 1, True)


def main() -> None:
    cases = CASES + ([IMPOSSIBLE] if "--all" in sys.argv else [])
    with TestClient(app) as client:
        for name, start, end, slope, avoid in cases:
            body = {
                "region_id": REGION,
                "start": start,
                "end": end,
                "constraints": {
                    "max_slope_deg": slope,
                    "speed_m_per_min": 20,
                    "avoid_unknown": avoid,
                },
            }
            t0 = time.perf_counter()
            result = client.post("/api/v1/routes/compute", json=body).json()
            elapsed = time.perf_counter() - t0
            distance = result.get("distance_m")
            print(
                f"{name:34s} {elapsed:7.2f} s  {result.get('status', result):12s} "
                f"{(round(distance) if distance else '-')!s:>6} m  {result.get('warnings')}"
            )


if __name__ == "__main__":
    main()
