import uuid
import bcrypt
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from config import load_config, save_config, get_hidden_people, normalize_name
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

    all_names = list(dict.fromkeys(scores_people + wheel_people))
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
        return {"ok": True, **_ensure_person(name)}
    except Exception as e:
        raise HTTPException(500, str(e))


class PersonNamePayload(BaseModel):
    name: str


@router.put("/people/hide")
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
def rename_person(payload: RenamePayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    old_name = payload.old_name.strip()
    new_name = payload.new_name.strip()
    if not new_name:
        raise HTTPException(400, "New name required")
    config = load_config()
    name_map = config.setdefault("name_map", {})
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
    except Exception as e:
        raise HTTPException(500, str(e))


class AddHistoryPayload(BaseModel):
    person: str
    category: str


@router.post("/wheel/history")
def add_wheel_history(payload: AddHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if not payload.person.strip() or not payload.category.strip():
        raise HTTPException(400, "Person and category required")
    try:
        add_history_entry(payload.person, payload.category)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


class DeleteHistoryPayload(BaseModel):
    row_index: int


@router.delete("/wheel/history")
def delete_wheel_history(payload: DeleteHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
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
    except Exception as e:
        raise HTTPException(500, str(e))


class EditHistoryPayload(BaseModel):
    row_index: int
    person: str
    category: str


@router.put("/wheel/history")
def edit_wheel_history(payload: EditHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    try:
        edit_history_entry(payload.row_index, payload.person, payload.category)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


class ReorderHistoryPayload(BaseModel):
    row_indices: list[int]


@router.put("/wheel/history/reorder")
def reorder_wheel_history(payload: ReorderHistoryPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    try:
        reorder_history(payload.row_indices)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


class SetNextCategoryPayload(BaseModel):
    person_key: str
    category: str


@router.put("/next-category")
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
def admin_clear_next_category(authorization: str = Header(default=None)):
    _require_admin(authorization)
    config = load_config()
    config.pop("forced_spin", None)
    save_config(config)
    return {"ok": True}


class EditScorePayload(BaseModel):
    season: int
    row_num: int
    person: str
    score: float | None


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
    except Exception as e:
        raise HTTPException(500, str(e))


class DeleteMovieRowPayload(BaseModel):
    season: int
    row_num: int


@router.delete("/scores/movie")
def admin_delete_movie_row(payload: DeleteMovieRowPayload, authorization: str = Header(default=None)):
    _require_admin(authorization)
    if payload.season not in (1, 2, 3, 4):
        raise HTTPException(400, "Invalid season")
    try:
        delete_movie_row(payload.season, payload.row_num)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
