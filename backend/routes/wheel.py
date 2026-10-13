import random
from typing import Literal
from uuid import uuid4
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query, Header
from auth import require_admin
from pydantic import BaseModel
from excel.wheel import (
    get_wheel_data, add_categories, record_spin, delete_history_entry,
    add_person_to_wheel, restore_category, UnknownPersonError,
    WHEEL_PATH, _norm,
)
from excel.locking import locked
from excel.scores import get_last_night_people
from drawing import recent_hosts, recency
from config import (
    get_hidden_people, normalize_name, get_person_color, load_config, save_config,
    ensure_person_color,
    CONFIG_PATH,
)

router = APIRouter()

def _compute_weights(raw_data: dict, nights: list[set[str]] | None = None) -> list:
    categories = raw_data["categories"]
    hidden = get_hidden_people()
    nights = recent_hosts(raw_data) if nights is None else nights

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

    initial_penalty = load_config().get("draw_initial_penalty", 0.5)
    entries = []
    for entry in merged.values():
        entry["count"] = len(entry["categories"])
        age, multiplier = recency(entry["name"], nights, initial_penalty)
        entry["nights_ago"] = age
        entry["recency_multiplier"] = multiplier
        entry["weight"] = entry["count"] * multiplier
        entries.append(entry)

    total = sum(e["weight"] for e in entries)
    for e in entries:
        e["probability"] = e["weight"] / total if total > 0 else 0

    return entries


@router.get("/data")
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def get_data():
    raw = get_wheel_data()
    entries = _compute_weights(raw)
    config = load_config()
    return {
        "entries": entries,
        "history": raw["history"],
        "next_category": config.get("next_category", None),
        "forced_spin": config.get("forced_spin", None),
        "active_draw": config.get("active_draw"),
        "eligible_people": sorted({normalize_name(p) for p in get_last_night_people()}),
    }


@router.get("/next-category")
def get_next_category():
    return load_config().get("next_category", None)


@router.get("/next-night-date")
@locked(lambda: CONFIG_PATH)
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
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def delete_last_spin(draw_id: str | None = None):
    config = load_config()
    draw = config.get("active_draw")
    if draw_id and (not draw or draw["id"] != draw_id):
        raise HTTPException(409, "Wynik zmienił się. Odśwież koło.")
    raw = get_wheel_data()
    history = raw["history"]
    if not history:
        raise HTTPException(404, "Brak historii")
    last = history[-1]
    picks = draw["picks"] if draw else [{"person_key": last["person"], "category": last["category"]}]
    tail = history[-len(picks):]
    if [(h["person"], h["category"]) for h in tail] != [(p["person_key"], p["category"]) for p in picks]:
        raise HTTPException(409, "Historia zmieniła się. Nie można bezpiecznie cofnąć losowania.")
    for entry in reversed(tail):
        delete_history_entry(entry["row_index"])
    # record_spin() removed the category from the person's column; without
    # this the "Nie zapisuj" button would destroy the category for good.
    restored = False
    for pick in picks:
        restored = restore_category(pick["person_key"], pick["category"]) or restored

    config.pop("active_draw", None)
    undo = config.pop("last_spin_undo", None)
    if undo is not None:
        # Put back exactly what the spin changed.
        for key in ("next_category", "next_night_date", "forced_spin"):
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
        "removed_categories": [p["category"] for p in picks],
    }


class AddPersonPayload(BaseModel):
    name: str


