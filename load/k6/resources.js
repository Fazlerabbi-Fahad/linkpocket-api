// NFR-P5, NFR-P6, AC-19: 200 concurrent users working the resource endpoints of a staging
// deployment. Fails (non-zero exit) when a target is missed. See docs/runbooks/load-testing.md.
//
//   k6 run -e BASE_URL=https://staging.example -e LOAD_TEST_PASSWORD=... load/k6/resources.js
//
// Accounts come from `pnpm --filter @linkpocket/api load:seed` (load-NNNN@loadtest.invalid,
// 500 links each). Requests go through the web origin, as browsers do (ADR-0002).
import { check, fail, group, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PASSWORD = __ENV.LOAD_TEST_PASSWORD;
const USERS = Number(__ENV.LOAD_USERS || 200);
const API = `${BASE_URL}/api/v1`;
const SEARCH_WORDS = ['design', 'kitchen', 'travel', 'typescript', 'garden', 'finance'];
const TAGS = ['reading', 'work', 'later', 'recipes', 'tools', 'ideas'];

export const options = {
  scenarios: {
    library: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '1m', target: USERS },
        { duration: __ENV.HOLD || '5m', target: USERS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // NFR-P5: resource endpoints, p95 under 300 ms at 200 concurrent users.
    'http_req_duration{endpoint:resources}': ['p(95)<300'],
    // AC-19 / NFR-P2: search over a 500-link library, p95 under 300 ms.
    'http_req_duration{name:search}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function email(vu) {
  const n = ((vu - 1) % USERS) + 1;
  return `load-${String(n).padStart(4, '0')}@loadtest.invalid`;
}

const session = { csrf: null };

function headers(name) {
  return {
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    tags: { endpoint: 'resources', name },
  };
}

function logIn() {
  const csrf = http.get(`${API}/auth/csrf`, { tags: { endpoint: 'auth', name: 'csrf' } });
  const login = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: email(__VU), password: PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.json('csrfToken') },
      tags: { endpoint: 'auth', name: 'login' },
    },
  );
  if (!check(login, { 'logged in': (r) => r.status === 200 })) {
    fail(`login failed with ${login.status}; seed the accounts and check the password`);
  }
  session.csrf = login.json('csrfToken');
}

export function setup() {
  if (!PASSWORD) fail('Set LOAD_TEST_PASSWORD to the password used by load:seed.');
  const ready = http.get(`${BASE_URL}/`, { tags: { endpoint: 'web', name: 'home' } });
  if (ready.status !== 200) fail(`${BASE_URL} answered ${ready.status}`);
}

export default function () {
  if (!session.csrf) logIn();
  const word = SEARCH_WORDS[(__VU + __ITER) % SEARCH_WORDS.length];
  const tag = TAGS[__ITER % TAGS.length];

  group('library', () => {
    const list = http.get(`${API}/resources?limit=50`, headers('list'));
    check(list, { 'list 200': (r) => r.status === 200 });
    const search = http.get(`${API}/resources?q=${word}`, headers('search'));
    check(search, {
      'search 200': (r) => r.status === 200,
      'search finds links': (r) => r.status === 200 && r.json('items.length') > 0,
    });
    const filtered = http.get(`${API}/resources?tag=${tag}`, headers('tag'));
    check(filtered, { 'tag 200': (r) => r.status === 200 });
  });

  group('save, pin, delete', () => {
    const created = http.post(
      `${API}/resources`,
      JSON.stringify({ url: `https://k6.example/${__VU}/${__ITER}`, tags: ['k6'] }),
      headers('create'),
    );
    if (!check(created, { 'create 201': (r) => r.status === 201 })) return;
    const id = created.json('resource.id');
    const pinned = http.patch(
      `${API}/resources/${id}`,
      JSON.stringify({ isPinned: true }),
      headers('pin'),
    );
    check(pinned, { 'pin 200': (r) => r.status === 200 });
    const one = http.get(`${API}/resources/${id}`, headers('get'));
    check(one, { 'get 200': (r) => r.status === 200 });
    const removed = http.del(`${API}/resources/${id}`, null, headers('delete'));
    check(removed, { 'delete 204': (r) => r.status === 204 });
  });

  // Think time between screens, so 200 VUs behave like 200 people rather than a flood.
  sleep(1 + Math.random());
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        thresholds: Object.fromEntries(
          Object.entries(data.metrics)
            .filter(([, metric]) => metric.thresholds)
            .map(([name, metric]) => [name, metric.thresholds]),
        ),
      },
      null,
      2,
    ),
    'load-summary.json': JSON.stringify(data, null, 2),
  };
}
