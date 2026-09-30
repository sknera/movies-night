"""The evening, end to end.

Two movies get written down, everyone scores both, everyone adds a ticket for
the next category, the wheel is spun, and the winner becomes next_category.
"""
from conftest import wheel_entry


def score_night(client, movies, category, people, scores=None):
    payload = {
        "movies": movies,
        "category": category,
        "present_people": people,
        "scores": scores or {
            m: {p: 7.0 + i for i, p in enumerate(people)} for m in movies
        },
    }
    return client.post("/api/scores/session", json=payload)


def test_full_movie_night(client):
    people = client.get("/api/scores/people").json()
    assert people

    # 1. Two movies, everyone scores both.
    r = score_night(client, ["Film Jeden", "Film Dwa"], "Horrory", people)
    assert r.status_code == 200, r.text

    nights = client.get("/api/scores/nights").json()
    last = nights[-1]
    assert last["name"] == "Horrory"
    assert [m["title"] for m in last["movies"]] == ["Film Jeden", "Film Dwa"]
    for movie in last["movies"]:
        assert set(movie["scores"]) == set(people)

    # 2. Everyone adds a ticket for the next draw.
    xero = wheel_entry(client, "Xero")
    r = client.post("/api/wheel/categories",
                    json={"categories": {xero["key"]: ["Polskie kino"]}})
    assert r.status_code == 200, r.text
    assert "Polskie kino" in wheel_entry(client, "Xero")["categories"]

    # 3. Spin, and the winner becomes the next night's category.
    r = client.post("/api/wheel/spin",
                    json={"person_key": xero["key"], "category": "Polskie kino"})
    assert r.status_code == 200, r.text
    nxt = client.get("/api/wheel/next-category").json()
    assert nxt == {"category": "Polskie kino", "person": "Xero"}

    # A drawn category leaves the wheel, so it cannot come up twice.
    assert "Polskie kino" not in wheel_entry(client, "Xero")["categories"]


def test_absent_people_get_no_score(client):
    people = client.get("/api/scores/people").json()
    present = people[:1]
    absent = people[1:]
    assert absent

    # The payload still carries a score for someone who went home; the server
    # is what decides who was actually there.
    scores = {"Film X": {p: 8.0 for p in people}}
    r = score_night(client, ["Film X"], "Testowa", present, scores)
    assert r.status_code == 200, r.text

    night = client.get("/api/scores/nights").json()[-1]
    written = night["movies"][0]["scores"]
    assert set(written) == set(present)
    for person in absent:
        assert person not in written


def test_duplicate_movie_titles_are_rejected(client):
    people = client.get("/api/scores/people").json()
    r = score_night(client, ["Ten Sam", "Ten Sam"], "Testowa", people)
    assert r.status_code == 400
    assert "Ten Sam" in r.json()["detail"]


def test_session_needs_at_least_one_movie(client):
    people = client.get("/api/scores/people").json()
    r = score_night(client, ["   "], "Testowa", people)
    assert r.status_code == 400


def test_scoring_a_night_clears_next_category(client):
    xero = wheel_entry(client, "Xero")
    client.post("/api/wheel/spin", json={"person_key": xero["key"], "category": "Kosmos"})
    assert client.get("/api/wheel/next-category").json()["category"] == "Kosmos"

    people = client.get("/api/scores/people").json()
    score_night(client, ["Film Kosmiczny"], "Kosmos", people)
    assert client.get("/api/wheel/next-category").json() is None


def test_scoring_retires_a_hand_typed_category(client):
    """A category typed straight into the scoring screen, never spun for."""
    assert "Musicale" in wheel_entry(client, "Kaja")["categories"]

    people = client.get("/api/scores/people").json()
    r = score_night(client, ["Chicago"], "Musicale", people)
    assert r.status_code == 200, r.text

    assert "Musicale" not in wheel_entry(client, "Kaja")["categories"]


def test_category_without_an_owner_does_not_crash(client):
    people = client.get("/api/scores/people").json()
    r = score_night(client, ["Coś Innego"], "Kategoria spoza koła", people)
    assert r.status_code == 200, r.text
    assert client.get("/api/scores/nights").json()[-1]["name"] == "Kategoria spoza koła"
