"""Advisory file locking around workbook / config writes.

Every write is a read-modify-write of a whole .xlsx file. Two phones hitting
"zapisz" at the same moment would otherwise silently lose one of the writes,
because openpyxl loads the workbook into memory and saves it back wholesale.
"""
import os
import threading
from contextlib import contextmanager
from functools import wraps
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows only
    fcntl = None

# flock() ties the lock to the open file description, so a second os.open() in
# the same thread would block on a lock that thread already owns. Routes do
# compose these helpers (undo a spin, then put the category back), so the lock
# counts re-entries per thread instead.
_held = threading.local()


def _depths() -> dict:
    d = getattr(_held, "depths", None)
    if d is None:
        d = _held.depths = {}
    return d


@contextmanager
def file_lock(path):
    """Exclusive, re-entrant advisory lock keyed on `<path>.lock`.

    The lock file sits next to the data file so it lands on the same mounted
    volume in Docker; a lock on a different filesystem would not be shared
    between processes.
    """
    key = str(path)
    depths = _depths()
    if depths.get(key, 0) > 0:
        depths[key] += 1
        try:
            yield
        finally:
            depths[key] -= 1
        return

    if fcntl is None:  # pragma: no cover - Windows only
        depths[key] = 1
        try:
            yield
        finally:
            depths[key] = 0
        return

    lock_path = Path(key + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        depths[key] = 1
        try:
            yield
        finally:
            depths[key] = 0
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def locked(path_getter):
    """Decorator: run the function holding the lock for `path_getter()`."""
    def decorate(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            with file_lock(path_getter()):
                return fn(*args, **kwargs)
        return wrapper
    return decorate
