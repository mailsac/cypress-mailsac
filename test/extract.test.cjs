const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractLink, extractCode } = require('../dist');

test('link extraction checks origin and path, ignores unrelated and malformed links', () => {
  const expected = 'https://example.com/reset?token=fixture';
  const message = { links: ['invalid', 'https://example.com.evil.test/reset',
    'https://evil.test/reset', 'https://example.com/help', expected, expected] };
  assert.equal(extractLink(message, { origin: 'https://example.com', pathname: '/reset' }), expected);
});

test('link extraction rejects missing and ambiguous results without revealing tokens', () => {
  assert.throws(() => extractLink({ links: [] }, { origin: 'https://example.com' }), /found 0/);
  assert.throws(() => extractLink({ links: ['https://example.com/?token=first', 'https://example.com/?token=second'] },
    { origin: 'https://example.com' }), /^Error: Mailsac: expected one distinct matching link; found 2\.$/);
});

test('link extraction rejects credentials, unsafe schemes and invalid origins', () => {
  for (const origin of ['bad', 'javascript:alert(1)', 'https://example.com/reset', 'https://user:password@example.com', 'https://example.com/?x=1']) {
    assert.throws(() => extractLink({ links: [] }, { origin }), /Mailsac:/);
  }
  assert.throws(() => extractLink({ links: ['https://user:password@example.com/reset'] }, { origin: 'https://example.com' }), /found 0/);
});

test('code extraction supports OTP, repeats, and explicit capture groups', () => {
  assert.equal(extractCode({ text: 'Your code is 123456. Repeat: 123456.' }), '123456');
  assert.equal(extractCode({ text: 'Code: ABC-123' }, { pattern: 'code: ([A-Z]+-\\d+)', flags: 'i', group: 1 }), 'ABC-123');
});

test('code extraction refuses ambiguous, missing, empty or malformed matches', () => {
  assert.throws(() => extractCode({ text: '123456 654321' }), /found 2/);
  assert.throws(() => extractCode({ text: '1234567' }), /found 0/);
  assert.throws(() => extractCode({ text: 'abc' }, { pattern: '.*?' }), /found 0/);
  assert.throws(() => extractCode({ text: '' }, { pattern: '[' }), /invalid code pattern/);
  assert.throws(() => extractCode({ text: '' }, { flags: 'g' }), /invalid code capture/);
  assert.throws(() => extractCode({ text: '' }, { group: -1 }), /invalid code capture/);
});
