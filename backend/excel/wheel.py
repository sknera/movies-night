import os
import re
import openpyxl
from pathlib import Path

from excel.locking import file_lock, locked

_default_data = Path(__file__).parent.parent.parent / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", str(_default_data)))
WHEEL_PATH = DATA_DIR / "spread.xlsx"

JUNK_VALUES = {"ddduuppaaa", "duuuuupa", "dupa", "duupa"}

_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001F9FF\U00002600-\U000026FF\U00002700-\U000027FF"
    "\U0001FA00-\U0001FA9F\U0001FAB0-\U0001FABF\U0001FAC0-\U0001FAFF"
    "\U00010000-\U0010FFFF]+",
    flags=re.UNICODE,
)


def _norm(s: str) -> str:
    """Lowercase + strip emoji + collapse whitespace for fuzzy category matching."""
    return _EMOJI_RE.sub("", s).strip().lower()


def _load_wb():
    return openpyxl.load_workbook(WHEEL_PATH)


def _get_structure(ws) -> tuple:
    """Returns (people_cols, trafione_col, category_col) where people_cols = {col_idx: key}.

    People occupy every named column left of "trafione", minus the "dupa" scratch
    column. The boundary is found first so that adding people never pushes anyone
    past a fixed column limit.
    """
    trafione_col = None
    category_col = None
    for cell in ws[1]:
        if cell.value and str(cell.value).strip().lower() == "trafione":
            trafione_col = cell.column
            category_col = cell.column + 1
            break

    people_cols = {}
    for cell in ws[1]:
        v = cell.value
        if not v:
            continue
        if trafione_col is not None and cell.column >= trafione_col:
            continue
        v_str = str(v).strip()
        if v_str.lower() in ("dupa", "trafione"):
            continue
        people_cols[cell.column] = v_str
    return people_cols, trafione_col, category_col


def get_wheel_data() -> dict:
    from config import load_config, normalize_name  # local import avoids circular at module level
    wb = _load_wb()
    ws = wb.active
    people_cols, trafione_col, category_col = _get_structure(ws)

    # Build reverse map: normalized display name -> wheel key (e.g. "bartosz" -> "bart")
    display_to_key: dict[str, str] = {}
    for key in people_cols.values():
        display_to_key[normalize_name(key).lower()] = key

    # Read history and build used-category sets per person key (norm: no emoji, lowercase)
    history = []
    used_by_key: dict[str, set[str]] = {}
    if trafione_col:
        for row in ws.iter_rows(min_row=2):
            person = row[trafione_col - 1].value
            cat = row[category_col - 1].value if category_col and category_col - 1 < len(row) else None
            if person:
                p = str(person).strip()
                c = str(cat).strip() if cat else ""
                history.append({"person": p, "category": c, "row_index": row[0].row})
                used_by_key.setdefault(p.lower(), set()).add(_norm(c))

    # Also mark categories from category_hosts (covers nights before auto-save)
    # Uses display_to_key so "Bartosz" maps to wheel key "bart", etc.
    try:
        for season_data in load_config().get("category_hosts", {}).values():
            for cat_name, host_name in season_data.items():
                if host_name:
                    wheel_key = display_to_key.get(host_name.lower(), host_name.lower())
                    used_by_key.setdefault(wheel_key, set()).add(_norm(cat_name))
    except Exception:
        pass

    # Read categories, filtering already-used ones (norm comparison strips emoji)
    categories: dict[str, list] = {}
    for col, key in people_cols.items():
        used_norms = used_by_key.get(key.lower(), set())
        cats = []
        for row in ws.iter_rows(min_row=2, min_col=col, max_col=col):
            v = row[0].value
            if v and str(v).strip().lower() not in JUNK_VALUES:
                cat_str = str(v).strip()
                if _norm(cat_str) not in used_norms:
                    cats.append(cat_str)
        # Always include the person, even with an empty list: otherwise someone
        # whose categories have all been used disappears from the wheel page
        # entirely -- including the grid where new categories are added.
        categories[key] = cats

    return {"categories": categories, "history": history}


class UnknownPersonError(ValueError):
    """Raised when a wheel column cannot be found for a person key."""


