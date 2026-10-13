"""Recency penalties count movie nights, not individual wheel spins."""
from config import load_config, normalize_name
from excel.scores import get_all_nights
from excel.wheel import _norm


def recent_hosts(raw_data: dict) -> list[set[str]]:
    config = load_config()
    history_hosts = {}
    for item in raw_data['history']:
        history_hosts[_norm(item['category'])] = item['person']
    nights = []
    for night in get_all_nights():
        # New nights carry their own hosts, so repeated category names and
        # later edits to the wheel history cannot rewrite their ownership.
        hosts = night.get('hosts')
        if hosts is None:
            saved = config.get('category_hosts', {}).get(str(night['season']), {})
            names = saved.get(night['name'])
            if names:
                hosts = names.split(' + ')
            else:
                categories = {m.get('category') for m in night['movies']} | {night['name']}
                hosts = [history_hosts[_norm(c)] for c in categories if c and _norm(c) in history_hosts]
        nights.append({normalize_name(h) for h in hosts if h})
    return list(reversed(nights))


def recency(name: str, nights: list[set[str]], initial_penalty: float = 0.5) -> tuple[int | None, float]:
    age = next((i for i, hosts in enumerate(nights, 1) if name in hosts), None)
    # The initial penalty halves for each completed night. Zero disables it.
    return age, 1.0 if age is None else 1.0 - initial_penalty * 2.0 ** (1 - age)
