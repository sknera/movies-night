import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from routes import scores, wheel, admin

app = FastAPI(title="Movie Night")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scores.router, prefix="/api/scores")
app.include_router(wheel.router, prefix="/api/wheel")
app.include_router(admin.router, prefix="/api/admin")

# Docker builds to /app/static; local dev builds to frontend/dist
_static_dir: Path | None = None
_here = Path(__file__).parent
for _candidate in [_here / "static", _here.parent / "frontend" / "dist"]:
    if _candidate.exists():
        _static_dir = _candidate
        _assets = _candidate / "assets"
        if _assets.exists():
            app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")
        break


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if _static_dir:
        target = _static_dir / full_path
        if target.is_file():
            return FileResponse(str(target))
        return FileResponse(str(_static_dir / "index.html"))
    return FileResponse("index.html")
