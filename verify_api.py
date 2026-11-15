import http.client
import json

def test():
    # 1. Admin Signin
    conn = http.client.HTTPConnection('localhost', 3001)
    headers = {'Content-Type': 'application/json'}
    body = json.dumps({'email': 'admin@cadence.internal', 'password': 'AdminPassword123!'})
    conn.request('POST', '/api/auth/signin', body, headers)
    res = conn.getresponse()
    admin_data = json.loads(res.read().decode('utf-8'))
    admin_token = admin_data['data']['session']['access_token']
    admin_role = admin_data['data']['user']['role']
    print(f"Admin signin: status={res.status}, role={admin_role}")

    # 2. Student Signin
    conn = http.client.HTTPConnection('localhost', 3001)
    body = json.dumps({'email': 'student@cadence.internal', 'password': 'StudentPassword123!'})
    conn.request('POST', '/api/auth/signin', body, headers)
    res = conn.getresponse()
    student_data = json.loads(res.read().decode('utf-8'))
    student_token = student_data['data']['session']['access_token']
    student_role = student_data['data']['user']['role']
    print(f"Student signin: status={res.status}, role={student_role}")

    # 3. List Journeys
    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('GET', '/api/learn/journeys', headers={'Authorization': f'Bearer {admin_token}'})
    res = conn.getresponse()
    journeys_data = json.loads(res.read().decode('utf-8'))
    journey_id = journeys_data['data'][0]['id']
    print(f"Fetched journey: id={journey_id}")

    # 4. Student Write Attempt (PUT /graph) -> Expect 403 Forbidden
    conn = http.client.HTTPConnection('localhost', 3001)
    student_headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {student_token}'}
    dummy_payload = json.dumps({'stages': [], 'edges': [], 'settings': {}})
    conn.request('PUT', f'/api/admin/journey/journeys/{journey_id}/graph', dummy_payload, student_headers)
    res = conn.getresponse()
    print(f"Student write to admin graph endpoint: status={res.status} (Expected 403) -> {'PASS' if res.status == 403 else 'FAIL'}")

    # 5. Student Write Attempt to Settings -> Expect 403 Forbidden
    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('PUT', f'/api/admin/journey/journeys/{journey_id}/settings', dummy_payload, student_headers)
    res = conn.getresponse()
    print(f"Student write to admin settings endpoint: status={res.status} (Expected 403) -> {'PASS' if res.status == 403 else 'FAIL'}")

    # 6. Admin Fetch Graph
    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('GET', f'/api/admin/journey/journeys/{journey_id}/graph', headers={'Authorization': f'Bearer {admin_token}'})
    res = conn.getresponse()
    graph_data = json.loads(res.read().decode('utf-8'))
    stages_count = len(graph_data['data']['stages'])
    edges_count = len(graph_data['data']['edges'])
    print(f"Admin fetch graph: status={res.status}, initial stages={stages_count}, edges={edges_count} -> {'PASS' if res.status == 200 else 'FAIL'}")

    # 7. Admin Save Graph with 2 new stages + wire + custom background
    stages = [
        {
            'id': 'stg_1',
            'journeyId': journey_id,
            'title': 'Stage 1: Pointers',
            'slug': 'stage-1-pointers',
            'x': 100,
            'y': 150,
            'color': '#6542C5',
            'icon': '⚡',
            'order': 0,
            'statusType': 'standard',
            'content': {'topics': ['Basics', 'Two-pointer'], 'resources': []}
        },
        {
            'id': 'stg_2',
            'journeyId': journey_id,
            'title': 'Stage 2: Sliding Window',
            'slug': 'stage-2-sliding-window',
            'x': 360,
            'y': 150,
            'color': '#00BCD4',
            'icon': '🧩',
            'order': 1,
            'statusType': 'standard',
            'content': {'topics': ['Window technique'], 'resources': []}
        }
    ]
    edges = [
        {
            'id': 'edge_1_2',
            'fromStageId': 'stg_1',
            'toStageId': 'stg_2',
            'style': 'curve',
            'color': '#00BCD4',
            'animated': True
        }
    ]
    settings = {
        'backgroundType': 'gradient',
        'gradient': {'from': '#1a1a2e', 'to': '#11998e', 'angle': 135},
        'themeColors': {'primary': '#6542C5', 'accent': '#00BCD4'},
        'overlayOpacity': 0.25
    }
    save_payload = json.dumps({'stages': stages, 'edges': edges, 'settings': settings, 'description': 'Automated verification test'})

    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('PUT', f'/api/admin/journey/journeys/{journey_id}/graph', save_payload, {'Content-Type': 'application/json', 'Authorization': f'Bearer {admin_token}'})
    res = conn.getresponse()
    print(f"Admin save graph: status={res.status} -> {'PASS' if res.status == 200 else 'FAIL'}")

    # 8. Verify Version Snapshot Created
    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('GET', f'/api/admin/journey/journeys/{journey_id}/versions', headers={'Authorization': f'Bearer {admin_token}'})
    res = conn.getresponse()
    ver_data = json.loads(res.read().decode('utf-8'))
    print(f"Admin versions list: count={len(ver_data['data'])} -> {'PASS' if len(ver_data['data']) > 0 else 'FAIL'}")

    # 9. Student Graph Endpoint fetch (GET /api/learn/journeys/:slug/graph)
    conn = http.client.HTTPConnection('localhost', 3001)
    conn.request('GET', '/api/learn/journeys/arrays-fundamentals/graph', headers={'Authorization': f'Bearer {student_token}'})
    res = conn.getresponse()
    stud_graph = json.loads(res.read().decode('utf-8'))
    stud_stages = len(stud_graph['data']['stages'])
    stud_edges = len(stud_graph['data']['edges'])
    print(f"Student graph read: status={res.status}, stages={stud_stages}, edges={stud_edges} -> {'PASS' if res.status == 200 and stud_stages == 2 and stud_edges == 1 else 'FAIL'}")

test()
