import uuid
import bcrypt
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from config import load_config, save_config, normalize_name, CONFIG_PATH
from excel.locking import locked
from typing import Annotated
from excel.scores import get_season4_people, edit_score, delete_night, delete_movie_row
from excel.wheel import (
    get_wheel_data, delete_category, delete_history_entry, edit_history_entry,
    reorder_history, add_history_entry, restore_category,
)
from auth import _sessions, require_admin

router = APIRouter()


def _require_admin(authorization: str = Header(default=None)):
    return require_admin(authorization)


class LoginPayload(BaseModel):
    password: str


@router.post("/login")
def login(payload: LoginPayload):
    config = load_config()
    stored_hash = config.get("admin_hash", "")
    if not stored_hash:
        raise HTTPException(500, "Admin not configured")
    if len(payload.password.encode()) > 72:
        raise HTTPException(403, "Wrong password")
    if bcrypt.checkpw(payload.password.encode(), stored_hash.encode()):
        token = str(uuid.uuid4())
        _sessions.add(token)
        return {"token": token}
    raise HTTPException(403, "Wrong password")


@router.post("/logout")
def logout(authorization: str = Header(default=None)):
    if authorization in _sessions:
        _sessions.discard(authorization)
    return {"ok": True}


@router.get("/people")
def list_all_people(authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    hidden = config.get("hidden_people", [])

    scores_people = get_season4_people()
    wheel_data = get_wheel_data()
    wheel_people = [normalize_name(k) for k in wheel_data["categories"].keys()]

    all_names = list(dict.fromkeys(normalize_name(p) for p in scores_people + wheel_people))
    return [
        {"name": p, "hidden": p in hidden}
        for p in all_names
    ]


class AddPersonPayload(BaseModel):
    name: str


@router.post("/people")
def add_person(payload: AddPersonPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    try:
        # Shared with the public route so an admin-added person is also
        # unhidden and given a colour -- re-adding someone who had been hidden
        # used to leave them invisible everywhere.
        from routes.wheel import _ensure_person
        return {"ok": True, **_ensure_person(name, allow_restore=True)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class PersonNamePayload(BaseModel):
    name: str


@router.put("/people/hide")
@locked(lambda: CONFIG_PATH)
def hide_person(payload: PersonNamePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    hidden = config.get("hidden_people", [])
    if payload.name not in hidden:
        hidden.append(payload.name)
    config["hidden_people"] = hidden
    save_config(config)
    return {"ok": True}


@router.put("/people/show")
@locked(lambda: CONFIG_PATH)
def show_person(payload: PersonNamePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    hidden = config.get("hidden_people", [])
    config["hidden_people"] = [p for p in hidden if p != payload.name]
    save_config(config)
    return {"ok": True}


class RenamePayload(BaseModel):
    old_name: str
    new_name: str


@router.put("/people/rename")
@locked(lambda: CONFIG_PATH)
def rename_person(payload: RenamePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    old_name = normalize_name(payload.old_name)
    new_name = payload.new_name.strip()
    if not new_name:
        raise HTTPException(400, "New name required")
    config = load_config()
    name_map = config.setdefault("name_map", {})
    if new_name != old_name and normalize_name(new_name) in {normalize_name(p) for p in get_season4_people()}:
        raise HTTPException(409, "Osoba o takim imieniu już istnieje")
    for alias, name in list(name_map.items()):
        if name == old_name:
            name_map[alias] = new_name
    name_map[old_name.lower()] = new_name
    name_map[new_name.lower()] = new_name
    colors = config.setdefault("person_colors", {})
    if old_name in colors:
        colors[new_name] = colors.pop(old_name)
    config["hidden_people"] = [new_name if p == old_name else p for p in config.get("hidden_people", [])]
    save_config(config)
    return {"ok": True}


class SetNextNightDatePayload(BaseModel):
    date: str | None
    time: str | None = None


@router.put("/next-night-date")
@locked(lambda: CONFIG_PATH)
def set_next_night_date(payload: SetNextNightDatePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    if payload.date:
        config["next_night_date"] = payload.date
    else:
        config.pop("next_night_date", None)
        config.pop("next_night_time", None)
    if payload.time:
        config["next_night_time"] = payload.time
    else:
        config.pop("next_night_time", None)
    save_config(config)
    return {"ok": True}


class DeleteCategoryPayload(BaseModel):
    person_key: str
    category: str


@router.delete("/wheel/category")
def delete_wheel_category(payload: DeleteCategoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    try:
        delete_category(payload.person_key, payload.category)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class AddHistoryPayload(BaseModel):
    person: str
    category: str


@router.post("/wheel/history")
@locked(lambda: CONFIG_PATH)
def add_wheel_history(payload: AddHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if load_config().get("active_draw"):
        raise HTTPException(409, "Zakończ nockę lub cofnij bieżące losowanie przed dopisaniem historii.")
    if not payload.person.strip() or not payload.category.strip():
        raise HTTPException(400, "Person and category required")
    try:
        add_history_entry(payload.person, payload.category)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class DeleteHistoryPayload(BaseModel):
    row_index: int


@router.delete("/wheel/history")
@locked(lambda: CONFIG_PATH)
def delete_wheel_history(payload: DeleteHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    _protect_active_history({payload.row_index})
    try:
        wheel_data = get_wheel_data()
        entry = next((e for e in wheel_data["history"] if e["row_index"] == payload.row_index), None)

        delete_history_entry(payload.row_index)

        if entry:
            person_key = entry["person"]
            category = entry["category"]

            config = load_config()
            nc = config.get("next_category")
            if nc and nc.get("category", "").lower() == category.lower():
                config.pop("next_category", None)
                save_config(config)

            if category and person_key:
                # Re-add to the wheel column only if record_spin already removed it
                restore_category(person_key, category)

        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class EditHistoryPayload(BaseModel):
    row_index: int
    person: str
    category: str


@router.put("/wheel/history")
@locked(lambda: CONFIG_PATH)
def edit_wheel_history(payload: EditHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    _protect_active_history({payload.row_index})
    try:
        edit_history_entry(payload.row_index, payload.person, payload.category)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class ReorderHistoryPayload(BaseModel):
    row_indices: list[int]


@router.put("/wheel/history/reorder")
@locked(lambda: CONFIG_PATH)
def reorder_wheel_history(payload: ReorderHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    draw = load_config().get("active_draw")
    if draw:
        history = get_wheel_data()["history"]
        tail = [e["row_index"] for e in history[-len(draw["picks"]):]]
        if payload.row_indices[-len(tail):] != tail:
            raise HTTPException(409, "Nie można przenieść bieżącego losowania. Najpierw je cofnij.")
    try:
        reorder_history(payload.row_indices)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class SetNextCategoryPayload(BaseModel):
    person_key: str
    category: str


@router.put("/next-category")
@locked(lambda: CONFIG_PATH)
def admin_set_next_category(payload: SetNextCategoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if not payload.person_key.strip() or not payload.category.strip():
        raise HTTPException(400, "Person and category required")
    config = load_config()
    config["forced_spin"] = {
        "person_key": payload.person_key,
        "category": payload.category,
    }
    save_config(config)
    return {"ok": True}


@router.delete("/next-category")
@locked(lambda: CONFIG_PATH)
def admin_clear_next_category(authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    config.pop("forced_spin", None)
    save_config(config)
    return {"ok": True}


class EditScorePayload(BaseModel):
    season: int
    row_num: int = Field(ge=1)
    person: str
    score: Annotated[float, Field(ge=1, le=10, allow_inf_nan=False)] | None


@router.put("/scores/edit")
def admin_edit_score(payload: EditScorePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if payload.season not in (1, 2, 3, 4):
        raise HTTPException(400, "Invalid season")
    try:
        edit_score(payload.season, payload.row_num, payload.person, payload.score)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class DeleteNightPayload(BaseModel):
    season: int
    night_name: str


@router.delete("/scores/night")
def admin_delete_night(payload: DeleteNightPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if payload.season not in (1, 2, 3, 4):
        raise HTTPException(400, "Invalid season")
    try:
        delete_night(payload.season, payload.night_name)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


class DeleteMovieRowPayload(BaseModel):
    season: int
    row_num: int = Field(ge=1)


@router.delete("/scores/movie")
def admin_delete_movie_row(payload: DeleteMovieRowPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if payload.season not in (1, 2, 3, 4):
        raise HTTPException(400, "Invalid season")
    try:
        delete_movie_row(payload.season, payload.row_num)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


def _protect_active_history(rows: set[int]):
    draw = load_config().get("active_draw")
    if draw:
        tail = get_wheel_data()["history"][-len(draw["picks"]):]
        if any(e["row_index"] in rows for e in tail):
            raise HTTPException(409, "Najpierw cofnij bieżące losowanie, zanim zmienisz jego historię.")


class DrawSettingsPayload(BaseModel):
    initial_penalty: float = Field(ge=0, le=1)


@router.get("/draw-settings")
def get_draw_settings(authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    return {"initial_penalty": config.get("draw_initial_penalty", 0.5),
            "locked": bool((config.get("active_draw") or {}).get("pending"))}


@router.put("/draw-settings")
@locked(lambda: CONFIG_PATH)
def set_draw_settings(payload: DrawSettingsPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if payload.initial_penalty not in (0, 0.5, 1):
        raise HTTPException(422, "Wybierz karę 0%, 50% lub 100%.")
    config = load_config()
    if (config.get("active_draw") or {}).get("pending"):
        raise HTTPException(409, "Dokończ lub cofnij losowanie przed zmianą kary.")
    config["draw_initial_penalty"] = payload.initial_penalty
    save_config(config)
    return {"initial_penalty": payload.initial_penalty, "locked": False}
