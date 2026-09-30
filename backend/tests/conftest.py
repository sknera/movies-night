import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# DATA_DIR is read when the modules are first imported, so it has to be set
# before anything under backend/ is pulled in. The directory stays the same for
# the whole run; the files inside it are rebuilt before every test.
_TMP = Path(tempfile.mkdtemp(prefix="movienight-tests-"))
os.environ["DATA_DIR"] = str(_TMP)

import fixtures  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_data():
    """Every test starts from an identical, disposable data/ directory."""
    fixtures.build_all(_TMP)
    yield _TMP


@pytest.fixture
def data_dir():
    return _TMP


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_token(client):
    r = client.post("/api/admin/login", json={"password": fixtures.ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def wheel_entry(client, name: str) -> dict:
    """The /wheel/data entry for a display name."""
    entries = client.get("/api/wheel/data").json()["entries"]
    match = next((e for e in entries if e["name"] == name), None)
    assert match is not None, f"{name} not on the wheel: {[e['name'] for e in entries]}"
    return match
