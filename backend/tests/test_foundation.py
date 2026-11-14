from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.main import create_app


def test_health_and_openapi():
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "api_version": "v1"}
        assert "/api/v1/health" in client.get("/openapi.json").json()["paths"]


def test_missing_route_and_wrong_method_have_error_envelope():
    with TestClient(create_app()) as client:
        for response, status in [
            (client.get("/api/v1/missing"), 404),
            (client.post("/api/v1/health"), 405),
        ]:
            assert response.status_code == status
            error = response.json()["error"]
            assert error["code"] == f"HTTP_{status}"
            assert error["details"] == {}
            UUID(error["request_id"])


def test_validation_and_exception_handlers_on_future_routes():
    application = create_app()

    class Payload(BaseModel):
        quantity: int

    @application.post("/test/validation")
    def validate(payload: Payload):
        return payload

    @application.get("/test/conflict")
    def conflict():
        raise HTTPException(409, "Versión desactualizada", headers={"X-Test": "preserved"})

    @application.get("/test/failure")
    def fail():
        raise RuntimeError("internal-secret")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.post("/test/validation", json={"quantity": "private-input"})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        assert response.json()["error"]["details"]["issues"][0]["location"] == ["body", "quantity"]
        assert "private-input" not in response.text
        response = client.get("/test/conflict")
        assert response.status_code == 409
        assert response.headers["X-Test"] == "preserved"
        assert response.json()["error"]["message"] == "Versión desactualizada"
        response = client.get("/test/failure")
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "INTERNAL_ERROR"
        assert "internal-secret" not in response.text
