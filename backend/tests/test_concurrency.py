"""Two phones writing at once must not lose one of the writes.

Each write is a read-modify-write of a whole workbook, so without the lock the
second save overwrites whatever the first one added.
"""
from concurrent.futures import ThreadPoolExecutor

from conftest import wheel_entry


def test_parallel_category_adds_all_survive(client):
    key = wheel_entry(client, "Bartosz")["key"]
    wanted = [f"Kategoria {i}" for i in range(8)]

    def add(cat):
        return client.post("/api/wheel/categories",
                           json={"categories": {key: [cat]}}).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(add, wanted)) == {200}

    got = wheel_entry(client, "Bartosz")["categories"]
    missing = [c for c in wanted if c not in got]
    assert not missing, f"lost writes: {missing}"


def test_parallel_person_adds_all_survive(client):
    names = [f"Osoba{i}" for i in range(6)]

    def add(name):
        return client.post("/api/wheel/person", json={"name": name}).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert set(pool.map(add, names)) == {200}

    people = client.get("/api/scores/people").json()
    assert not [n for n in names if n not in people]
    # And nobody got two columns.
    for name in names:
        assert people.count(name) == 1


def test_config_stays_valid_json_under_parallel_writes(client, data_dir):
    import json

    def touch(i):
        return client.post("/api/wheel/person", json={"name": f"Ktos{i}"}).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(touch, range(6)))

    json.loads((data_dir / "config.json").read_text(encoding="utf-8"))
