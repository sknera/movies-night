"""Multi-stage draws and two-theme nights on disposable workbooks."""
from concurrent.futures import ThreadPoolExecutor
import pytest
from test_wheel import read_config, write_config


def force(data_dir):
    config = read_config(data_dir)
    config['forced_spin'] = {'person_key': 'xero', 'category': 'Kosmos'}
    write_config(data_dir, config)


def start(client, mode):
    response = client.post('/api/wheel/draw', json={'mode': mode})
    assert response.status_code == 200, response.text
    return response.json()


def finish(client, draw):
    response = client.post(f"/api/wheel/draw/{draw['id']}/next")
    assert response.status_code == 200, response.text
    return response.json()


def score(client, scores, people=None, categories=None):
    return client.post('/api/scores/session', json={
        'movies': list(scores), 'category': 'Dzisiaj', 'scores': scores,
        'present_people': people if people is not None else ['Xero', 'Kaja', 'Bartosz'],
        'movie_categories': categories,
    })


def test_single_still_has_one_theme(client, data_dir):
    force(data_dir)
    draw = start(client, 'single')
    assert not draw['pending']
    assert draw['picks'] == [{'person_key': 'xero', 'person': 'Xero', 'category': 'Kosmos'}]
    assert client.get('/api/wheel/next-category').json()['category'] == 'Kosmos'


@pytest.mark.parametrize('mode', ['single', 'double_theme', 'cohost'])
def test_first_draw_keeps_original_weights_and_absent_people(client, monkeypatch, mode):
    assert score(client, {'Film': {'Kaja': 8, 'Bartosz': 7}}).status_code == 200
    before = client.get('/api/wheel/data').json()['entries']
    calls = []
    def choose(pool, weights, k):
        calls.append((pool, weights))
        return [pool[0]]
    monkeypatch.setattr('routes.wheel.random.choices', choose)
    draw = start(client, mode)
    pool, weights = calls[0]
    expected = [(e['name'], c, e['weight'] / len(e['categories']))
                for e in before for c in e['categories']]
    assert [(p['person'], p['category'], w) for p, w in zip(pool, weights)] == expected
    assert draw['picks'][0]['person'] == 'Xero'  # Did not score tonight.


def test_two_distinct_themes_and_owners_and_idempotent_second_spin(client, data_dir):
    client.post('/api/wheel/categories', json={'categories': {'kaja': ['Kosmos', 'KOSMOS 🌌']}})
    force(data_dir)
    count = len(client.get('/api/wheel/data').json()['history'])
    first = start(client, 'double_theme')
    assert first['pending']
    assert client.get('/api/wheel/data').json()['active_draw'] == first
    second = finish(client, first)
    assert not second['pending']
    a, b = second['picks']
    assert a['person'] != b['person']
    assert b['category'].lower() not in ('kosmos', 'kosmos 🌌')
    assert len(client.get('/api/wheel/next-category').json()['themes']) == 2
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(lambda _: finish(client, first), range(3))) == [second] * 3
    assert len(client.get('/api/wheel/data').json()['history']) == count + 2


def test_cohost_only_actual_scorers_including_guests_without_tickets(client, data_dir):
    client.post('/api/wheel/person', json={'name': 'Zosia'})
    assert score(client, {'A': {'Xero': 8, 'Kaja': None, 'Zosia': None},
                          'B': {'Zosia': 7, 'Bartosz': 9}},
                 people=['Xero', 'Kaja', 'Zosia']).status_code == 200
    force(data_dir)
    first = start(client, 'cohost')
    assert first['eligible_people'] == ['Zosia']  # Kaja skipped; Bartosz absent.
    before = client.get('/api/wheel/data').json()
    second = finish(client, first)
    after = client.get('/api/wheel/data').json()
    assert second['hosts'] == ['Xero', 'Zosia']
    assert len(second['picks']) == 1
    assert before['history'] == after['history']
    assert before['entries'] == after['entries']
    assert after['next_category']['category'] == 'Kosmos'


def test_no_scores_does_not_reuse_old_attendance(client):
    assert score(client, {'Bez ocen': {'Xero': None}}).status_code == 200
    before = client.get('/api/wheel/data').json()
    assert before['eligible_people'] == []
    assert client.post('/api/wheel/draw', json={'mode': 'cohost'}).status_code == 400
    assert client.get('/api/wheel/data').json() == before
    assert client.get('/api/scores/nights').json()[-1]['movies'][0]['title'] == 'Bez ocen'


