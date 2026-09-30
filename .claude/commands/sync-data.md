Sync the `data/` directory between local and the Hetzner server (`root@167.233.102.51:/opt/xerobox/movies-night/data/`).

The user may pass an argument:
- `pull` (or no argument) — copy server → local
- `push` — copy local → server
- `both` — pull first, then push (useful after merging changes)

Run the appropriate rsync command(s) using the Bash tool and report what changed.

Pull command:
```
rsync -avz root@167.233.102.51:/opt/xerobox/movies-night/data/ /Users/adrian.charkiewicz/Projects/movies-night/data/
```

Push command:
```
rsync -avz /Users/adrian.charkiewicz/Projects/movies-night/data/ root@167.233.102.51:/opt/xerobox/movies-night/data/
```
