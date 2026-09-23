const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMailsacTasks } = require('../dist/node.js');

const API_KEY = 'unit-test-secret-must-never-appear-in-errors';
const AFTER = '2026-09-23T10:00:00.000Z';
const EMAIL = 'reset+run@mailsac.test';
const CRITERIA = { email: EMAIL, receivedAfter: AFTER, subject: 'Reset your password' };

function message(overrides = {}) {
  return {
    _id: 'message-new', subject: 'Reset your password', received: '2026-09-23T10:00:01.000Z',
    from: [{ address: 'support@example.test', name: 'Support' }],
    to: [{ address: EMAIL }], links: ['https://example.test/reset?token=test-token'],
    ...overrides,
  };
}

function json(res, body, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function fixture(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, at: performance.now() });
    handler(req, res, requests);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  return {
    requests, baseUrl,
    task(options = {}) {
      return createMailsacTasks({ apiKey: API_KEY, baseUrl, timeoutMs: 2000, pollIntervalMs: 250, ...options })['mailsac:waitForMessage'];
    },
  };
}

function standardHandler(req, res) {
  if (req.url.startsWith('/api/text/')) { res.setHeader('content-type', 'text/plain'); res.end('Your code is 123456'); }
  else if (req.url.includes('/messages?')) json(res, [message()]);
  else json(res, message());
}

test('polls past old and unrelated messages, selects the newest precise match, and fetches metadata plus text', async (t) => {
  let polls = 0;
  const expected = message({ _id: 'newest-match', received: '2026-09-23T10:00:02.000Z' });
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('/messages?')) {
      polls++;
      const unrelated = message({ _id: 'unrelated', subject: 'A different email', received: '2026-09-23T11:00:00.000Z' });
      const old = message({ _id: 'old', received: '2026-09-23T09:59:59.999Z' });
      json(res, polls === 1 ? [unrelated, old] : [message(), unrelated, expected, old]);
    } else if (req.url.startsWith('/api/text/')) {
      // Numeric-looking text must stay text, not become an Axios-parsed JSON number.
      res.setHeader('content-type', 'text/plain'); res.end('123456');
    } else json(res, { ...expected, internalDebug: API_KEY });
  });
  const result = await f.task()({ ...CRITERIA, from: 'SUPPORT@example.test', subjectIncludes: 'password' });
  assert.deepEqual(result, { ...expected, text: '123456' });
  assert.equal(polls, 2);
  assert.equal(f.requests.length, 4);
  assert.ok(f.requests.slice(2).every((req) => req.url.endsWith('/newest-match')));
  assert.ok(f.requests.every((req) => req.method === 'GET'));
  assert.ok(f.requests.every((req) => req.headers['mailsac-key'] === API_KEY));
  assert.ok(f.requests.every((req) => !req.url.includes(API_KEY)));
  assert.deepEqual([...new URL(f.requests[0].url, f.baseUrl).searchParams], [['limit', '100']]);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
});

test('encodes recipient and message identifier separately without changing the API query', async (t) => {
  const email = 'reset+flow/part?x=1#tag@mailsac.test';
  const id = 'message/part?x=2#tag';
  const expected = message({ _id: id, to: [{ address: email }] });
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('/messages?')) json(res, [expected]);
    else if (req.url.startsWith('/api/text/')) res.end('Reset now');
    else json(res, expected);
  });
  await f.task()({ ...CRITERIA, email });
  assert.equal(f.requests[0].url, `/api/addresses/${encodeURIComponent(email)}/messages?limit=100`);
  assert.equal(f.requests[1].url, `/api/addresses/${encodeURIComponent(email)}/messages/${encodeURIComponent(id)}`);
  assert.equal(f.requests[2].url, `/api/text/${encodeURIComponent(email)}/${encodeURIComponent(id)}`);
});

test('receivedAfter includes messages exactly at the boundary, and sender matches its address rather than display name', async (t) => {
  const expected = message({ received: AFTER });
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('/messages?')) json(res, [message({ _id: 'wrong-sender', from: [{ address: 'other@example.test', name: 'support@example.test' }] }), expected]);
    else if (req.url.startsWith('/api/text/')) res.end('Reset');
    else json(res, expected);
  });
  const result = await f.task()({ email: EMAIL, receivedAfter: AFTER, from: 'support@example.test' });
  assert.equal(result._id, expected._id);
});

test('an empty inbox times out within the total budget without overlapping requests', async (t) => {
  const f = await fixture(t, (_req, res) => json(res, []));
  const started = performance.now();
  await assert.rejects(f.task({ timeoutMs: 120 })(CRITERIA), /Timed out after 120 ms/);
  assert.ok(performance.now() - started < 600);
  assert.equal(f.requests.length, 1);
});

test('a stalled HTTP response is aborted within the same total budget', async (t) => {
  const f = await fixture(t, () => {});
  const started = performance.now();
  await assert.rejects(f.task({ timeoutMs: 120 })(CRITERIA), /Timed out after 120 ms/);
  assert.ok(performance.now() - started < 600);
  assert.equal(f.requests.length, 1);
});

