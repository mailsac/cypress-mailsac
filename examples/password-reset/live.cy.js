import { extractLink } from '../../dist/index.js';

// Deliberately separate from npm test: this sends one email using your SMTP server.
it('resets a password using a real Mailsac inbox', () => {
  let email;
  let receivedAfter;
  cy.visit('/');
  cy.get('[data-demo-email]').invoke('text').then((value) => { email = value; });
  cy.contains('a', 'Forgot your password?').click();
  cy.then(() => cy.get('input[name=email]').type(email));
  cy.then(() => { receivedAfter = new Date().toISOString(); });
  cy.contains('button', 'Send reset email').click();
  cy.get('[role=status]').should('contain', 'a reset email is on its way');

  cy.then(() => cy.mailsacWaitForMessage({
    email,
    receivedAfter,
    subject: 'Reset your Example App password',
    timeoutMs: 60000,
    pollIntervalMs: 1000,
  })).then((message) => {
    const resetUrl = extractLink(message, {
      origin: new URL(Cypress.config('baseUrl')).origin,
      pathname: '/reset',
    });
    cy.visit(resetUrl, { log: false });
  });
  cy.get('input[name=password]').type('my-new-demo-password', { log: false });
  cy.contains('button', 'Update password').click();
  cy.contains('h1', 'Password updated').should('be.visible');
  cy.contains('a', 'Sign in').click();
  cy.then(() => cy.get('input[name=email]').type(email));
  cy.get('input[name=password]').type('my-new-demo-password', { log: false });
  cy.contains('button', 'Sign in').click();
  cy.get('[role=status]').should('contain', 'signed in successfully');
});
