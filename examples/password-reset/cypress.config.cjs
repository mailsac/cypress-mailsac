const { defineConfig } = require('cypress');
const { createMailsacTasks } = require('../../dist/node.js');

if (process.env.DEMO_MAIL_MODE !== 'smtp' || !process.env.MAILSAC_API_KEY) {
  throw new Error('Live example requires explicit SMTP mode and a server-side MAILSAC_API_KEY. See the example README.');
}

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: process.env.MAILSAC_DEMO_URL || 'http://127.0.0.1:3037',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'examples/password-reset/live.cy.js',
    setupNodeEvents(on, config) {
      // Mailsac access stays in Node, never config.env or the application browser.
      on('task', createMailsacTasks({ apiKey: process.env.MAILSAC_API_KEY }));
      return config;
    },
  },
});
