import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from excel.scores import get_all_movies, get_season4_people, save_session, get_all_nights, get_last_night_people, get_people_for_season, get_all_header_people
from excel.wheel import get_wheel_data, find_category_owner
from config import (
    get_hidden_people, get_person_color, normalize_name, load_config, save_config,
    CURRENT_SEASON,
)

router = APIRouter()


class SessionPayload(BaseModel):
    movies: list[str]
    category: Optional[str] = None
    present_people: list[str]
    scores: dict[str, dict[str, Optional[float]]]


@router.get("/movies")
def list_movies():
    return get_all_movies()


@router.get("/people")
def list_people():
    """Canonical names of everyone who can be scored tonight.

    The sheet headers are whatever was typed years ago ("bart", "Ania 5"), so
    they are normalised here. Returning raw headers meant the hidden list --
    which stores canonical names -- missed people, and the colours from
    /scores/stats (also canonical) never matched.
    """
    hidden = set(get_hidden_people())
    result: list[str] = []
    seen: set[str] = set()
    for raw in get_season4_people():
        name = normalize_name(raw)
        if name in hidden or name in seen:
            continue
        seen.add(name)
        result.append(name)
    return result


@router.get("/stats")
def get_stats():
    movies = get_all_movies()
    hidden = get_hidden_people()

    # Normalize names and merge duplicates (xero/Xero → canonical Xero)
    person_data: dict[str, dict] = {}

    for movie in movies:
        for raw_person, score in movie["scores"].items():
            canonical = normalize_name(raw_person)
            if canonical in hidden:
                continue
            if canonical not in person_data:
                person_data[canonical] = {
                    "watched": 0, "total": 0.0,
                    "color": get_person_color(canonical),
                }
            person_data[canonical]["watched"] += 1
            person_data[canonical]["total"] += score

    nights = get_all_nights()
    total_nights = len(nights)
    person_last_night: dict[str, int] = {}
    for i, night in enumerate(nights):
        for movie in night.get("movies", []):
            for raw_person in movie.get("scores", {}).keys():
                canonical = normalize_name(raw_person)
                person_last_night[canonical] = i

    result = []
    for name, d in person_data.items():
        avg = round(d["total"] / d["watched"], 2) if d["watched"] else None
        nights_ago = total_nights - person_last_night[name] - 1 if name in person_last_night else None
        result.append({"name": name, "watched": d["watched"], "average": avg, "color": d["color"], "nights_ago": nights_ago})

    result.sort(key=lambda x: x["watched"], reverse=True)
    return result


@router.get("/nights")
def get_nights():
    raw = get_all_nights()

    # Config-based lookup (primary, exact match by season + category name)
    config = load_config()
    config_hosts: dict[str, dict[str, str | None]] = config.get("category_hosts", {})

    # Wheel history lookup (fallback, case-insensitive category match)
    wheel_history = get_wheel_data().get("history", [])
    wheel_host: dict[str, str] = {}
    for entry in wheel_history:
        key = entry["category"].strip().lower()
        if key:
            wheel_host[key] = normalize_name(entry["person"])

    unnamed_n = 0
    result = []
    for night in raw:
        if not night["name"]:
            unnamed_n += 1
            name = f"Noc {unnamed_n}"
        else:
            name = night["name"]

        season_key = str(night["season"])
        config_val = config_hosts.get(season_key, {}).get(name)
        host: str | None = config_val if config_val is not None else wheel_host.get(name.strip().lower())
        normalized_movies = []
        for movie in night["movies"]:
            normalized_scores = {normalize_name(p): s for p, s in movie.get("scores", {}).items()}
            normalized_movies.append({
                "title": movie["title"],
                "average": movie["average"],
                "scores": normalized_scores,
                "row_num": movie.get("row_num"),
            })
        result.append({
            "name": name,
            "season": night["season"],
            "movie_count": len(night["movies"]),
            "movies": normalized_movies,
            "host": host,
        })
    return result


@router.get("/last-night-people")
def last_night_people():
    raw = get_last_night_people()
    hidden = get_hidden_people()
    return [normalize_name(p) for p in raw if normalize_name(p) not in hidden]


@router.get("/person/{name}")
def get_person_data(name: str):
    movies = get_all_movies()
    result = []
    for m in movies:
        for raw_person, score in m["scores"].items():
            canonical = normalize_name(raw_person)
            if canonical == name:
                result.append({
                    "title": m["title"],
                    "category": m["category"],
                    "season": m["season"],
                    "average": m["average"],
                    "score": score,
                    "all_scores": {normalize_name(p): s for p, s in m["scores"].items()},
                })
                break
    return {"name": name, "movies": result, "color": get_person_color(name)}


class ColorPayload(BaseModel):
    color: str


@router.put("/person/{name}/color")
def set_person_color(name: str, payload: ColorPayload):
    if not re.match(r'^#[0-9a-fA-F]{6}$', payload.color):
        raise HTTPException(400, "Invalid color — use #RRGGBB")
    config = load_config()
    config.setdefault("person_colors", {})[name] = payload.color
    save_config(config)
    return {"ok": True}