def add_categories(new_cats: dict) -> dict:
    """new_cats: {person_key: [cat1, cat2, ...]} -> {person_key: n_written}.

    Raises UnknownPersonError for a key with no column. Silently skipping it
    used to return a cheerful "ok" while writing nothing, so the UI flashed a
    green tick for a category that was never saved.
    """
    with file_lock(WHEEL_PATH):
        wb = _load_wb()
        ws = wb.active
        people_cols, _, _ = _get_structure(ws)

        # Build reverse map: key -> col
        key_to_col = {v: k for k, v in people_cols.items()}

        written: dict[str, int] = {}
        for person_key, cats in new_cats.items():
            col = key_to_col.get(person_key)
            if col is None:
                # Tolerate a display name where a raw column key was expected
                # ("Bartosz" for the "bart" column).
                col = find_person_column(ws, person_key)
            if col is None:
                raise UnknownPersonError(person_key)
            # Find next empty row in this column
            row_idx = 2
            while ws.cell(row_idx, col).value is not None:
                row_idx += 1
            n = 0
            for cat in cats:
                cat = str(cat).strip()
                if not cat:
                    continue
                ws.cell(row_idx, col).value = cat
                row_idx += 1
                n += 1
            written[person_key] = n

        wb.save(WHEEL_PATH)
    return written


def restore_category(person_key: str, category: str) -> bool:
    """Put `category` back into `person_key`'s column if it is not there.

    record_spin() strips the drawn category out of the person's list, so any
    path that undoes a spin has to put it back or the category is gone for
    good.
    """
    category = (category or "").strip()
    if not category:
        return False
    with file_lock(WHEEL_PATH):
        wb = _load_wb()
        ws = wb.active
        col = find_person_column(ws, person_key)
        if col is None:
            return False
        row_idx, target = 2, _norm(category)
        while ws.cell(row_idx, col).value is not None:
            if _norm(str(ws.cell(row_idx, col).value).strip()) == target:
                return False  # still there, nothing to restore
            row_idx += 1
        ws.cell(row_idx, col).value = category
        wb.save(WHEEL_PATH)
    return True


def find_category_owner(category: str) -> str | None:
    """Wheel key of whoever still has `category` on their list, if anyone.

    Lets a hand-typed category be retired from the wheel after the night is
    scored, even though it never went through a spin.
    """
    target = _norm(category or "")
    if not target:
        return None
    for key, cats in get_wheel_data()["categories"].items():
        if any(_norm(c) == target for c in cats):
            return key
    return None


def _find_col_with_category(ws, people_cols: dict, person_key: str, category: str) -> int | None:
    """Find the column index that belongs to person_key (by display-name match) and contains category."""
    from config import normalize_name
    display_key = normalize_name(person_key)
    for col_idx, col_key in people_cols.items():
        if normalize_name(col_key) == display_key:
            r = 2
            while ws.cell(r, col_idx).value is not None:
                if str(ws.cell(r, col_idx).value).strip() == category:
                    return col_idx
                r += 1
    # Fallback: exact key match (any column with the same key)
    for col_idx, col_key in people_cols.items():
        if col_key == person_key:
            return col_idx
    return None


@locked(lambda: WHEEL_PATH)
def record_spin(person_key: str, category: str):
    wb = _load_wb()
    ws = wb.active
    people_cols, trafione_col, category_col = _get_structure(ws)

    if not trafione_col:
        return

    # Record spin in history
    row_idx = 2
    while ws.cell(row_idx, trafione_col).value is not None:
        row_idx += 1
    ws.cell(row_idx, trafione_col).value = person_key
    if category_col:
        ws.cell(row_idx, category_col).value = category

    # Auto-remove from person's category list in same write
    col = _find_col_with_category(ws, people_cols, person_key, category)
    if col:
        values, r = [], 2
        while ws.cell(r, col).value is not None:
            values.append(str(ws.cell(r, col).value).strip())
            r += 1
        values = [v for v in values if v != category]
        for ri in range(2, r + 1):
            ws.cell(ri, col).value = None
        for ri, val in enumerate(values, start=2):
            ws.cell(ri, col).value = val

    wb.save(WHEEL_PATH)


@locked(lambda: WHEEL_PATH)
def delete_category(person_key: str, category: str):
    wb = _load_wb()
    ws = wb.active
    people_cols, _, _ = _get_structure(ws)

    col = _find_col_with_category(ws, people_cols, person_key, category)
    if col is None:
        return

    # Collect all values in the column
    values = []
    row_idx = 2
    while ws.cell(row_idx, col).value is not None:
        values.append(str(ws.cell(row_idx, col).value).strip())
        row_idx += 1

    # Remove first occurrence
    try:
        values.remove(category)
    except ValueError:
        return

    # Clear and rewrite compactly
    for r in range(2, row_idx + 1):
        ws.cell(r, col).value = None
    for r, val in enumerate(values, start=2):
        ws.cell(r, col).value = val

    wb.save(WHEEL_PATH)


