import pytest
from excel.scores import save_session
from conftest import wheel_entry
from drawing import recency
from test_draw_modes import start, finish
from test_wheel import read_config, write_config


def night(hosts, index=0, people=None):
    people = people or ['Xero', 'Kaja', 'Bartosz']
    title = f'Recency film {index}'
    save_session([title], f'Noc {index}', {title: {p: 8 for p in people}}, people, hosts=hosts)


@pytest.mark.parametrize('age,factor', [(1, 0), (2, .5), (3, .75), (4, .875), (5, .9375), (20, 1 - 2**-19)])
def test_penalty_halves_with_each_night(age, factor):
    assert recency('Xero', [set()] * (age - 1) + [{'Xero'}], 1) == (age, factor)


def test_never_selected_has_full_weight_and_latest_win_wins():
    assert recency('Xero', [set()]) == (None, 1)
    assert recency('Xero', [{'Xero'}, set(), {'Xero'}], 1) == (1, 0)


def test_api_uses_ticket_count_times_penalty(client):
    night(['Kaja'], 1)
    night(['Bartosz'], 2)
    entries = {e['name']: e for e in client.get('/api/wheel/data').json()['entries']}
    assert entries['Xero']['weight'] == 3
    assert entries['Kaja']['weight'] == 1  # Two tickets at half weight.
    assert entries['Bartosz']['weight'] == 0
    assert entries['Xero']['probability'] == .75
    assert entries['Kaja']['probability'] == .25
    assert entries['Bartosz']['probability'] == 0


def test_two_hosts_are_blocked_for_one_night_then_recover_together(client):
    night(['Xero', 'Kaja'])
    assert wheel_entry(client, 'Xero')['weight'] == 0
    assert wheel_entry(client, 'Kaja')['weight'] == 0
    assert start(client, 'single')['picks'][0]['person'] == 'Bartosz'
    night(['Bartosz'], 1)
    assert wheel_entry(client, 'Xero')['recency_multiplier'] == .5
    assert wheel_entry(client, 'Kaja')['recency_multiplier'] == .5


def test_cohost_uses_penalties_and_excludes_previous_hosts(client, data_dir, monkeypatch):
    client.post('/api/wheel/person', json={'name': 'Zosia'})
    night(['Kaja'], 0)
    night(['Zosia'], 1, ['Xero', 'Kaja', 'Bartosz', 'Zosia'])
    config = read_config(data_dir)
    config['forced_spin'] = {'person_key': 'xero', 'category': 'Kosmos'}
    write_config(data_dir, config)
    draw = start(client, 'cohost')
    assert draw['eligible_people'] == ['Bartosz', 'Kaja']
    assert draw['person_weights'] == {'Bartosz': 1, 'Kaja': .5}
    calls = []
    def choose(pool, weights, k):
        calls.append((pool, weights))
        return [pool[0]]
    monkeypatch.setattr('routes.wheel.random.choices', choose)
    result = finish(client, draw)
    assert calls == [(['Bartosz', 'Kaja'], [1, .5])]
    assert result['hosts'] == ['Xero', 'Bartosz']


def test_no_fallback_to_blocked_people_and_no_consumed_ticket(client):
    night(['Xero', 'Kaja', 'Bartosz'])
    before = client.get('/api/wheel/data').json()
    assert all(e['probability'] == 0 for e in before['entries'])
    assert client.post('/api/wheel/draw', json={'mode': 'single'}).status_code == 400
    assert client.get('/api/wheel/data').json() == before


def test_legacy_and_forced_spins_cannot_bypass_zero_weight(client, data_dir):
    night(['Xero'])
    forced = {'person_key': 'xero', 'category': 'Kosmos'}
    config = read_config(data_dir)
    config['forced_spin'] = forced
    write_config(data_dir, config)
    before = client.get('/api/wheel/data').json()
    assert client.post('/api/wheel/spin', json=forced).status_code == 400
    assert client.post('/api/wheel/draw', json={'mode': 'single'}).status_code == 400
    assert client.get('/api/wheel/data').json() == before


def test_historical_aliases_and_config_fallback(client, data_dir):
    config = read_config(data_dir)
    config['category_hosts'] = {'4': {'Kategoria startowa': 'bart'}}
    write_config(data_dir, config)
    assert wheel_entry(client, 'Bartosz')['weight'] == 0


def test_undo_does_not_age_or_change_penalties(client):
    night(['Kaja'])
    before = {e['name']: e['recency_multiplier'] for e in client.get('/api/wheel/data').json()['entries']}
    draw = start(client, 'single')
    client.delete(f"/api/wheel/last-spin?draw_id={draw['id']}")
    after = {e['name']: e['recency_multiplier'] for e in client.get('/api/wheel/data').json()['entries']}
    assert before == after


