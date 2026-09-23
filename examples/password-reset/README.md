# Password-reset example

This small app demonstrates the whole password-reset flow: request mail, wait for the right new message, follow its reset link, choose a password, and sign in. Reset tokens expire after five minutes and can only be used once.

It is a learning example, **not a production authentication service**. It has one in-memory account, a published demo password, a fixed password-hashing salt, no persistent storage or rate limiting, and binds only to `127.0.0.1`.

## Run offline first

From the repository root, with Node.js 22 or newer:

```sh
npm ci
npm run build
npm run test:e2e
```

The runner starts the app on a free loopback port, runs Cypress headlessly, and stops the app. It uses a local fixture that implements the Mailsac API endpoints the plugin needs; it sends no email, uses no real key, and makes no calls to Mailsac. The inbox contains an old reset message and a newer unrelated message. The correct reset email arrives after a delay, so the test exercises filtering and polling rather than assuming the first message is correct.

The assertions also check that the old password no longer works, the new one does, and the reset link cannot be reused. Both a reset URL and a six-digit verification code are extracted from the message; this app uses the URL to complete the reset.

For a manual look at the app:

```sh
npm run example
```

Open <http://127.0.0.1:3037>. The page displays the demonstration email address and initial password. In the default fixture mode, messages stay in memory rather than arriving in a real inbox. Use `npm run test:e2e` to see the complete automated flow.

## Run with a real Mailsac inbox

This is a separate, explicit opt-in run. It sends one password-reset email through **your SMTP provider** to a test inbox you control. Mailsac receives the email; it does not replace your application's mail sender.

1. Use a private Mailsac inbox or owned domain whose message bodies your API key can read. Avoid public inboxes for reset links.
2. Copy `.env.smtp.example` to `.env.smtp` in this directory, then fill it in locally. Keep the file out of source control. `SMTP_FROM` must be a sender accepted by your SMTP provider. `DEMO_EMAIL` is the receiving Mailsac inbox; the demo account uses that address.
3. Build the package, then start the app in one terminal, from the repository root:

   ```sh
   node --env-file=examples/password-reset/.env.smtp examples/password-reset/server.cjs
   ```

4. In another terminal, run the explicit live test:

   ```sh
   node --env-file=examples/password-reset/.env.smtp node_modules/cypress/bin/cypress run --config-file examples/password-reset/cypress.config.cjs
   ```

The app and Cypress read credentials from the local environment file. The Mailsac API key is used only by the Node-side tasks, never placed in `Cypress.env()` or delivered to the application browser. The test receives only message data. Recordings and automatic failure screenshots are disabled in this example because reset tokens appear in the app URL.

Restart the app for a fresh demo account. The example does not delete received mail; use your inbox retention settings or clean up your own test messages afterward. Do not run this example against production user accounts.

## Use the same pattern in your app

The key sequence is in [live.cy.js](./live.cy.js): record `receivedAfter` just before requesting a reset, match a specific subject or sender, and use `extractLink` with your application's exact origin and reset path. Recording the timestamp first prevents a fast email from being excluded. Matching both time and message attributes prevents accidentally opening an older email or an unrelated notification.

If your app redirects through a tracking host, disable tracking for test messages or deliberately handle that flow in the test. Do not drop the origin check just to accept any link in an email. For parallel tests, use a distinct inbox or per-test correlation in the subject, because a timestamp alone cannot separate simultaneous requests to one inbox.
