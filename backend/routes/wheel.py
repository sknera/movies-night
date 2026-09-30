import random
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from excel.wheel import (
    get_wheel_data, add_categories, record_spin, delete_history_entry,
    add_person_to_wheel, restore_category, UnknownPersonError,
)
from config import (
    get_hidden_people, normalize_name, get_person_color, load_config, save_config,
    ensure_person_color,
)

router = APIRouter()

def _compute_weights(raw_data: dict) -> list:
    categories = raw_data["categories"]
    hidden = get_hidden_people()

    # Merge columns that share the same display name (handles duplicate spreadsheet columns)
    merged: dict[str, dict] = {}
    for key, cats in categories.items():
        display = normalize_name(key)
        if display in hidden:
            continue
        if display not in merged:
            merged[display] = {
                "key": key,
                "name": display,
                "categories": list(cats),
                "color": get_person_color(display),
            }
        else:
            merged[display]["categories"].extend(cats)

    entries = []
    for entry in merged.values():
        weight = len(entry["categories"])
        entry["count"] = weight
        entry["weight"] = weight
        entries.append(entry)

    total = sum(e["weight"] for e in entries)
    for e in entries:
        e["probability"] = round(e["weight"] / total, 4) if total > 0 else (round(1 / len(entries), 4) if entries else 0)

    return entries


@router.get("/data")
def get_data():
    raw = get_wheel_data()
    entries = _compute_weights(raw)
    config = load_config()
    return {
        "entries": entries,
        "history": raw["history"],
        "next_category": config.get("next_category", None),
        "forced_spin": config.get("forced_spin", None),
    }


@router.get("/next-category")
def get_next_category():
    return load_config().get("next_category", None)


@router.get("/next-night-date")
def get_next_night_date():
    config = load_config()
    date_str = config.get("next_night_date")
    if date_str:
        try:
            d = date.fromisoformat(date_str)
            today = date.today()
            if d < today:
                while d < today:
                    d += timedelta(weeks=2)
                config["next_night_date"] = d.isoformat()
                save_config(config)
                date_str = d.isoformat()
        except ValueError:
            pass
    return {"date": date_str, "time": config.get("next_night_time", None)}


@router.get("/last-spin")
def get_last_spin():
    raw = get_wheel_data()
    history = raw["history"]
    return {"spin": history[-1] if history else None}


@router.delete("/last-spin")
def delete_last_spin():
    raw = get_wheel_data()
    history = raw["history"]
    if not history:
        raise HTTPException(404, "Brak historii")
    last = history[-1]
    delete_history_entry(last["row_index"])
    # record_spin() removed the category from the person's column; without
    # this the "Nie zapisuj" button would destroy the category for good.
    restored = restore_category(last["person"], last["category"])

    config = load_config()
    undo = config.pop("last_spin_undo", None)
    if undo is not None:
        # Put back exactly what the spin changed.
        for key in ("next_category", "next_night_date"):
            if undo.get(key) is not None:
                config[key] = undo[key]
            else:
                config.pop(key, None)
    else:
        # Spins recorded before undo snapshots existed.
        nc = config.get("next_category")
        if nc and nc.get("category", "").lower() == last["category"].lower():
            config.pop("next_category", None)
    save_config(config)
    return {
        "ok": True,
        "removed": {"person": last["person"], "category": last["category"]},
        "category_restored": restored,
    }


class AddPersonPayload(BaseModel):
    name: str


def _ensure_person(name: str) -> dict:
    """Make sure `name` has a scores column, a wheel column and a name_map entry,
    and is not hidden. Safe to call repeatedly."""
    from excel.scores import add_person_to_scores
    created_scores = add_person_to_scores(name)
    created_wheel = add_person_to_wheel(name)
    config = load_config()
    config.setdefault("name_map", {})[name.lower()] = name
    config["hidden_people"] = [p for p in config.get("hidden_people", []) if p != name]
    save_config(config)
    # A new person with no colour renders in the same default purple as every
    # other new person, which makes the scoring columns unreadable.
    color = ensure_person_color(name)
    return {"created_scores": created_scores, "created_wheel": created_wheel, "color": color}


