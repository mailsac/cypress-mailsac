'use strict';

// Teaching app only: in-memory storage, one demonstration account, no production mail by default.
const http = require('node:http');
const { randomBytes, randomInt, createHash, scryptSync, timingSafeEqual } = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3037);
const mode = process.env.DEMO_MAIL_MODE || 'fixture';
const email = process.env.DEMO_EMAIL || 'cypress-demo@mailsac.test';
const initialPassword = 'demo-old-password';
const fixtureKey = process.env.MAILSAC_FIXTURE_KEY || 'local-fixture-key-not-a-real-credential';
const subject = 'Reset your Example App password';
const sender = process.env.SMTP_FROM || 'Example App <no-reply@example.test>';
const resetTtlMs = 5 * 60 * 1000;
let passwordHash;
let messages = [];
const resets = new Map();
const sessions = new Set();
let origin;
let smtp;

if (!['fixture', 'smtp'].includes(mode)) throw new Error('DEMO_MAIL_MODE must be fixture or smtp');
if (mode === 'smtp') {
  if (!process.env.DEMO_EMAIL || !process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error('SMTP mode requires DEMO_EMAIL, SMTP_HOST and SMTP_FROM');
  }
  smtp = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER ? {
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    } : {}),
  });
}

const digest = (value) => createHash('sha256').update(value).digest('hex');
const passwordDigest = (value) => scryptSync(value, 'demo-only-fixed-salt', 32);
function resetState() {
  passwordHash = passwordDigest(initialPassword);
  messages = [];
  resets.clear();
  sessions.clear();
}
resetState();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Example App</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#202631}label{display:block;margin:18px 0}input,button{font:inherit;padding:10px;box-sizing:border-box}input{display:block;width:100%;margin-top:6px}button{cursor:pointer}small{color:#596579}.notice{padding:14px;background:#eef5fb;border-radius:6px}a{color:#245bb0}</style></head><body><p><small>Example App · ${mode === 'fixture' ? 'local mail fixture' : 'SMTP mail'} · for learning only</small></p><h1>${title}</h1>${body}</body></html>`;
}
function html(res, status, title, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(title, body));
}
function redirect(res, path, headers = {}) {
  res.writeHead(303, { Location: path, ...headers });
  res.end();
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function form(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error('Request body too large');
  }
  return new URLSearchParams(body);
}
function addFixtureReset(token, code) {
  const now = Date.now();
  const metadata = (id, title, received, links, text, availableAt = 0) => ({
    _id: id, subject: title, received: new Date(received).toISOString(),
    to: [{ address: email }], from: [{ address: 'no-reply@example.test' }],
    links, text, availableAt,
  });
  const link = `${origin}/reset?token=${token}`;
  messages = [
    metadata('unrelated-newer-message', 'Your weekly digest', now + 1000, [`${origin}/help`], 'Your weekly newsletter.'),
    metadata('stale-reset-message', subject, now - 3600000, [`${origin}/reset?token=expired`], 'Your old verification code is 999999.'),
    metadata(`reset-${randomBytes(8).toString('hex')}`, subject, now,
      [link, `${origin}/help`], `Reset your password: ${link}\nYour verification code is ${code}.\nHelp: ${origin}/help`, now + 700),
  ];
}
async function sendReset() {
  const token = randomBytes(24).toString('hex');
  const code = String(randomInt(100000, 999999));
  const key = digest(token);
  resets.set(key, { expiresAt: Date.now() + resetTtlMs });
  try {
    if (mode === 'fixture') addFixtureReset(token, code);
    else {
      const link = `${origin}/reset?token=${token}`;
      await smtp.sendMail({
        from: sender, to: email, subject,
        text: `Reset your password: ${link}\nYour verification code is ${code}.\nThe reset link expires in 5 minutes.`,
        html: `<p><a href="${escapeHtml(link)}">Reset your password</a></p><p>Your verification code is ${code}.</p><p>The reset link expires in 5 minutes.</p>`,
      });
    }
  } catch {
    resets.delete(key);
    throw new Error('Mail transport failed. Check the server-side SMTP configuration.');
  }
}
function validToken(token) {
  const key = digest(token || '');
  const entry = resets.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    resets.delete(key);
    return false;
  }
  return true;
}
function api(req, res, url) {
  if (mode !== 'fixture') return json(res, 404, { error: 'Not found' });
  if (req.headers['mailsac-key'] !== fixtureKey) return json(res, 401, { error: 'Unauthorized fixture request' });
  const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
  const visible = messages.filter((message) => message.availableAt <= Date.now());
  if (segments[1] === 'addresses' && segments[2] === email && segments[3] === 'messages') {
    const clean = ({ text, availableAt, ...message }) => message;
    if (!segments[4]) return json(res, 200, visible.map(clean));
    const message = visible.find((item) => item._id === segments[4]);
    return message ? json(res, 200, clean(message)) : json(res, 404, { error: 'Message not found' });
  }
  if (segments[1] === 'text' && segments[2] === email) {
    const message = visible.find((item) => item._id === segments[3]);
    if (!message) return json(res, 404, { error: 'Message not found' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(message.text);
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, origin);
  try {
    if (url.pathname.startsWith('/api/') && req.method === 'GET') return api(req, res, url);
    if (url.pathname === '/__fixture/reset' && req.method === 'POST' && mode === 'fixture') {
      resetState();
      return json(res, 200, { email, initialPassword, mode });
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true, mode });
    if (url.pathname === '/' && req.method === 'GET') {
      return html(res, 200, 'Sign in', `${url.searchParams.has('error') ? '<p role="alert">Email or password is incorrect.</p>' : ''}<p class="notice">Demo account: <strong data-demo-email>${escapeHtml(email)}</strong><br>Initial password: <code>${initialPassword}</code></p><form method="post" action="/login"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><p><a href="/forgot-password">Forgot your password?</a></p>`);
    }
    if (url.pathname === '/forgot-password' && req.method === 'GET') {
      return html(res, 200, 'Reset your password', `${url.searchParams.has('sent') ? '<p role="status">If the account exists, a reset email is on its way.</p>' : ''}<form method="post" action="/forgot-password"><label>Email<input name="email" type="email" required></label><button type="submit">Send reset email</button></form><p><a href="/">Back to sign in</a></p>`);
    }
    if (url.pathname === '/forgot-password' && req.method === 'POST') {
      const data = await form(req);
      if (data.get('email') === email) await sendReset();
      return redirect(res, '/forgot-password?sent=1');
    }
    if (url.pathname === '/reset' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      if (!validToken(token)) return html(res, 400, 'Reset link unavailable', '<p role="alert">This reset link is invalid, expired, or has already been used.</p>');
      return html(res, 200, 'Choose a new password', `<form method="post" action="/reset"><input name="token" type="hidden" value="${escapeHtml(token)}"><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><button type="submit">Update password</button></form>`);
    }
    if (url.pathname === '/reset' && req.method === 'POST') {
      const data = await form(req);
      const token = data.get('token');
      const password = data.get('password') || '';
      if (!validToken(token)) return html(res, 400, 'Reset link unavailable', '<p role="alert">This reset link is invalid, expired, or has already been used.</p>');
      if (password.length < 12) return html(res, 400, 'Password too short', '<p>Use at least 12 characters.</p>');
      resets.delete(digest(token));
      passwordHash = passwordDigest(password);
      sessions.clear();
      return html(res, 200, 'Password updated', '<p role="status">Your new password is ready. Sign in to check it.</p><a href="/">Sign in</a>');
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const data = await form(req);
      if (data.get('email') !== email || !timingSafeEqual(passwordHash, passwordDigest(data.get('password') || ''))) return redirect(res, '/?error=1');
      const session = randomBytes(24).toString('hex');
      sessions.add(session);
      return redirect(res, '/account', { 'Set-Cookie': `demo_session=${session}; HttpOnly; SameSite=Lax; Path=/` });
    }
    if (url.pathname === '/account' && req.method === 'GET') {
      const session = (req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('demo_session='));
      if (!session || !sessions.has(session.slice('demo_session='.length))) return redirect(res, '/');
      return html(res, 200, 'Welcome back', '<p role="status">You signed in successfully with your new password.</p>');
    }
    return html(res, 404, 'Not found', '<a href="/">Go home</a>');
  } catch (error) {
    // Do not serialize SMTP errors: providers may include credentials or message contents.
    console.error(error.message === 'Request body too large' ? error.message : 'Example request failed. Check the local mail configuration.');
    return html(res, 500, 'Request failed', '<p>The local example could not complete this request.</p>');
  }
});
server.listen(PORT, HOST, () => {
  origin = `http://${HOST}:${server.address().port}`;
  console.log(`DEMO_READY ${JSON.stringify({ origin, mode })}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
