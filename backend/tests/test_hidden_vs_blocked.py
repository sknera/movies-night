"""Hiding someone and blocking them are two different statements.

Hidden: comes along now and then, just not often enough to earn a permanent
slot on the "kto jest dzis" list. Still a full player everywhere else.

Blocked: not coming back. Off the wheel and out of both draws, with every
score left exactly where it is.

The fixture blocks "Stary"; these tests hide and block people as they go.
"""
from test_wheel import read_config, write_config


def hide(client, admin_headers, name):
    assert client.put('/api/admin/people/hide', json={'name': name},
                      headers=admin_headers).status_code == 200


def block(client, admin_headers, name):
    assert client.put('/api/admin/people/block', json={'name': name},
                      headers=admin_headers).status_code == 200


def wheel_names(client):
    return [e['name'] for e in client.get('/api/wheel/data').json()['entries']]


def stats_names(client):
    return [s['name'] for s in client.get('/api/scores/stats').json()]


# ── Hiding is housekeeping ──────────────────────────────────────────────────

def test_hiding_only_takes_someone_off_tonights_list(client, admin_headers):
    hide(client, admin_headers, 'Kaja')

    assert 'Kaja' not in client.get('/api/scores/people').json()
    # ...and nowhere else.
    assert 'Kaja' in wheel_names(client)
    assert 'Kaja' in stats_names(client)


def test_a_hidden_person_can_still_win_the_theme_draw(client, admin_headers):
    hide(client, admin_headers, 'Kaja')

    entry = next(e for e in wheel_names(client) if e == 'Kaja')
    assert entry == 'Kaja'
    weights = {e['name']: e['weight'] for e in client.get('/api/wheel/data').json()['entries']}
    assert weights['Kaja'] > 0


def test_hiding_keeps_the_scores(client, admin_headers):
    before = client.get('/api/scores/nights').json()
    hide(client, admin_headers, 'Kaja')
    assert client.get('/api/scores/nights').json() == before


# ── Blocking is the end of the line ─────────────────────────────────────────

def test_blocking_removes_someone_from_every_list_and_the_wheel(client, admin_headers):
    block(client, admin_headers, 'Kaja')

    assert 'Kaja' not in client.get('/api/scores/people').json()
    assert 'Kaja' not in wheel_names(client)
    assert 'Kaja' not in stats_names(client)


def test_blocking_never_touches_the_history(client, admin_headers):
    before = client.get('/api/scores/nights').json()
    block(client, admin_headers, 'Kaja')
    assert client.get('/api/scores/nights').json() == before


def test_a_blocked_person_cannot_be_the_second_person(client, admin_headers, data_dir):
    """Even after scoring last night -- that is the whole point of blocking."""
    assert client.post('/api/scores/session', json={
        'movies': ['Film'], 'category': 'Dzisiaj',
        'present_people': ['Xero', 'Kaja', 'Bartosz'],
        'scores': {'Film': {'Xero': 8, 'Kaja': 7, 'Bartosz': 6}},
    }).status_code == 200
    assert 'Kaja' in client.get('/api/scores/last-night-people').json()

    block(client, admin_headers, 'Kaja')
    assert 'Kaja' not in client.get('/api/scores/last-night-people').json()

    config = read_config(data_dir)
    config['forced_spin'] = {'person_key': 'xero', 'category': 'Kosmos'}
    write_config(data_dir, config)
    draw = client.post('/api/wheel/draw', json={'mode': 'cohost'}).json()
    assert 'Kaja' not in draw['eligible_people']
    assert 'Kaja' not in draw['person_weights']


def test_a_hidden_person_is_still_eligible_as_the_second_person(client, admin_headers, data_dir):
    """Hiding says nothing about who was in the room last night."""
    assert client.post('/api/scores/session', json={
        'movies': ['Film'], 'category': 'Dzisiaj',
        'present_people': ['Xero', 'Kaja', 'Bartosz'],
        'scores': {'Film': {'Xero': 8, 'Kaja': 7, 'Bartosz': 6}},
    }).status_code == 200

    hide(client, admin_headers, 'Kaja')

    config = read_config(data_dir)
    config['forced_spin'] = {'person_key': 'xero', 'category': 'Kosmos'}
    write_config(data_dir, config)
    draw = client.post('/api/wheel/draw', json={'mode': 'cohost'}).json()
    assert 'Kaja' in draw['eligible_people']


# ── The two states never overlap ────────────────────────────────────────────

def test_blocking_supersedes_hiding_and_hiding_supersedes_blocking(client, admin_headers):
    hide(client, admin_headers, 'Kaja')
    block(client, admin_headers, 'Kaja')
    people = {p['name']: p for p in client.get('/api/admin/people', headers=admin_headers).json()}
    assert people['Kaja'] == {'name': 'Kaja', 'hidden': False, 'blocked': True}

    hide(client, admin_headers, 'Kaja')
    people = {p['name']: p for p in client.get('/api/admin/people', headers=admin_headers).json()}
    assert people['Kaja'] == {'name': 'Kaja', 'hidden': True, 'blocked': False}


def test_show_clears_both_states(client, admin_headers):
    block(client, admin_headers, 'Kaja')
    assert client.put('/api/admin/people/show', json={'name': 'Kaja'},
                      headers=admin_headers).status_code == 200
    people = {p['name']: p for p in client.get('/api/admin/people', headers=admin_headers).json()}
    assert people['Kaja'] == {'name': 'Kaja', 'hidden': False, 'blocked': False}
    assert 'Kaja' in client.get('/api/scores/people').json()


def test_unblocking_brings_back_the_person_who_turned_up_after_all(client, admin_headers):
    assert 'Stary' not in client.get('/api/scores/people').json()

    assert client.put('/api/admin/people/unblock', json={'name': 'Stary'},
                      headers=admin_headers).status_code == 200

    assert 'Stary' in client.get('/api/scores/people').json()
    assert 'Stary' in wheel_names(client)


def test_blocked_people_are_listed_so_they_can_be_unblocked(client, admin_headers):
    """They are off every other list, so the admin panel and the scoring
    screen are the only places left to find them."""
    people = {p['name']: p for p in client.get('/api/admin/people', headers=admin_headers).json()}
    assert people['Stary'] == {'name': 'Stary', 'hidden': False, 'blocked': True}

    candidates = {c['name']: c for c in client.get('/api/wheel/candidates', headers=admin_headers).json()}
    assert candidates['Stary']['blocked'] is True


def test_renaming_follows_a_blocked_person(client, admin_headers):
    assert client.put('/api/admin/people/rename', json={'old_name': 'Stary', 'new_name': 'Staruszek'},
                      headers=admin_headers).status_code == 200
    people = {p['name']: p for p in client.get('/api/admin/people', headers=admin_headers).json()}
    assert people['Staruszek']['blocked'] is True
    assert 'Staruszek' not in client.get('/api/scores/people').json()