for (const status of [401, 403, 400]) {
  test(`HTTP ${status} fails immediately without leaking headers, key, or response body`, async (t) => {
    const f = await fixture(t, (_req, res) => json(res, { message: API_KEY, detail: 'private server response' }, status));
    await assert.rejects(f.task()(CRITERIA), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      for (const value of [error.message, error.stack, JSON.stringify(error)]) {
        assert.ok(!value.includes(API_KEY));
        assert.ok(!value.includes('private server response'));
        assert.ok(!value.includes('mailsac-key'));
      }
      assert.equal(error.cause, undefined);
      assert.equal(error.config, undefined);
      return true;
    });
    assert.equal(f.requests.length, 1);
  });
}

test('refuses redirects instead of forwarding API credentials', async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(302, { Location: '/credential-collector' }); res.end();
  });
  await assert.rejects(f.task()(CRITERIA), /HTTP 302/);
  assert.equal(f.requests.length, 1);
  assert.ok(!f.requests.some((req) => req.url.includes('credential-collector')));
});

test('retries 429 and 5xx, respects Retry-After, and retries a body request without overlapping polls', async (t) => {
  let polls = 0;
  let bodyCalls = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('/messages?')) {
      polls++;
      if (polls === 1) return json(res, { error: API_KEY }, 429, { 'Retry-After': '1' });
      if (polls === 2) return json(res, {}, 503);
      return json(res, [message()]);
    }
    if (req.url.startsWith('/api/text/')) {
      bodyCalls++;
      if (bodyCalls === 1) return json(res, {}, 502);
      return res.end('Your code is 123456');
    }
    json(res, message());
  });
  const result = await f.task({ timeoutMs: 3000 })(CRITERIA);
  assert.equal(result.text, 'Your code is 123456');
  assert.equal(polls, 3);
  assert.equal(bodyCalls, 2);
  assert.ok(f.requests[1].at - f.requests[0].at >= 990);
});

test('a Retry-After beyond the deadline never extends the total timeout', async (t) => {
  const f = await fixture(t, (_req, res) => json(res, {}, 429, { 'Retry-After': '60' }));
  const started = performance.now();
  await assert.rejects(f.task({ timeoutMs: 120 })(CRITERIA), /Timed out/);
  assert.ok(performance.now() - started < 600);
  assert.equal(f.requests.length, 1);
});

test('rejects malformed API responses with a fixed, safe error', async (t) => {
  const f = await fixture(t, (_req, res) => json(res, { unexpected: API_KEY }));
  await assert.rejects(f.task()(CRITERIA), /invalid message list/);
});

test('revalidates full metadata before returning a message', async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url.includes('/messages?')) json(res, [message()]);
    else json(res, message({ subject: 'Wrong email' }));
  });
  await assert.rejects(f.task()(CRITERIA), /inconsistent message metadata/);
  assert.equal(f.requests.length, 2);
});

test('reads credentials from the Node environment when apiKey is omitted', async (t) => {
  const previous = process.env.MAILSAC_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.MAILSAC_API_KEY; else process.env.MAILSAC_API_KEY = previous; });
  process.env.MAILSAC_API_KEY = API_KEY;
  const f = await fixture(t, standardHandler);
  const task = createMailsacTasks({ baseUrl: f.baseUrl })['mailsac:waitForMessage'];
  await task(CRITERIA);
  assert.equal(f.requests[0].headers['mailsac-key'], API_KEY);
});

test('rejects invalid Node configuration without echoing values', () => {
  for (const baseUrl of ['http://example.test/api', `https://${API_KEY}@example.test/api`, `https://example.test/api?key=${API_KEY}`, `https://example.test/api#${API_KEY}`, 'file:///tmp/api']) {
    assert.throws(() => createMailsacTasks({ apiKey: API_KEY, baseUrl }), (error) => {
      assert.match(error.message, /baseUrl/); assert.ok(!error.message.includes(API_KEY)); return true;
    });
  }
  for (const value of [0, -1, 120001, 1.1, '100']) assert.throws(() => createMailsacTasks({ apiKey: API_KEY, timeoutMs: value }), /timeoutMs/);
  for (const value of [249, 10001, NaN, '1000']) assert.throws(() => createMailsacTasks({ apiKey: API_KEY, pollIntervalMs: value }), /pollIntervalMs/);
  for (const apiKey of ['', '  ', `${API_KEY}\r\nInjected: header`]) assert.throws(() => createMailsacTasks({ apiKey }), /MAILSAC_API_KEY/);
});

test('rejects invalid matching criteria before making an API call', async (t) => {
  const f = await fixture(t, standardHandler);
  const task = f.task();
  const cases = [
    null, {}, { ...CRITERIA, email: `not-an-email-${API_KEY}` },
    { ...CRITERIA, email: 'x@' }, { ...CRITERIA, email: '../bad@domain.test' },
    { ...CRITERIA, receivedAfter: '2026-09-23' }, { ...CRITERIA, receivedAfter: 'invalid' },
    { ...CRITERIA, receivedAfter: '2026-09-23T10:00:00' },
    { email: EMAIL, receivedAfter: AFTER }, { ...CRITERIA, subject: '' },
    { ...CRITERIA, subjectIncludes: ' ' }, { ...CRITERIA, from: 'Support' },
    { ...CRITERIA, timeoutMs: 0 }, { ...CRITERIA, pollIntervalMs: 100 },
  ];
  for (const input of cases) {
    await assert.rejects(task(input), (error) => {
      assert.equal(error.name, 'MailsacError'); assert.ok(!error.message.includes(API_KEY)); return true;
    });
  }
  assert.equal(f.requests.length, 0);
});