@locked(lambda: WHEEL_PATH)
def delete_history_entry(row_idx: int):
    wb = _load_wb()
    ws = wb.active
    _, trafione_col, category_col = _get_structure(ws)

    if not trafione_col:
        return

    # Collect all existing history entries
    history_entries = []
    for row in ws.iter_rows(min_row=2):
        person_val = row[trafione_col - 1].value
        if person_val is not None:
            cat_val = row[category_col - 1].value if category_col and category_col - 1 < len(row) else None
            history_entries.append((row[0].row, str(person_val).strip(), str(cat_val).strip() if cat_val else ""))

    # Remove target entry
    history_entries = [(r, p, c) for (r, p, c) in history_entries if r != row_idx]

    # Clear all history cells
    for r in range(2, ws.max_row + 1):
        ws.cell(r, trafione_col).value = None
        if category_col:
            ws.cell(r, category_col).value = None

    # Rewrite compactly
    for i, (_, person, cat) in enumerate(history_entries, start=2):
        ws.cell(i, trafione_col).value = person
        if category_col:
            ws.cell(i, category_col).value = cat

    wb.save(WHEEL_PATH)


@locked(lambda: WHEEL_PATH)
def edit_history_entry(row_idx: int, person_key: str, category: str):
    wb = _load_wb()
    ws = wb.active
    _, trafione_col, category_col = _get_structure(ws)
    if not trafione_col:
        return
    ws.cell(row_idx, trafione_col).value = person_key.strip()
    if category_col:
        ws.cell(row_idx, category_col).value = category.strip()
    wb.save(WHEEL_PATH)


@locked(lambda: WHEEL_PATH)
def reorder_history(ordered_row_indices: list):
    wb = _load_wb()
    ws = wb.active
    _, trafione_col, category_col = _get_structure(ws)
    if not trafione_col:
        return
    # Read all entries indexed by row number
    entries_by_row: dict[int, tuple] = {}
    for row in ws.iter_rows(min_row=2):
        person_val = row[trafione_col - 1].value
        if person_val is not None:
            r = row[0].row
            cat_val = row[category_col - 1].value if category_col and category_col - 1 < len(row) else None
            entries_by_row[r] = (str(person_val).strip(), str(cat_val).strip() if cat_val else "")
    ordered = [entries_by_row[r] for r in ordered_row_indices if r in entries_by_row]
    # Clear and rewrite in new order
    for r in range(2, ws.max_row + 1):
        ws.cell(r, trafione_col).value = None
        if category_col:
            ws.cell(r, category_col).value = None
    for i, (person, cat) in enumerate(ordered, start=2):
        ws.cell(i, trafione_col).value = person
        if category_col:
            ws.cell(i, category_col).value = cat
    wb.save(WHEEL_PATH)


@locked(lambda: WHEEL_PATH)
def add_history_entry(person_key: str, category: str):
    wb = _load_wb()
    ws = wb.active
    _, trafione_col, category_col = _get_structure(ws)
    if not trafione_col:
        return
    row_idx = 2
    while ws.cell(row_idx, trafione_col).value is not None:
        row_idx += 1
    ws.cell(row_idx, trafione_col).value = person_key.strip()
    if category_col:
        ws.cell(row_idx, category_col).value = category.strip()
    wb.save(WHEEL_PATH)


def find_person_column(ws, name: str) -> int | None:
    """Column index whose header matches `name` (case-insensitive), or None."""
    from config import normalize_name
    people_cols, _, _ = _get_structure(ws)
    target = name.strip().lower()
    for col, key in people_cols.items():
        if key.strip().lower() == target:
            return col
    # Fall back to display-name equality, so "Bartosz" finds the "bart" column
    display = normalize_name(name).lower()
    for col, key in people_cols.items():
        if normalize_name(key).lower() == display:
            return col
    return None


@locked(lambda: WHEEL_PATH)
def add_person_to_wheel(name: str) -> bool:
    """Add a column for a person before the dupa column.

    Returns True if a column was created, False if one already existed.
    """
    wb = _load_wb()
    ws = wb.active
    if find_person_column(ws, name) is not None:
        return False

    _, trafione_col, _ = _get_structure(ws)
    # Insert before dupa (which is trafione_col - 1)
    insert_before = (trafione_col - 1) if trafione_col else ws.max_column
    ws.insert_cols(insert_before, 1)
    ws.cell(1, insert_before).value = name.lower()
    wb.save(WHEEL_PATH)
    return True
