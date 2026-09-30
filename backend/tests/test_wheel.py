"""Spinning, undoing a spin, and adding tickets."""
import json

from conftest import wheel_entry


def read_config(data_dir):
    return json.loads((data_dir / "config.json").read_text(encoding="utf-8"))


def write_config(data_dir, config):
    (data_dir / "config.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Undoing a spin ──────────────────────────────────────────────────────────

def test_undo_puts_the_category_back(client):
    """The bug this guards: "Nie zapisuj" deleted the history row but left the
    category stripped out of the person's column, losing it for good."""
    before = wheel_entry(client, "Xero")
    category = before["categories"][0]

    client.post("/api/wheel/spin", json={"person_key": before["key"], "category": category})
    assert category not in wheel_entry(client, "Xero")["categories"]

    r = client.delete("/api/wheel/last-spin")
    assert r.status_code == 200, r.text
    assert r.json()["category_restored"] is True

    after = wheel_entry(client, "Xero")
    assert category in after["categories"]
    assert sorted(after["categories"]) == sorted(before["categories"])


def test_undo_removes_the_history_entry(client):
    entry = wheel_entry(client, "Xero")
    before = len(client.get("/api/wheel/data").json()["history"])

    client.post("/api/wheel/spin", json={"person_key": entry["key"], "category": "Kosmos"})
    assert len(client.get("/api/wheel/data").json()["history"]) == before + 1

    client.delete("/api/wheel/last-spin")
    assert len(client.get("/api/wheel/data").json()["history"]) == before


def test_undo_restores_the_previous_next_category(client, data_dir):
    config = read_config(data_dir)
    config["next_category"] = {"category": "Poprzednia", "person": "Kaja"}
    write_config(data_dir, config)

    entry = wheel_entry(client, "Xero")
    client.post("/api/wheel/spin", json={"person_key": entry["key"], "category": "Kosmos"})
    assert client.get("/api/wheel/next-category").json()["category"] == "Kosmos"

    client.delete("/api/wheel/last-spin")
    assert client.get("/api/wheel/next-category").json() == {
        "category": "Poprzednia", "person": "Kaja"}


def test_undo_restores_the_next_night_date(client, data_dir):
    config = read_config(data_dir)
    config["next_night_date"] = "2020-01-01"  # in the past, so the spin advances it
    write_config(data_dir, config)

    entry = wheel_entry(client, "Xero")
    client.post("/api/wheel/spin", json={"person_key": entry["key"], "category": "Kosmos"})
    assert read_config(data_dir)["next_night_date"] != "2020-01-01"

    client.delete("/api/wheel/last-spin")
    assert read_config(data_dir)["next_night_date"] == "2020-01-01"


def test_undo_with_no_history_is_a_404(client, data_dir):
    while client.get("/api/wheel/data").json()["history"]:
        assert client.delete("/api/wheel/last-spin").status_code == 200
    assert client.delete("/api/wheel/last-spin").status_code == 404


# ── Adding tickets ──────────────────────────────────────────────────────────

def test_unknown_person_key_is_rejected(client):
    """It used to answer 200 and write nothing, so the UI flashed a green tick
    for a category that was never saved."""
    r = client.post("/api/wheel/categories", json={"categories": {"NieMaTakiego": ["X"]}})
    assert r.status_code == 404
    assert "NieMaTakiego" in r.json()["detail"]


def test_display_name_is_accepted_for_a_raw_column(client):
    r = client.post("/api/wheel/categories", json={"categories": {"Bartosz": ["Sensacja"]}})
    assert r.status_code == 200, r.text
    assert "Sensacja" in wheel_entry(client, "Bartosz")["categories"]


def test_blank_category_is_rejected(client):
    key = wheel_entry(client, "Xero")["key"]
    r = client.post("/api/wheel/categories", json={"categories": {key: ["   "]}})
    assert r.status_code == 400


def test_added_category_changes_the_odds(client):
    before = wheel_entry(client, "Bartosz")
    key = before["key"]
    client.post("/api/wheel/categories", json={"categories": {key: ["Sensacja", "Komedia"]}})
    after = wheel_entry(client, "Bartosz")
    assert after["count"] == before["count"] + 2
    assert after["probability"] > before["probability"]


# ── Spinning ────────────────────────────────────────────────────────────────

def test_spin_clears_a_forced_winner(client, data_dir):
    config = read_config(data_dir)
    config["forced_spin"] = {"person_key": "xero", "category": "Kosmos"}
    write_config(data_dir, config)
    assert client.get("/api/wheel/data").json()["forced_spin"] is not None

    client.post("/api/wheel/spin", json={"person_key": "xero", "category": "Kosmos"})
    assert client.get("/api/wheel/data").json()["forced_spin"] is None


def test_simulation_never_repeats_a_category(client):
    picks = client.get("/api/wheel/simulate?rounds=50").json()["picks"]
    seen = [(p["person"], p["category"]) for p in picks]
    assert len(seen) == len(set(seen))


def test_hidden_people_are_off_the_wheel(client):
    names = [e["name"] for e in client.get("/api/wheel/data").json()["entries"]]
    assert "Stary" not in names
