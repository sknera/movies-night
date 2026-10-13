"""Someone new turns up at movie night."""
from conftest import wheel_entry


def test_new_person_reaches_the_scoring_screen(client):
    assert "Zosia" not in client.get("/api/scores/people").json()

    r = client.post("/api/wheel/person", json={"name": "Zosia"})
    assert r.status_code == 200, r.text
    assert r.json()["created_scores"] is True
    assert r.json()["created_wheel"] is True

    assert "Zosia" in client.get("/api/scores/people").json()


def test_new_person_reaches_the_wheel_with_no_categories(client):
    client.post("/api/wheel/person", json={"name": "Zosia"})
    entry = wheel_entry(client, "Zosia")
    assert entry["categories"] == []
    assert entry["count"] == 0


def test_new_person_can_be_given_categories_immediately(client):
    client.post("/api/wheel/person", json={"name": "Zosia"})
    key = wheel_entry(client, "Zosia")["key"]

    r = client.post("/api/wheel/categories", json={"categories": {key: ["Kino drogi"]}})
    assert r.status_code == 200, r.text
    assert wheel_entry(client, "Zosia")["categories"] == ["Kino drogi"]


def test_new_person_gets_a_colour_of_their_own(client):
    r = client.post("/api/wheel/person", json={"name": "Zosia"})
    color = r.json()["color"]
    assert color.startswith("#") and len(color) == 7

    taken = {s["color"] for s in client.get("/api/scores/stats").json() if s["name"] != "Zosia"}
    assert color not in taken


def test_two_new_people_get_different_colours(client):
    first = client.post("/api/wheel/person", json={"name": "Zosia"}).json()["color"]
    second = client.post("/api/wheel/person", json={"name": "Franek"}).json()["color"]
    assert first != second


def test_adding_twice_does_not_create_a_second_column(client):
    client.post("/api/wheel/person", json={"name": "Zosia"})
    again = client.post("/api/wheel/person", json={"name": "Zosia"}).json()
    assert again["created_scores"] is False
    assert again["created_wheel"] is False
    assert client.get("/api/scores/people").json().count("Zosia") == 1


def test_new_person_scores_land_in_the_sheet(client):
    client.post("/api/wheel/person", json={"name": "Zosia"})
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


def test_public_add_cannot_restore_hidden_person(client, data_dir):
    assert "Stary" not in client.get("/api/scores/people").json()
    before = {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}
    for name in ('Stary', 'stary', ' STARY '):
        assert client.post("/api/wheel/person", json={"name": name}).status_code == 403
    assert "Stary" not in client.get("/api/scores/people").json()
    assert before == {p.name: p.read_bytes() for p in data_dir.iterdir() if p.suffix in ('.json', '.xlsx')}


def test_admin_add_also_unhides(client, admin_token):
    """The admin route used to skip the unhide, leaving the person invisible."""
    r = client.post("/api/admin/people", json={"name": "Stary"},
                    headers={"authorization": admin_token})
    assert r.status_code == 200, r.text
    assert "Stary" in client.get("/api/scores/people").json()


def test_blank_name_is_rejected(client):
    assert client.post("/api/wheel/person", json={"name": "   "}).status_code == 400


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