def test_simulation_advances_nights_without_writing(client):
    before = client.get('/api/wheel/data').json()
    picks = client.get('/api/wheel/simulate?rounds=50').json()['picks']
    assert len(picks) > 1
    assert all(a['person'] != b['person'] for a, b in zip(picks, picks[1:]))
    assert client.get('/api/wheel/data').json() == before
    assert client.get('/api/wheel/simulate?rounds=-1').status_code == 422


@pytest.mark.parametrize('mode', ['single', 'double_theme', 'cohost'])
def test_saved_night_blocks_both_roles_in_future_draws(client, mode):
    draw = start(client, mode)
    if draw['pending']:
        draw = finish(client, draw)
    categories = {f'Film {i}': pick['category'] for i, pick in enumerate(draw['picks'])}
    response = client.post('/api/scores/session', json={
        'movies': list(categories), 'movie_categories': categories,
        'scores': {m: {'Xero': 8, 'Kaja': 7, 'Bartosz': 9} for m in categories},
        'present_people': ['Xero', 'Kaja', 'Bartosz'],
    })
    assert response.status_code == 200, response.text
    data = client.get('/api/wheel/data').json()
    assert data['active_draw'] is None
    for entry in data['entries']:
        if entry['name'] in draw['hosts']:
            assert entry['recency_multiplier'] == 0
            assert entry['probability'] == 0
    assert set(client.get('/api/scores/nights').json()[-1]['host'].split(' + ')) == set(draw['hosts'])


@pytest.mark.parametrize('penalty', [0, .5, 1])
def test_configurable_penalty_applies_to_odds_and_cohost(client, admin_token, data_dir, penalty):
    response = client.put('/api/admin/draw-settings', json={'initial_penalty': penalty},
                          headers={'authorization': admin_token})
    assert response.status_code == 200
    assert read_config(data_dir)['draw_initial_penalty'] == penalty
    assert client.get('/api/admin/draw-settings', headers={'authorization': admin_token}).json() == {
        'initial_penalty': penalty, 'locked': False}
    night(['Kaja'], 0)
    night(['Bartosz'], 1)
    assert wheel_entry(client, 'Kaja')['weight'] == 2 * (1 - penalty / 2)
    assert wheel_entry(client, 'Bartosz')['weight'] == 1 - penalty
    config = read_config(data_dir)
    config['forced_spin'] = {'person_key': 'xero', 'category': 'Kosmos'}
    write_config(data_dir, config)
    draw = start(client, 'cohost')
    expected = {'Kaja': 1 - penalty / 2}
    if penalty < 1:
        expected['Bartosz'] = 1 - penalty
    assert draw['person_weights'] == expected
    assert 'Xero' not in draw['eligible_people']
    assert client.put('/api/admin/draw-settings', json={'initial_penalty': 0},
                      headers={'authorization': admin_token}).status_code == 409
    finish(client, draw)


@pytest.mark.parametrize('penalty', [0, .5, 1])
def test_configurable_decay(penalty):
    for age in range(1, 6):
        assert recency('Xero', [set()] * (age - 1) + [{'Xero'}], penalty) == (
            age, 1 - penalty / 2 ** (age - 1))
    assert recency('Xero', [set()], penalty) == (None, 1)


def test_draw_settings_require_admin_and_reject_other_values(client, admin_token, data_dir):
    before = read_config(data_dir)
    assert client.get('/api/admin/draw-settings').status_code == 401
    assert client.put('/api/admin/draw-settings', json={'initial_penalty': 0}).status_code == 401
    for value in [-1, .25, 2, 'invalid']:
        assert client.put('/api/admin/draw-settings', json={'initial_penalty': value},
                          headers={'authorization': admin_token}).status_code == 422
    assert read_config(data_dir) == before
    assert client.get('/api/admin/draw-settings', headers={'authorization': admin_token}).json()['initial_penalty'] == 1



def test_missing_setting_defaults_to_half_penalty(client, admin_token, data_dir):
    config = read_config(data_dir)
    config.pop('draw_initial_penalty', None)
    write_config(data_dir, config)
    assert client.get('/api/admin/draw-settings', headers={'authorization': admin_token}).json()['initial_penalty'] == .5
    night(['Kaja'])
    assert wheel_entry(client, 'Kaja')['recency_multiplier'] == .5
    assert recency('Kaja', [{'Kaja'}]) == (1, .5)
