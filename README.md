# Mailsac for Cypress

Wait for the right email, follow a password-reset link, or extract a one-time code in Cypress. The API key stays in Cypress's Node process. Tests receive the matching message, its text, and its links.

[Create a Mailsac account](https://mailsac.com/register?utm_source=cypress&utm_medium=integration&utm_campaign=cypress_plugin&utm_content=readme) · [Mailsac API documentation](https://docs.mailsac.com/?utm_source=cypress&utm_medium=integration&utm_campaign=cypress_plugin&utm_content=docs) · [Runnable password-reset example](./examples/password-reset)

## Install

Requires Cypress 16 and a Node.js version supported by Cypress (22, 24, or 26+).

```sh
npm install --save-dev @mailsac/cypress
```

Set `MAILSAC_API_KEY` in your shell or CI secret store. Do **not** use a `CYPRESS_` prefix, put the key in `Cypress.env()` / `config.env`, or commit it.

Register the tasks in `cypress.config.js`:

```js
const { defineConfig } = require('cypress');
const { createMailsacTasks } = require('@mailsac/cypress/node');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      on('task', createMailsacTasks()); // Reads process.env.MAILSAC_API_KEY in Node.
      return config;
    },
  },
});
```

In `cypress/support/e2e.js` (or `.ts`):

```js
import '@mailsac/cypress/commands';
```

## Test a password reset

Replace the inbox, origin, subject, and selectors with your application's values. Use a test inbox you control and an API key authorized to read its bodies. Reset links are sensitive: use a private inbox or owned domain, and avoid recording live tokens in screenshots, videos, or logs.

```js
import { extractLink } from '@mailsac/cypress';

it('resets a password', () => {
  const email = 'your-test-inbox@mailsac.com';
  const origin = 'http://localhost:3000';

  cy.visit(`${origin}/forgot-password`);
  cy.get('[name=email]').type(email);

  cy.then(() => {
    // Capture immediately before triggering the email, not before a long setup.
    const receivedAfter = new Date().toISOString();
    cy.get('button[type=submit]').click();
    return cy.mailsacWaitForMessage({
      email,
      receivedAfter,
      subject: 'Reset your password',
      timeoutMs: 60_000,
    });
  }).then((message) => {
    const resetLink = extractLink(message, { origin, pathname: '/reset-password' });
    cy.visit(resetLink, { log: false });
    cy.get('[name=password]').type('A-new-test-password-123!', { log: false });
    cy.get('button[type=submit]').click();
    cy.contains('Password updated').should('be.visible');
  });
});
```

For a complete runnable app, including successful sign-in and rejection of a reused reset link, see the [password-reset example](./examples/password-reset). Its default mode is fully local: no account, credentials, or email sending. A separate opt-in SMTP mode tests real delivery to Mailsac.

## One-time codes

```js
import { extractCode } from '@mailsac/cypress';

cy.mailsacWaitForMessage({
  email: 'your-test-inbox@mailsac.com',
  receivedAfter,
  subject: 'Your verification code',
}).then((message) => {
  const code = extractCode(message); // One distinct standalone six-digit code.
  cy.get('[name=code]').type(code, { log: false });
});
```

For other formats, use `extractCode(message, { pattern: 'Code: ([A-Z0-9]{8})', group: 1 })`. Supported flags are `i`, `m`, `s`, and `u`. Helpers fail if no match or more than one distinct match is found; they never guess between different links or codes.

## API

### `cy.mailsacWaitForMessage(options)`

| Option | Meaning |
| --- | --- |
| `email` | Required recipient inbox. |
| `receivedAfter` | Required ISO timestamp with timezone. Only messages received at or after this time qualify. |
| `subject` | Exact, case-sensitive subject. |
| `subjectIncludes` | Case-sensitive subject substring. |
| `from` | Sender email address, compared case-insensitively. |
| `timeoutMs` | Total time including HTTP requests and retries; default 30,000 ms, maximum 120,000 ms. |
| `pollIntervalMs` | Poll interval; default 1,000 ms, minimum 250 ms, maximum 10,000 ms. |

At least one of `subject`, `subjectIncludes`, or `from` is required. All supplied filters must match. The newest matching message among the latest 100 messages is selected; its full metadata and text are then fetched. This is intended for dedicated test inboxes, not a high-volume shared catch-all. Use a distinct inbox or a unique subject per parallel test. Keep the test runner's clock synchronized with the mail service.

Returns `{ _id, subject, received, to, from, links, text }`. Recipients use `{ address, name? }`. The task does not delete mail, change inbox settings, or send email. Polling and body/metadata reads consume Mailsac API operations, so choose an appropriate interval for your plan and concurrency.

### `createMailsacTasks(options?)` — Node only

The `/node` entry point accepts `apiKey` (default `process.env.MAILSAC_API_KEY`), `baseUrl` (default `https://mailsac.com/api`), and default `timeoutMs` / `pollIntervalMs`. Direct `cy.task('mailsac:waitForMessage', criteria, { log: false, timeout: 130000 })` callers can use those defaults. The convenience command uses its own 30-second timeout unless given `timeoutMs` explicitly.

HTTPS is required except for loopback fixtures. API redirects are disabled so a redirect cannot forward the key. HTTP 401/403 errors fail immediately; 429 and 5xx responses retry within the total deadline, respecting `Retry-After`. Other request failures fail promptly. Errors omit credentials and response bodies. Message contents themselves are returned to your test: avoid logging them when using sensitive fixtures.

### `extractLink(message, { origin, pathname? })`

Returns one distinct HTTP(S) URL with the exact origin and, optionally, exact pathname. It rejects missing or ambiguous results and URLs containing credentials. Restrict the pathname to exclude same-origin help pages and other unrelated links to your app.

### `extractCode(message, options?)`

Returns one distinct code from the message text. Default pattern: `\\b\\d{6}\\b`. Optional `pattern`, `flags`, and capture `group` (default zero) select another format. Patterns are test-author configuration, not untrusted user input.

## Development

```sh
npm ci
npm test
npm run test:e2e
npm pack --dry-run
```

Unit tests cover matching, stale mail, timeouts, authorization failures, retries, path encoding, and safe error handling. Cypress drives the complete local example in CI on Node 22 and 24. Default tests never call production or send real email. The package uses the published `@mailsac/api` SDK; it adds no telemetry. The account and documentation links above carry campaign tags so Mailsac can measure visits from this integration.

## License

MIT. Maintained by Mailsac / Habitat AI Incorporated. [Report an issue](https://github.com/mailsac/cypress-mailsac/issues).
