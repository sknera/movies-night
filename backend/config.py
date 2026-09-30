import os
import json
import re
import colorsys
from pathlib import Path

from excel.locking import file_lock

_default_data = Path(__file__).parent.parent / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", str(_default_data)))
CONFIG_PATH = DATA_DIR / "config.json"

# Everything the app writes goes into the most recent season.
CURRENT_SEASON = 4


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict):
    """Write config.json atomically, under the same lock the workbooks use.

    A half-written config.json would take the whole app down on next start,
    so the new content lands in a temp file that is renamed into place.
    """
    with file_lock(CONFIG_PATH):
        tmp = CONFIG_PATH.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, CONFIG_PATH)


def get_hidden_people() -> list:
    return load_config().get("hidden_people", [])


def get_name_map() -> dict:
    return load_config().get("name_map", {})


def normalize_name(raw: str) -> str:
    name_map = get_name_map()
    key = raw.strip().lower()
    if key in name_map:
        return name_map[key]
    # Spreadsheet headers vary in spacing ("Ania 5" vs "ania5"), which would
    # otherwise surface the same person twice.
    collapsed = re.sub(r"\s+", "", key)
    if collapsed in name_map:
        return name_map[collapsed]
    return raw.strip().title()


def get_person_colors() -> dict:
    return load_config().get("person_colors", {})


def get_person_color(name: str) -> str:
    colors = get_person_colors()
    return colors.get(name, "#674EA7")


# ── Person colours ──────────────────────────────────────────────────────────

# Every colour in person_colors is hsl(h, 63%, 57%) -- #d84b4b, #9ed84b, ...
# New people get the hue furthest from every hue already in use, so nobody
# ends up sharing a colour with the person sitting next to them.
_COLOR_SAT = 0.63
_COLOR_LIGHT = 0.57


def _hex_to_hue(hex_color: str):
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", hex_color.strip())
    if not m:
        return None
    raw = m.group(1)
    r, g, b = (int(raw[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, _l, _s = colorsys.rgb_to_hls(r, g, b)
    return h * 360


def _hue_to_hex(hue: float) -> str:
    r, g, b = colorsys.hls_to_rgb((hue % 360) / 360, _COLOR_LIGHT, _COLOR_SAT)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def pick_free_color(used_colors) -> str:
    used_hues = [h for h in (_hex_to_hue(c) for c in used_colors) if h is not None]
    if not used_hues:
        return _hue_to_hex(0)

    def gap(hue: float) -> float:
        return min(min(abs(hue - u), 360 - abs(hue - u)) for u in used_hues)

    best = max(range(0, 360, 3), key=gap)
    return _hue_to_hex(best)


def ensure_person_color(name: str) -> str:
    """Give `name` a distinct colour if they do not have one yet."""
    config = load_config()
    colors = config.setdefault("person_colors", {})
    if name in colors:
        return colors[name]
    color = pick_free_color(colors.values())
    colors[name] = color
    save_config(config)
    return color