@router.get("/awards")
def get_awards(min_movies: int = 10, last_n: int = 150):
    movies = get_all_movies()
    if last_n > 0:
        movies = movies[-last_n:]
    hidden = get_hidden_people()

    person_scores: dict[str, list[float]] = {}
    person_diffs: dict[str, list[float]] = {}

    for movie in movies:
        raw_scores = movie.get("scores", {})
        if not raw_scores:
            continue
        norm: dict[str, float] = {}
        for raw_person, score in raw_scores.items():
            if score is None:
                continue
            canonical = normalize_name(raw_person)
            if canonical not in hidden:
                norm[canonical] = float(score)
        if len(norm) < 2:
            continue
        group_avg = sum(norm.values()) / len(norm)
        for person, score in norm.items():
            person_scores.setdefault(person, []).append(score)
            person_diffs.setdefault(person, []).append(abs(score - group_avg))

    eligible = {p: s for p, s in person_scores.items() if len(s) >= min_movies}
    if not eligible:
        return {}

    def _avg(lst): return sum(lst) / len(lst)
    def _std(lst):
        a = _avg(lst)
        return (sum((x - a) ** 2 for x in lst) / len(lst)) ** 0.5

    harshest = min(eligible, key=lambda p: _avg(eligible[p]))
    generous = max(eligible, key=lambda p: _avg(eligible[p]))
    controversial = max(eligible, key=lambda p: _std(eligible[p]))
    aligned = min((p for p in eligible if p in person_diffs), key=lambda p: _avg(person_diffs[p]))

    def build(name):
        s = eligible[name]
        return {
            "name": name,
            "avg": round(_avg(s), 2),
            "std_dev": round(_std(s), 2),
            "mae": round(_avg(person_diffs.get(name, [0])), 2),
            "watched": len(s),
        }

    return {
        "harshest": build(harshest),
        "generous": build(generous),
        "controversial": build(controversial),
        "aligned": build(aligned),
        "min_movies": min_movies,
        "last_n": last_n,
    }


@router.get("/attendance")
def get_attendance():
    nights_raw = get_all_nights()

    night_list = []
    unnamed_n = 0
    for i, night in enumerate(nights_raw):
        if not night["name"]:
            unnamed_n += 1
            name = f"Noc {unnamed_n}"
        else:
            name = night["name"]
        night_list.append({"index": i, "name": name, "season": night["season"]})

    n = len(nights_raw)
    person_attendance: dict[str, list[bool]] = {}

    for raw in get_all_header_people():
        canonical = normalize_name(raw)
        if canonical not in person_attendance:
            person_attendance[canonical] = [False] * n

    for i, night in enumerate(nights_raw):
        for movie in night.get("movies", []):
            for raw_person in movie.get("scores", {}).keys():
                canonical = normalize_name(raw_person)
                if canonical not in person_attendance:
                    person_attendance[canonical] = [False] * n
                person_attendance[canonical][i] = True

    people = []
    for name, attendance in person_attendance.items():
        people.append({
            "name": name,
            "color": get_person_color(name),
            "attendance": attendance,
        })

    people.sort(key=lambda p: sum(p["attendance"]), reverse=True)
    return {"nights": night_list, "people": people}


@router.get("/season-people/{season}")
def season_people(season: int):
    if season not in (1, 2, 3, 4):
        raise HTTPException(400, "Invalid season")
    raw = get_people_for_season(season)
    return [normalize_name(p) for p in raw]


def _retire_category(config: dict, category: str) -> None:
    """Record `category` as watched so the wheel stops offering it.

    get_wheel_data() filters a person's list against config["category_hosts"],
    so writing the night in here is what retires a category that was never
    spun for -- typed by hand, or set by the admin as the forced winner.
    """
    nc = config.get("next_category") or {}
    host = nc.get("person") if nc.get("category", "").strip().lower() == category.lower() else None
    if not host:
        owner = find_category_owner(category)
        host = normalize_name(owner) if owner else None

    season = config.setdefault("category_hosts", {}).setdefault(str(CURRENT_SEASON), {})
    if category not in season or (host and not season[category]):
        season[category] = host


@router.post("/session")
def submit_session(payload: SessionPayload):
    titles = [m.strip() for m in payload.movies if m and m.strip()]
    if not titles:
        raise HTTPException(400, "Podaj przynajmniej jeden film")
    # Scores are keyed by title, so two rows with the same title would share
    # one set of scores and silently overwrite each other.
    dupes = {t for t in titles if titles.count(t) > 1}
    if dupes:
        raise HTTPException(400, f"Powtórzony tytuł filmu: {', '.join(sorted(dupes))}")

    try:
        # Filter out None scores
        clean_scores = {
            movie: {person: score for person, score in person_scores.items() if score is not None}
            for movie, person_scores in payload.scores.items()
        }
        save_session(titles, payload.category, clean_scores, payload.present_people)

        category = (payload.category or "").strip()
        if category:
            config = load_config()
            nc = config.get("next_category")
            _retire_category(config, category)
            # Clear next_category when scores for that category are submitted
            if nc and nc.get("category", "").lower() == category.lower():
                config.pop("next_category", None)
            save_config(config)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
