from fastapi import HTTPException

_sessions: set[str] = set()


def require_admin(authorization: str | None) -> str:
    if not authorization or authorization not in _sessions:
        raise HTTPException(401, "Unauthorized")
    return authorization
