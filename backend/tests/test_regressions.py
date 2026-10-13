import pytest
import main
from excel.scores import get_all_nights, save_session


@pytest.mark.parametrize("row", [1, 4, 9999])
def test_admin_cannot_edit_or_delete_non_movie_rows(client, admin_token, data_dir, row):
    before = (data_dir / "scores.xlsx").read_bytes()
    headers = {"Authorization": admin_token}
    assert client.put("/api/admin/scores/edit", headers=headers, json={
        "season": 4, "row_num": row, "person": "Xero", "score": 8,
    }).status_code == 404
    assert client.request("DELETE", "/api/admin/scores/movie", headers=headers,
                          json={"season": 4, "row_num": row}).status_code == 404
    assert (data_dir / "scores.xlsx").read_bytes() == before


def test_removing_final_score_keeps_legacy_movie(client, admin_token):
    for person in ["Xero", "Kaja", "Bartosz", "Stary"]:
        response = client.put("/api/admin/scores/edit", headers={"Authorization": admin_token}, json={
            "season": 4, "row_num": 5, "person": person, "score": None,
        })
        assert response.status_code == 200, response.text
    night = get_all_nights()[-1]
    assert night["movies"][0]["title"] == "Stary Film"
    assert night["movies"][0]["scores"] == {}


def test_alias_scores_average_matches_written_values():
    save_session(["Film"], "Nowa", {"Film": {"bart": 2, "Bartosz": 10, "Xero": 6}},
                 ["bart", "Bartosz", "Xero"])
    movie = get_all_nights()[-1]["movies"][0]
    assert movie["scores"] == {"Xero": 6, "bart": 10}
    assert movie["average"] == 8


def test_session_without_theme_is_a_separate_night(client):
    count = len(get_all_nights())
    response = client.post('/api/scores/session', json={
        'movies': [' Film '], 'category': '', 'present_people': ['Bartosz'],
        'scores': {' Film ': {'bart': 9}},
    })
    assert response.status_code == 200
    nights = get_all_nights()
    assert len(nights) == count + 1
    assert nights[-1]['movies'][0]['title'] == 'Film'
    assert nights[-1]['movies'][0]['scores'] == {'bart': 9}
    assert client.get('/api/wheel/data').json()['eligible_people'] == ['Bartosz']


def test_partial_reorder_does_not_delete_history(client, admin_token, data_dir):
    before = (data_dir / "spread.xlsx").read_bytes()
    response = client.put("/api/admin/wheel/history/reorder", headers={"Authorization": admin_token},
                          json={"row_indices": []})
    assert response.status_code == 400
    assert (data_dir / "spread.xlsx").read_bytes() == before


def test_admin_cannot_overwrite_history_needed_for_undo(client, admin_token):
    draw = client.post("/api/wheel/draw", json={"mode": "single"}).json()
    row = client.get("/api/wheel/data").json()["history"][-1]["row_index"]
    headers = {"Authorization": admin_token}
    assert client.post("/api/admin/wheel/history", headers=headers,
                       json={"person": "Kaja", "category": "Ręczny"}).status_code == 409
    assert client.put("/api/admin/wheel/history", headers=headers,
                      json={"row_index": row, "person": "Kaja", "category": "Zmiana"}).status_code == 409
    assert client.request("DELETE", "/api/admin/wheel/history", headers=headers,
                          json={"row_index": row}).status_code == 409
    assert client.delete(f'/api/wheel/last-spin?draw_id={draw["id"]}').status_code == 200


def test_rename_updates_all_aliases_and_rejects_name_collision(client, admin_token):
    headers = {"Authorization": admin_token}
    assert client.put("/api/admin/people/rename", headers=headers,
                      json={"old_name": "Bartosz", "new_name": "Bartek"}).status_code == 200
    names = client.get("/api/scores/people").json()
    assert "Bartek" in names and "Bartosz" not in names
    entry = next(e for e in client.get("/api/wheel/data").json()["entries"] if e["key"] == "bart")
    assert entry["name"] == "Bartek"
    assert client.put("/api/admin/people/rename", headers=headers,
                      json={"old_name": "Bartek", "new_name": "Kaja"}).status_code == 409


def test_long_password_is_rejected_without_server_error(client):
    assert client.post("/api/admin/login", json={"password": "ą" * 100}).status_code == 403


def test_static_fallback_does_not_expose_parent_files(client, tmp_path, monkeypatch):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("app")
    (tmp_path / "secret.txt").write_text("secret")
    monkeypatch.setattr(main, "_static_dir", static)
    assert client.get("/history").text == "app"
    assert client.get("/api/nonexistent").status_code == 404
    assert client.get("/%2e%2e/secret.txt").status_code == 404


def test_missing_frontend_returns_404(client, monkeypatch):
    monkeypatch.setattr(main, "_static_dir", None)
    assert client.get("/").status_code == 404