@locked(lambda: CONFIG_PATH)
def _ensure_person(name: str, *, allow_restore: bool = False) -> dict:
    """Make sure `name` has a scores column, a wheel column and a name_map entry,
    and is not hidden. Safe to call repeatedly."""
    from excel.scores import add_person_to_scores
    name = normalize_name(name)
    if not allow_restore and name in get_hidden_people():
        raise HTTPException(403, "Tę osobę może przywrócić tylko administrator.")
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
        return {"ok": True, **_ensure_person(name, allow_restore=False)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/candidates")
def list_candidates(authorization: str | None = Header(default=None)):
    """People known from any season (or explicitly hidden) who are not currently
    shown on the wheel -- the pool for 'dodaj do czesto pojawiajacych sie osob'."""
    require_admin(authorization)
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
def resurface_person(payload: AddPersonPayload, authorization: str | None = Header(default=None)):
    """Bring a previously-known person back onto the wheel."""
    require_admin(authorization)
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    try:
        return {"ok": True, **_ensure_person(name, allow_restore=True)}
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
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def simulate_spins(rounds: int = Query(default=20, ge=1, le=500)):
    raw = get_wheel_data()
    nights = recent_hosts(raw)
    results = []
    forced = load_config().get("forced_spin")
    for _ in range(rounds):
        pool = _theme_pool(_compute_weights(raw, nights))
        if not pool:
            break
        chosen = _forced_theme(pool, forced) if forced else _choose_theme(pool)
        forced = None
        results.append({"person": chosen["person"], "category": chosen["category"]})
        for key, categories in raw["categories"].items():
            if normalize_name(key) == chosen["person"]:
                raw["categories"][key] = [c for c in categories if _norm(c) != _norm(chosen["category"])]
        nights.insert(0, {chosen["person"]})
    return {"picks": results}


class SpinPayload(BaseModel):
    person_key: str
    category: str


@router.post("/spin")
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def spin(payload: SpinPayload):
    try:
        config = load_config()
        if (config.get("active_draw") or {}).get("pending"):
            raise HTTPException(409, "Dokończ lub cofnij poprzednie losowanie.")
        pool = _theme_pool(_compute_weights(get_wheel_data()))
        if not any(p["person"] == normalize_name(payload.person_key) and p["category"] == payload.category for p in pool):
            raise HTTPException(400, "Temat jest niedostępny lub osoba wybierała na ostatniej nocce.")
        record_spin(payload.person_key, payload.category)
        config.pop("active_draw", None)
        # Snapshot of everything this spin is about to change, so "Nie zapisuj"
        # can put the previous night back rather than just dropping it.
        config["last_spin_undo"] = {
            "next_category": config.get("next_category"),
            "next_night_date": config.get("next_night_date"),
            "forced_spin": config.get("forced_spin"),
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class DrawPayload(BaseModel):
    mode: Literal["single", "double_theme", "cohost"] = "single"


def _theme_pool(entries: list, first: dict | None = None) -> list:
    return [
        {"person_key": e["key"], "person": e["name"], "category": category,
         # Ticket count sets the base weight; recency scales each ticket.
         "weight": e["weight"] / len(e["categories"])}
        for e in entries for category in e["categories"]
        if e["weight"] > 0 and (first is None or (e["name"] != first["person"] and _norm(category) != _norm(first["category"])))
    ]


def _choose_theme(pool: list) -> dict:
    chosen = random.choices(pool, weights=[p["weight"] for p in pool], k=1)[0]
    return {k: v for k, v in chosen.items() if k != "weight"}


def _forced_theme(pool: list, forced: dict) -> dict:
    candidate = next((p for p in pool if p["person"] == normalize_name(forced.get("person_key", ""))
                      and p["category"] == forced.get("category")), None)
    if candidate is None:
        raise HTTPException(400, "Ustawiony wynik jest niedostępny lub zablokowany po ostatniej nocce. Zmień go w panelu administratora.")
    return {k: v for k, v in candidate.items() if k != "weight"}


def _publish_draw(config: dict, draw: dict) -> None:
    themes = [{"category": p["category"], "person": p["person"]} for p in draw["picks"]]
    config["next_category"] = {
        "category": " + ".join(t["category"] for t in themes),
        "person": " + ".join(draw["hosts"]),
        "themes": themes, "hosts": draw["hosts"],
        "mode": draw["mode"], "pending": draw["pending"],
    }
    config["active_draw"] = draw
    save_config(config)


@router.post("/draw")
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def start_draw(payload: DrawPayload):
    config = load_config()
    if (config.get("active_draw") or {}).get("pending"):
        raise HTTPException(409, "Dokończ lub cofnij poprzednie losowanie.")
    raw = get_wheel_data()
    nights = recent_hosts(raw)
    entries = _compute_weights(raw, nights)
    pool = _theme_pool(entries)
    if not pool:
        raise HTTPException(400, "Brak dostępnych tematów z dodatnią wagą przy obecnych ustawieniach losowania.")
    people = sorted({normalize_name(p) for p in get_last_night_people()})
    person_weights = {p: recency(p, nights, config.get("draw_initial_penalty", 0.5))[1] for p in people if recency(p, nights, config.get("draw_initial_penalty", 0.5))[1] > 0}
    # Validate both stages before consuming a ticket. Do not silently reweight
    # the first stage just to make a two-person mode possible.
    if payload.mode == "double_theme" and any(not _theme_pool(entries, p) for p in pool):
        raise HTTPException(400, "Potrzebne są różne tematy od co najmniej dwóch osób.")
    if payload.mode == "cohost" and any(not set(person_weights) - {p["person"]} for p in pool):
        raise HTTPException(400, "Brak drugiej osoby z oceną i dodatnią wagą po uwzględnieniu historii nocek.")
    forced = config.get("forced_spin")
    first = _forced_theme(pool, forced) if forced else _choose_theme(pool)
    config["last_spin_undo"] = {k: config.get(k) for k in ("next_category", "next_night_date", "forced_spin")}
    record_spin(first["person_key"], first["category"])
    config.pop("forced_spin", None)
    current_date = config.get("next_night_date")
    if current_date:
        try:
            current = date.fromisoformat(current_date)
            if current <= date.today():
                config["next_night_date"] = (current + timedelta(weeks=2)).isoformat()
        except ValueError:
            pass
    draw = {"id": str(uuid4()), "mode": payload.mode, "picks": [first],
            "hosts": [first["person"]], "pending": payload.mode != "single",
            "eligible_people": [p for p in person_weights if p != first["person"]],
            "person_weights": {p: w for p, w in person_weights.items() if p != first["person"]}}
    _publish_draw(config, draw)
    return draw


@router.post("/draw/{draw_id}/next")
@locked(lambda: CONFIG_PATH)
@locked(lambda: WHEEL_PATH)
def finish_draw(draw_id: str):
    config = load_config()
    draw = config.get("active_draw")
    if not draw or draw["id"] != draw_id:
        raise HTTPException(409, "Losowanie zmieniło się. Odśwież koło.")
    if not draw["pending"]:
        return draw  # Retrying a request must not consume another category.
    if draw["mode"] == "double_theme":
        pool = _theme_pool(_compute_weights(get_wheel_data()), draw["picks"][0])
        if not pool:
            raise HTTPException(409, "Brak drugiego tematu. Cofnij losowanie i dodaj kategorie.")
        second = _choose_theme(pool)
        record_spin(second["person_key"], second["category"])
        draw["picks"].append(second)
        draw["hosts"].append(second["person"])
    else:
        # Keep one base ticket per actual scorer, then apply the same recency
        # penalty as for themes. Recover older pending draws using real history.
        weights = draw.get("person_weights")
        if weights is None:
            nights = recent_hosts(get_wheel_data())
            weights = {p: recency(p, nights, config.get("draw_initial_penalty", 0.5))[1] for p in draw["eligible_people"]}
        candidates = [p for p in draw["eligible_people"] if weights.get(p, 0) > 0]
        if not candidates:
            raise HTTPException(409, "Brak drugiej osoby z dodatnią wagą. Cofnij losowanie.")
        draw["hosts"].append(random.choices(candidates, weights=[weights[p] for p in candidates], k=1)[0])
    draw["pending"] = False
    _publish_draw(config, draw)
    return draw
