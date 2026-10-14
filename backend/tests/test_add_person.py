"""Someone new turns up at movie night.

Adding a person writes a column to both workbooks, so the route is behind the
admin password. The UI asks for it in place (on the scoring screen and on the
wheel) instead of sending people to the admin panel.
"""
from conftest import wheel_entry


def test_new_person_reaches_the_scoring_screen(client, admin_headers):
    assert "Zosia" not in client.get("/api/scores/people").json()

    r = client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["created_scores"] is True
    assert r.json()["created_wheel"] is True

    assert "Zosia" in client.get("/api/scores/people").json()


def test_new_person_reaches_the_wheel_with_no_categories(client, admin_headers):
    client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    entry = wheel_entry(client, "Zosia")
    assert entry["categories"] == []
    assert entry["count"] == 0


def test_new_person_can_be_given_categories_immediately(client, admin_headers):
    client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    key = wheel_entry(client, "Zosia")["key"]

    r = client.post("/api/wheel/categories", json={"categories": {key: ["Kino drogi"]}})
    assert r.status_code == 200, r.text
    assert wheel_entry(client, "Zosia")["categories"] == ["Kino drogi"]


def test_new_person_gets_a_colour_of_their_own(client, admin_headers):
    r = client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    color = r.json()["color"]
    assert color.startswith("#") and len(color) == 7

    taken = {s["color"] for s in client.get("/api/scores/stats").json() if s["name"] != "Zosia"}
    assert color not in taken


def test_two_new_people_get_different_colours(client, admin_headers):
    first = client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers).json()["color"]
    second = client.post("/api/wheel/person", json={"name": "Franek"}, headers=admin_headers).json()["color"]
    assert first != second


def test_adding_twice_does_not_create_a_second_column(client, admin_headers):
    client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    again = client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers).json()
    assert again["created_scores"] is False
    assert again["created_wheel"] is False
    assert client.get("/api/scores/people").json().count("Zosia") == 1


def test_new_person_scores_land_in_the_sheet(client, admin_headers):
    client.post("/api/wheel/person", json={"name": "Zosia"}, headers=admin_headers)
    people = client.get("/api/scores/people").json()
    assert "Zosia" in people

    r = client.post("/api/scores/session", json={
        "movies": ["Debiut"],
        "category": "Powitalna",
        "present_people": people,
        "scores": {"Debiut": {p: 8.0 for p in people}},
    })
    assert r.status_code == 200, r.text

    night = client.get("/api/scores/nights").json()[-1]
    assert night["movies"][0]["scores"]["Zosia"] == 8.0


def test_adding_a_person_requires_the_admin_password(client, data_dir):
    """Without this the UI prompt would be decoration: Traefik only gates
    non-GET requests when Authelia is in front, and that gate is not reliable."""
    before = {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}

    assert client.post("/api/wheel/person", json={"name": "Zosia"}).status_code == 401
    assert client.post("/api/wheel/person", json={"name": "Zosia"},
                       headers={"authorization": "invalid"}).status_code == 401

    assert "Zosia" not in client.get("/api/scores/people").json()
    assert before == {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}


def test_add_cannot_restore_hidden_person_even_as_admin(client, data_dir, admin_headers):
    """Unhiding goes through /resurface, so a plain add must not do it silently."""
    assert "Stary" not in client.get("/api/scores/people").json()
    before = {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}
    for name in ('Stary', 'stary', ' STARY '):
        assert client.post("/api/wheel/person", json={"name": name},
                           headers=admin_headers).status_code == 403
    assert "Stary" not in client.get("/api/scores/people").json()
    assert before == {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}


def test_admin_add_also_unhides(client, admin_token):
    """The admin route used to skip the unhide, leaving the person invisible."""
    r = client.post("/api/admin/people", json={"name": "Stary"},
                    headers={"authorization": admin_token})
    assert r.status_code == 200, r.text
    assert "Stary" in client.get("/api/scores/people").json()


def test_blank_name_is_rejected(client, admin_headers):
    assert client.post("/api/wheel/person", json={"name": "   "}, headers=admin_headers).status_code == 400


def test_resurface_lists_people_who_left_the_wheel(client, admin_token):
    client.put("/api/admin/people/hide", json={"name": "Kaja"},
               headers={"authorization": admin_token})
    headers = {"authorization": admin_token}
    assert client.get("/api/wheel/candidates").status_code == 401
    assert client.post("/api/wheel/resurface", json={"name": "Kaja"}).status_code == 401
    assert client.post("/api/wheel/resurface", json={"name": "Kaja"}, headers={"authorization": "invalid"}).status_code == 401
    names = [c["name"] for c in client.get("/api/wheel/candidates", headers=headers).json()]
    assert "Kaja" in names

    assert client.post("/api/wheel/resurface", json={"name": "Kaja"}, headers=headers).status_code == 200
    assert "Kaja" in client.get("/api/scores/people").json()