@router.post("/person")
def add_person_public(payload: AddPersonPayload):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    try:
        return {"ok": True, **_ensure_person(name)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/candidates")
def list_candidates():
    """People known from any season (or explicitly hidden) who are not currently
    shown on the wheel -- the pool for 'dodaj do czesto pojawiajacych sie osob'."""
    from excel.scores import get_all_header_people
    config = load_config()
    hidden = config.get("hidden_people", [])

    on_wheel = {normalize_name(k) for k in get_wheel_data()["categories"].keys()}
    on_wheel -= set(hidden)

    seen: dict[str, dict] = {}
    for raw in get_all_header_people():
        display = normalize_name(raw)
        if display in on_wheel or display in seen:
            continue
        seen[display] = {"name": display, "hidden": display in hidden}
    for name in hidden:
        if name not in seen and name not in on_wheel:
            seen[name] = {"name": name, "hidden": True}

    return sorted(seen.values(), key=lambda p: p["name"].lower())


@router.post("/resurface")
def resurface_person(payload: AddPersonPayload):
    """Bring a previously-known person back onto the wheel."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    try:
        return {"ok": True, **_ensure_person(name)}
    except Exception as e:
        raise HTTPException(500, str(e))


class AddCategoriesPayload(BaseModel):
    categories: dict[str, list[str]]


@router.post("/categories")
def add_cats(payload: AddCategoriesPayload):
    if not payload.categories:
        raise HTTPException(400, "Brak kategorii do dodania")
    try:
        written = add_categories(payload.categories)
    except UnknownPersonError as e:
        raise HTTPException(404, f"Nie znaleziono osoby na kole: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))
    if not sum(written.values()):
        raise HTTPException(400, "Pusta kategoria")
    return {"ok": True, "written": written}


@router.get("/simulate")
def simulate_spins(rounds: int = 20):
    raw = get_wheel_data()
    entries = _compute_weights(raw)
    config = load_config()

    # Build flat pool: one entry per (person, category) pair with its weight
    pool: list[dict] = []
    for entry in entries:
        for cat in entry["categories"]:
            pool.append({"person": entry["name"], "category": cat, "weight": entry["weight"]})

    results = []
    remaining = list(pool)

    # If a forced winner is set, it goes first
    forced = config.get("forced_spin")
    if forced:
        forced_person = normalize_name(forced.get("person_key", "")) or forced.get("person_key", "")
        forced_cat = forced.get("category", "")
        results.append({"person": forced_person, "category": forced_cat})
        remaining = [item for item in remaining if not (item["person"] == forced_person and item["category"] == forced_cat)]

    for _ in range(min(rounds - len(results), len(remaining))):
        weights = [item["weight"] for item in remaining]
        chosen = random.choices(remaining, weights=weights, k=1)[0]
        results.append({"person": chosen["person"], "category": chosen["category"]})
        remaining = [item for item in remaining if not (item["person"] == chosen["person"] and item["category"] == chosen["category"])]

    return {"picks": results}


class SpinPayload(BaseModel):
    person_key: str
    category: str


@router.post("/spin")
def spin(payload: SpinPayload):
    try:
        record_spin(payload.person_key, payload.category)
        config = load_config()
        # Snapshot of everything this spin is about to change, so "Nie zapisuj"
        # can put the previous night back rather than just dropping it.
        config["last_spin_undo"] = {
            "next_category": config.get("next_category"),
            "next_night_date": config.get("next_night_date"),
        }
        config["next_category"] = {
            "category": payload.category,
            "person": normalize_name(payload.person_key),
        }
        config.pop("forced_spin", None)
        # Auto-advance next night date by 2 weeks, but only if the date has arrived
        current_date_str = config.get("next_night_date")
        if current_date_str:
            try:
                current = date.fromisoformat(current_date_str)
                if current <= date.today():
                    config["next_night_date"] = (current + timedelta(weeks=2)).isoformat()
            except ValueError:
                pass
        save_config(config)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
