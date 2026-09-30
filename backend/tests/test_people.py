"""/scores/people is what the scoring screen builds its columns from."""


def test_people_are_canonical_not_raw_headers(client):
    people = client.get("/api/scores/people").json()
    # "bart" is the sheet header; "Bartosz" is who that is.
    assert "Bartosz" in people
    assert "bart" not in people


def test_hidden_people_are_excluded(client):
    people = client.get("/api/scores/people").json()
    assert "Stary" not in people


def test_no_duplicates(client):
    people = client.get("/api/scores/people").json()
    assert len(people) == len(set(people))


def test_colours_line_up_with_stats(client):
    """The scoring screen colours its columns from /scores/stats, so the two
    endpoints have to agree on how a person is named."""
    people = set(client.get("/api/scores/people").json())
    stats = {s["name"] for s in client.get("/api/scores/stats").json()}
    assert people <= stats, f"no colour available for {people - stats}"


def test_hiding_a_person_removes_them_from_scoring(client, admin_token):
    assert "Kaja" in client.get("/api/scores/people").json()
    client.put("/api/admin/people/hide", json={"name": "Kaja"},
               headers={"authorization": admin_token})
    assert "Kaja" not in client.get("/api/scores/people").json()
