'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const cypress = require('cypress');
const root = path.resolve(__dirname, '..');
const fixtureKey = 'local-fixture-key-not-a-real-credential';

async function main() {
  const child = spawn(process.execPath, [path.join(root, 'examples/password-reset/server.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '0',
      DEMO_MAIL_MODE: 'fixture',
      DEMO_EMAIL: 'cypress-demo@mailsac.test',
      MAILSAC_FIXTURE_KEY: fixtureKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = () => { if (!child.killed) child.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  try {
    const origin = await new Promise((resolve, reject) => {
      const lines = readline.createInterface({ input: child.stdout });
      const timer = setTimeout(() => reject(new Error('Local fixture did not start within 15 seconds')), 15000);
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Local fixture exited (${code})`)); });
      lines.on('line', (line) => {
        if (line.startsWith('DEMO_READY ')) {
          clearTimeout(timer);
          const ready = JSON.parse(line.slice('DEMO_READY '.length));
          if (ready.mode !== 'fixture') reject(new Error('Refusing to run fixture tests against SMTP mode'));
          else resolve(ready.origin);
        }
      });
    });
    // Only the Node-side task configuration reads these variables.
    // Override inherited values so this test cannot use a live Mailsac key or endpoint.
    process.env.MAILSAC_API_KEY = fixtureKey;
    process.env.MAILSAC_BASE_URL = `${origin}/api`;
    process.env.MAILSAC_DEMO_URL = origin;
    const result = await cypress.run({
      project: root,
      browser: 'electron',
      headless: true,
      config: { baseUrl: origin, video: false, screenshotOnRunFailure: false },
    });
    process.exitCode = 'totalFailed' in result ? (result.totalFailed ? 1 : 0) : 1;
  } finally {
    stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