@pytest.mark.parametrize('mode,complete', [('double_theme', True), ('double_theme', False), ('cohost', True)])
def test_undo_restores_whole_draw_and_previous_night(client, data_dir, mode, complete):
    config = read_config(data_dir)
    config['next_category'] = {'category': 'Poprzedni', 'person': 'Kaja'}
    config['next_night_date'] = '2020-01-01'
    write_config(data_dir, config)
    force(data_dir)
    before = client.get('/api/wheel/data').json()
    draw = start(client, mode)
    if complete:
        draw = finish(client, draw)
    response = client.delete(f"/api/wheel/last-spin?draw_id={draw['id']}")
    assert response.status_code == 200, response.text
    after = client.get('/api/wheel/data').json()
    for key in ('history', 'next_category', 'forced_spin'):
        assert after[key] == before[key]
    assert after['active_draw'] is None
    for old, new in zip(before['entries'], after['entries']):
        assert sorted(old['categories']) == sorted(new['categories'])
    assert read_config(data_dir)['next_night_date'] == '2020-01-01'


def test_pending_cannot_be_overwritten_or_scored(client):
    draw = start(client, 'double_theme')
    assert client.post('/api/wheel/draw', json={'mode': 'single'}).status_code == 409
    assert client.post('/api/wheel/spin', json={'person_key': 'bart', 'category': 'Western'}).status_code == 409
    assert score(client, {'Film': {'Xero': 8}}).status_code == 409
    assert client.get('/api/wheel/data').json()['active_draw'] == draw


def test_two_themes_score_as_one_night_and_keep_movie_topics(client, data_dir):
    force(data_dir)
    draw = finish(client, start(client, 'double_theme'))
    a, b = [p['category'] for p in draw['picks']]
    count = len(client.get('/api/scores/nights').json())
    response = score(client, {'Film A': {'Xero': 8}, 'Film B': {'Kaja': 9}, 'Film C': {}},
                     categories={'Film A': a, 'Film B': b, 'Film C': b})
    assert response.status_code == 200, response.text
    nights = client.get('/api/scores/nights').json()
    assert len(nights) == count + 1
    assert nights[-1]['name'] == f'{a} + {b}'
    assert [m['category'] for m in nights[-1]['movies']] == [a, b, b]
    assert client.get('/api/wheel/next-category').json() is None
    assert client.get('/api/wheel/data').json()['eligible_people'] == ['Kaja', 'Xero']
    assert [m['category'] for m in client.get('/api/scores/movies').json()[-3:]] == [a, b, b]
    assert client.delete(f"/api/wheel/last-spin?draw_id={draw['id']}").status_code == 409
    hosts = read_config(data_dir)['category_hosts']['4']
    for pick in draw['picks']:
        assert hosts[pick['category']] == pick['person']


def test_validation_and_empty_presence(client):
    assert score(client, {'A': {'Xero': 8}, 'B': {}}, categories={'A': 'Kosmos'}).status_code == 400
    assert score(client, {'Film': {}, 'film': {}}).status_code == 400
    assert score(client, {'Film': {'Xero': 11}}).status_code == 422
    assert score(client, {'Film': {'Xero': 8}}, people=[]).status_code == 200
    assert client.get('/api/wheel/data').json()['eligible_people'] == []


def test_concurrent_scoring_keeps_both_nights(client):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda i: score(client, {f'Film {i}': {'Xero': 8}}), range(2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert {n['movies'][0]['title'] for n in client.get('/api/scores/nights').json()[-2:]} == {'Film 0', 'Film 1'}


def test_second_person_has_one_equal_chance_per_canonical_scorer(client, data_dir, monkeypatch):
    assert score(client, {'A': {'Xero': 8, 'Kaja': 7}, 'B': {'Bartosz': 9, 'Kaja': 6}}).status_code == 200
    force(data_dir)
    draw = start(client, 'cohost')
    pools = []
    def choose(people, weights, k):
        pools.append((people, weights))
        return [people[0]]
    monkeypatch.setattr('routes.wheel.random.choices', choose)
    finish(client, draw)
    assert pools == [(['Bartosz', 'Kaja'], [1, 1])]


def test_insufficient_second_theme_or_person_changes_nothing(client, data_dir):
    config = read_config(data_dir)
    config['hidden_people'] = ['Stary', 'Kaja', 'Bartosz']
    write_config(data_dir, config)
    assert score(client, {'A': {'Xero': 8}}).status_code == 200
    before = client.get('/api/wheel/data').json()
    for mode in ('double_theme', 'cohost'):
        assert client.post('/api/wheel/draw', json={'mode': mode}).status_code == 400
        assert client.get('/api/wheel/data').json() == before


def test_old_client_cannot_undo_someone_elses_new_draw(client):
    old = start(client, 'single')
    current = start(client, 'single')
    assert client.delete(f"/api/wheel/last-spin?draw_id={old['id']}").status_code == 409
    assert client.get('/api/wheel/data').json()['active_draw'] == current
