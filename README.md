# Movie Night 🎬

Scoring, statistics and a category wheel for a recurring movie night. FastAPI
backend, React + TypeScript frontend, and two Excel workbooks as the database —
because that is where the history already lived.

Live at [nocki.xerobox.pl](https://nocki.xerobox.pl).

## The evening, in order

1. **Ocenianie** — write down the films that were watched, tick who is here
   (and add anyone new right there), then everyone scores film 1, then film 2.
2. **Koło → Dodaj kategorie** — everyone adds their "ticket": a category they
   would like to see next time.
3. **Koło → Kręć!** — choose a mode (the default is the original single draw):
   - **Jeden temat** — one category and its owner.
   - **Dwa tematy** — two spins, two different categories from different people.
     Next night's setup has separate movie inputs for each theme. Scores and
     attendance still belong to one night; each film retains its own theme.
   - **Temat + druga osoba** — a category, then a person-only spin. The second
     selector is drawn from people who scored at least one film in the latest
     saved night, excluding the first selector. Guests without category tickets
     are eligible. Scoring stays the same as for one theme.

Theme draws use the number of remaining tickets as the base weight and include
all visible wheel participants regardless of attendance. Both theme draws and
extra-person draws apply the configured recency penalty. Administrators choose
**50% (default)**, 100%, or no penalty. The initial penalty halves each night:
50%, 25%, 12.5%, etc. in the default mode; 100%, 50%, 25%, etc. in the stricter
mode. Without a penalty, themes use ticket counts and eligible extra selectors
have equal weights. Settings cannot change between stages of a pending draw.
The extra-person draw starts with one ticket per eligible scorer. Weights are
then normalized to probabilities.
The most recent selection counts, in either role. Two themes count as one
completed night; spinning, reloading and undoing do not age the history.
When no eligible candidate has positive weight, drawing is blocked with an
explanation; zero-weight people are never used as a fallback.

The server saves each stage;
reload resumes an unfinished draw. Undo restores all drawn categories and the
previous next-night setting. A person-only spin does not consume a category.

Scoring in progress is kept in `localStorage`, so a locked phone or an
accidental reload does not lose the evening.

## Data

Everything lives in `data/`, mounted as a volume in Docker:

| File | What it holds |
| --- | --- |
| `scores.xlsx` | One sheet per season. Column A is the film (or the category heading), column B the average, then one column per person. |
| `spread.xlsx` | One column per person listing their unused categories, plus `trafione` / `kategoria` columns holding the draw history. |
| `config.json` | Admin password hash, hidden people, name aliases, person colours, which category each past night belonged to, next night date. |

New movie rows include a `Movie Night` cell comment identifying the row and
its theme. Night headings also store both selectors, including the extra person,
so their selection history survives repeated theme names. This also keeps movies
with no scores from being mistaken for category headings. Existing workbooks
need no migration; their hosts come from category assignments or wheel history.
`next_category`
retains its original summary fields and adds `themes`, `hosts`, `mode` and
`pending`; `active_draw` stores the resumable two-stage draw.

Names in the sheets are whatever was typed at the time (`bart`, `Ania 5`).
`config.json → name_map` maps them onto one canonical name, and the API only
ever hands out canonical names.

Every write takes an exclusive lock on the file (`backend/excel/locking.py`) and
`config.json` is written atomically, so two phones saving at once cannot lose
each other's changes.

## Running it

### Docker (how it is deployed)

```bash
./start.sh            # docker compose up --build → http://localhost:2000
```

### Locally

```bash
# backend — needs Python 3.10+ for the `X | None` type syntax
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000

# frontend (proxies /api to port 8000)
cd frontend
npm install
npm run dev
```

## Tests

```bash
cd backend && pytest        # API + workbook behaviour
cd frontend && npm test     # scoring flow and wheel components
```

The backend tests build a disposable miniature of `data/` in a temp directory
(`backend/tests/fixtures.py`) and rebuild it before every test — they never open
the real workbooks. The frontend tests run under jsdom with the API stubbed.

## Layout

```
backend/
  main.py              FastAPI app + static frontend
  config.py            config.json access, name canonicalisation, colours
  auth.py              admin session tokens
  excel/locking.py     re-entrant advisory file lock
  excel/scores.py      reading and writing scores.xlsx
  excel/wheel.py       reading and writing spread.xlsx
  routes/              /api/scores, /api/wheel, /api/admin
  tests/
frontend/src/
  pages/scoring/       the scoring flow (+ draft.ts, the localStorage draft)
  pages/wheel/         the wheel, the category grid, the draw history
  pages/stats|history|attendance|admin/
  components/          CasinoWheel, modals, drawers
```

## Deployment

The image builds the frontend and serves it from FastAPI, so `frontend/dist` is
not committed. `data/` is a bind mount — the container never bakes it in.
Deploy credentials live in `.env.deploy`, which is deliberately **not** in this
repository.
