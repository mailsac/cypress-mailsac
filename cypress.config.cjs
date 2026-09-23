const { defineConfig } = require('cypress');
const { createMailsacTasks } = require('./dist/node.js');

module.exports = defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: process.env.MAILSAC_DEMO_URL || 'http://127.0.0.1:3037',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'cypress/e2e/**/*.cy.js',
    setupNodeEvents(on, config) {
      // Keep credentials in Cypress's Node process. Never put API keys in config.env.
      on('task', createMailsacTasks({
        apiKey: process.env.MAILSAC_API_KEY,
        ...(process.env.MAILSAC_BASE_URL ? { baseUrl: process.env.MAILSAC_BASE_URL } : {}),
      }));
      return config;
    },
  },
});
