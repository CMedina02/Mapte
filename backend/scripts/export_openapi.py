"""Export the application OpenAPI document to the shared canonical contract."""

import json
from pathlib import Path

from app.main import create_app


def main() -> None:
    destination = Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml"
    document = create_app().openapi()
    destination.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
